# -*- coding: utf-8 -*-
"""一键安装 XTTS 运行环境。

为什么单独一个脚本：XTTS 的依赖（torch CUDA 版 2.3GB + torchaudio + TTS + 模型 1.8GB）
约 6GB，装不进安装包。但它和 RVC 又不共用一个环境——RVC 那边为了省 1.1GB 故意没装 torch
（用 numpy 替身顶的），而 XTTS 必须要真 torch。硬塞进去会把 RVC 弄坏。

所以：独立 venv + 独立模型目录，全在 tts2/ 下。

关键坑（都是踩出来的）：
1. download.pytorch.org 在国内不通（40 分钟零字节）。走阿里云镜像直连抓 wheel：
   https://mirrors.aliyun.com/pytorch-wheels/cu121/ —— 注意 URL 里的 + 要编码成 %2B。
2. TTS 0.22 的下载器硬编码 huggingface.co，HF_ENDPOINT 对它无效。手动从 hf-mirror 下。
3. transformers 5.x 删了 BeamSearchScorer，TTS 0.22 还在 import 它 → 必须钉 4.46.3。
4. torch>=2.6 把 torch.load 的 weights_only 默认改成 True，TTS 的 checkpoint 带自定义类会炸。
   （钉在 2.4.1 就没这个问题，但运行时代码里仍留了兜底。）

进度通过 stdout 的 `[step] 序号/总数 说明` 回传，主进程转给设置页显示。
"""
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)                       # _app/
RVC_PY = os.path.join(APP, "rvc", "py", "python.exe")
VENV = os.path.join(HERE, "py")                   # tts2/py
MODELS = os.path.join(HERE, "models")             # tts2/models
PY_ZIP = os.path.join(HERE, "_py310.zip")
PY_URL = "https://www.nuget.org/api/v2/package/python/3.10.11"

# 阿里云镜像（官方源不通，这个 2 分钟能下完 2.3GB）
TORCH_BASE = "https://mirrors.aliyun.com/pytorch-wheels/cu121/"
TORCH_WHL = "torch-2.4.1%2Bcu121-cp310-cp310-win_amd64.whl"
AUDIO_WHL = "torchaudio-2.4.1%2Bcu121-cp310-cp310-win_amd64.whl"

# XTTS-v2 五个文件，从 hf-mirror 下（HF 直连超时）
HF_BASE = "https://hf-mirror.com/coqui/XTTS-v2/resolve/main/"
HF_FILES = [
    ("config.json", "config.json"),
    ("model.pth", "model.pth"),
    ("vocab.json", "vocab.json"),
    ("speakers_xtts.pth", "speakers_xtts.pth"),
    ("hash.md5", "hash.md5"),
]

PIP_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple"

STEPS = [
    ("准备 Python 3.10", 1),
    ("创建独立环境", 1),
    ("下载 torch CUDA 版（2.3GB）", 1),
    ("安装 torch / torchaudio", 1),
    ("装 TTS 与依赖", 1),
    ("下载 XTTS-v2 模型（1.8GB）", 2),
    ("自检", 1),
]
TOTAL = sum(n for _, n in STEPS)


def emit(s):
    sys.stdout.write(s + "\n")
    sys.stdout.flush()


def step(name, cur, total, detail=""):
    emit("[step] %d/%d %s%s" % (cur, total, name, ("  " + detail) if detail else ""))


def run(cmd, env=None, cwd=None):
    """跑一条命令，失败抛异常并把最后几行输出带出去。"""
    p = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=cwd,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        tail = ((p.stdout or "") + (p.stderr or "")).strip().splitlines()[-8:]
        raise RuntimeError("命令失败 rc=%d: %s\n%s" % (p.returncode, " ".join(cmd[:3]), "\n".join(tail)))
    return p.stdout


def pip(py, args, env, index=PIP_INDEX):
    base = [py, "-m", "pip", "install", "--disable-pip-version-check"]
    if index:
        base += ["-i", index]
    return run(base + args, env=env)


def fetch(url, dest, label=""):
    """带进度地下载。大文件不打印百分比，只在整 MB 时更新一次。"""
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "dafeiyu-setup/1"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        last = -1
        while True:
            buf = r.read(1 << 20)
            if not buf:
                break
            f.write(buf)
            got += len(buf)
            mb = got >> 20
            if mb != last:
                last = mb
                if total:
                    emit("[dl] %s %d/%d MB" % (label or os.path.basename(dest), mb, total >> 20))
                else:
                    emit("[dl] %s %d MB" % (label or os.path.basename(dest), mb))
    os.replace(tmp, dest)
    return dest


def ensure_python():
    """优先复用 RVC 那个 Python（已经装好 pip、省 16MB 下载），没有再自己下。"""
    if os.path.isfile(RVC_PY):
        emit("[info] 复用 RVC 的 Python: " + RVC_PY)
        return RVC_PY
    if os.path.isfile(os.path.join(VENV, "Scripts", "python.exe")):
        return os.path.join(VENV, "Scripts", "python.exe")
    base_py = os.path.join(HERE, "pybase", "python.exe")
    if not os.path.isfile(base_py):
        emit("[info] 下载 Python 3.10.11（16MB）")
        zip_path = PY_ZIP
        fetch(PY_URL, zip_path, "python")
        emit("[info] 解开 Python")
        tmpdir = os.path.join(HERE, "_pytmp")
        if os.path.isdir(tmpdir):
            shutil.rmtree(tmpdir, ignore_errors=True)
        import zipfile
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(tmpdir)
        tools = os.path.join(tmpdir, "tools")
        os.makedirs(os.path.join(HERE, "pybase"), exist_ok=True)
        for name in os.listdir(tools):
            shutil.move(os.path.join(tools, name), os.path.join(HERE, "pybase", name))
        shutil.rmtree(tmpdir, ignore_errors=True)
        try:
            os.remove(zip_path)
        except OSError:
            pass
        run([base_py, "-m", "ensurepip", "--default-pip"])
    return base_py


def main():
    os.makedirs(MODELS, exist_ok=True)
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PIP_NO_WARN_SCRIPT_LOCATION"] = "1"
    cur = 0

    # 1) Python
    base_py = ensure_python()
    cur += 1
    step("准备 Python 3.10", cur, TOTAL, base_py)

    # 2) venv
    venv_py = os.path.join(VENV, "Scripts", "python.exe")
    if not os.path.isfile(venv_py):
        emit("[info] 创建独立环境（不污染 RVC）")
        run([base_py, "-m", "venv", VENV])
    cur += 1
    step("创建独立环境", cur, TOTAL, VENV)
    pip(venv_py, ["--upgrade", "pip<24.1"], env)

    # 3) 下 torch wheel（不走 index，直接抓文件：镜像站不是标准 PyPI 索引）
    whl_dir = os.path.join(HERE, "_whl")
    os.makedirs(whl_dir, exist_ok=True)
    for whl, label in ((TORCH_WHL, "torch"), (AUDIO_WHL, "torchaudio")):
        dest = os.path.join(whl_dir, urllib.parse.unquote(whl))
        if os.path.isfile(dest):
            emit("[info] 已有 %s，跳过下载" % os.path.basename(dest))
            continue
        emit("[info] 下载 %s" % label)
        fetch(TORCH_BASE + whl, dest, label)
    cur += 1
    step("下载 torch CUDA 版", cur, TOTAL, "完成")

    # 4) 装 torch（--no-deps，避免它去 PyPI 找一堆用不上的）
    pip(venv_py, ["--no-deps", os.path.join(whl_dir, urllib.parse.unquote(TORCH_WHL))], env, index=None)
    pip(venv_py, ["--no-deps", os.path.join(whl_dir, urllib.parse.unquote(AUDIO_WHL))], env, index=None)
    pip(venv_py, ["filelock", "typing-extensions", "sympy", "networkx", "jinja2", "fsspec"], env)
    cur += 1
    step("安装 torch / torchaudio", cur, TOTAL, "完成")

    # 5) TTS 与依赖
    # transformers 必须钉 4.46.3：5.x 删了 BeamSearchScorer，TTS 0.22 还在 import
    pip(venv_py, ["setuptools<81", "wheel"], env)
    pip(venv_py, ["numpy==1.26.4"], env)
    pip(venv_py, ["scipy", "librosa==0.10.2", "soundfile", "numba", "inflect",
                  "tqdm", "anyascii", "pyyaml", "aiohttp", "pandas",
                  "transformers==4.46.3", "tokenizers==0.20.3"], env)
    pip(venv_py, ["TTS==0.22.0", "--no-deps"], env)
    cur += 1
    step("装 TTS 与依赖", cur, TOTAL, "完成")

    # 6) 模型
    for name, _ in HF_FILES:
        dest = os.path.join(MODELS, name)
        if os.path.isfile(dest) and os.path.getsize(dest) > 1024:
            emit("[info] 已有模型文件 %s，跳过" % name)
            continue
        emit("[info] 下载模型 %s" % name)
        fetch(HF_BASE + name, dest, name)
    cur += 2
    step("下载 XTTS-v2 模型", cur, TOTAL, "完成")

    # 7) 自检
    emit("[info] 自检")
    code = (
        "import torch, sys;"
        "print('torch', torch.__version__);"
        "print('cuda', torch.cuda.is_available());"
        "import TTS; print('TTS ok')"
    )
    out = run([venv_py, "-c", code], env)
    for line in out.strip().splitlines():
        emit("[info] " + line)
    cur += 1
    step("自检", cur, TOTAL, "完成")

    emit("[done] XTTS 环境已就绪")
    try:
        emit("[done] 环境 %d MB，模型 %d MB" % (
            sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(VENV) for f in fs) >> 20,
            sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(MODELS) for f in fs) >> 20,
        ))
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit("[error] " + str(e))
        sys.exit(1)
