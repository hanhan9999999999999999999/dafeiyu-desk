# -*- coding: utf-8 -*-
"""一键安装 RVC 运行环境。

为什么需要这个脚本：RVC 的运行环境（Python + onnxruntime + 一堆音频库 + 模型）
大约 1.7GB，装不进安装包。但用户不该为此去学 pip——所以做成一个按钮。

跟 .pth 路线的关键区别：这条路上装的全是**预编译 wheel**，不需要 Visual Studio
编译环境，也不需要 CUDA Toolkit。任何一台普通 Windows 都能装完。
（.pth 路线要 fairseq，得现场编译，普通机器装不上——这就是换过来的原因。）

进度通过 stdout 的 `[step] 序号/总数 说明` 回传，主进程转给设置页显示。
"""
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "py")            # 装好的 Python 放这儿
PY_ZIP = os.path.join(HERE, "_py310.zip")
PY_URL = "https://www.nuget.org/api/v2/package/python/3.10.11"

STEPS = [
    ("下载 Python 3.10", 1),
    ("解开 Python", 1),
    ("确认 pip", 1),
    ("装 numpy / 音频库", 4),
    ("跳过 torch（用 numpy 替身）", 4),
    ("装 onnxruntime-directml", 1),
    ("装 TTS+RVC 包", 1),
    ("下载 hubert / rmvpe / vec 模型", 1),
]
TOTAL = sum(n for _, n in STEPS)


def emit(s):
    sys.stdout.write(s + "\n")
    sys.stdout.flush()


def step(name, cur, total, detail=""):
    emit("[step] %d/%d %s%s" % (cur, total, name, ("  " + detail) if detail else ""))


def run(cmd, env=None, cwd=None, quiet=True):
    """跑一条命令，失败抛异常并把最后几行输出带出去（不然只看到 returncode 没法查）。"""
    p = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=cwd,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        tail = ((p.stdout or "") + (p.stderr or "")).strip().splitlines()[-6:]
        raise RuntimeError("命令失败 rc=%d: %s\n%s" % (p.returncode, " ".join(cmd[:4]), "\n".join(tail)))
    return p.stdout if quiet else p


def pip(py, args, env):
    return run([py, "-m", "pip"] + args, env=env)


def main():
    os.makedirs(TARGET, exist_ok=True)
    py = os.path.join(TARGET, "python.exe")
    cur = 0

    # 1) 下 Python
    if not os.path.isfile(py):
        cur += 1
        step(STEPS[0][0], cur, TOTAL)
        emit("  " + PY_URL)
        # 自己拉，不用 urlretrieve：那个没有进度，16MB 在慢网下看着像死了
        with urllib.request.urlopen(PY_URL, timeout=120) as r, open(PY_ZIP, "wb") as f:
            total = int(r.headers.get("content-length") or 0)
            got, mark = 0, 0.0
            while True:
                chunk = r.read(262144)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
                if total and time.time() - mark > 0.4:
                    mark = time.time()
                    emit("  %d%%  %.1f/%0.1f MB" % (got * 100 // total, got / 1048576, total / 1048576))
        emit("  %.1f MB" % (os.path.getsize(PY_ZIP) / 1048576))

        # 2) 解压
        # 不能直接 extractall(TARGET)：nuget 包内部有 tools/，而解压时可能先落一个
        # Tools/，Windows 大小写不敏感 → 搬文件时撞成 "Tools\Tools already exists"。
        # 所以先解到 _x，只从 _x\tools 往外搬，撞名就跳过。
        cur += 1
        step(STEPS[1][0], cur, TOTAL)
        tmp = os.path.join(TARGET, "_x")
        shutil.rmtree(tmp, ignore_errors=True)
        with zipfile.ZipFile(PY_ZIP) as z:
            z.extractall(tmp)
        inner = os.path.join(tmp, "tools")
        src = inner if os.path.isdir(inner) else tmp
        moved = 0
        for n in os.listdir(src):
            s = os.path.join(src, n)
            d = os.path.join(TARGET, n)
            if os.path.exists(d):
                continue           # 已经有一份（大小写重名），不覆盖
            shutil.move(s, d)
            moved += 1
        shutil.rmtree(tmp, ignore_errors=True)
        emit("  搬出 %d 项" % moved)
        os.remove(PY_ZIP)
    else:
        cur += 2
        step("Python 已存在，跳过", cur, TOTAL, py)

    if not os.path.isfile(py):
        raise RuntimeError("Python 没解出来：" + py)

    # 3) pip
    cur += 1
    step(STEPS[2][0], cur, TOTAL)
    try:
        run([py, "-m", "pip", "--version"])
    except Exception:
        run([py, "-m", "ensurepip", "--upgrade"])

    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    mirror = ["-i", "https://pypi.tuna.tsinghua.edu.cn/simple"]

    # 4) 基础库
    cur += 1
    step(STEPS[3][0], cur, TOTAL)
    pip(py, ["install", "-q"] + mirror + [
        "numpy==1.26.0", "scipy>=1.10.0", "librosa>=0.9.1", "soundfile>=0.12.1",
        "pyworld>=0.3.2", "praat-parselmouth>=0.4.3", "faiss-cpu<1.11.0",
        "cffi<2.0.0", "edge-tts>=6.1.8", "ffmpeg-python>=0.2.0",
        "huggingface_hub>=0.17.0",
    ], env)

    # 5) 不再装 torch。
    #
    # 原来的版本要装 torch==2.1.2 + torchaudio（解包后 1.1GB），理由是
    # tts-with-rvc-onnx 依赖它做 mel 变换。但那点活儿（hann 窗 / STFT / matmul / log）
    # numpy 一样干，而且对拍过：最大绝对差 0.000039、相关性 1.00000000。
    # 换成 numpy 替身（torch_shim.py）之后，整个转换反而更快（2.1s vs 3.9s）。
    #
    # 代价：把 .pth 导出成 .onnx 仍然需要真 torch（那要跑完整网络前向），
    # 会在 `pth_to_onnx.py` 里给出明确提示。
    cur += 1
    step(STEPS[4][0], cur, TOTAL, "跳过（用 numpy 替身，省 1.1GB）")

    # 6) onnxruntime-directml：走 DirectML，不要 CUDA Toolkit
    cur += 1
    step(STEPS[5][0], cur, TOTAL)
    # onnx==1.14.1：新版在这台机器上报 DLL 加载失败（onnx_cpp2py_export），
    # 1.14.1 稳定。它只在「把 .pth 转成 .onnx」时用到。
    pip(py, ["install", "-q"] + mirror + ["onnxruntime-directml", "onnx==1.14.1"], env)

    # 7) 包本体
    cur += 1
    step(STEPS[6][0], cur, TOTAL)
    # --no-deps：包自己声明了 torch>=1.13.1 / torchaudio（解包 1.1GB），
    # 但运行时根本走不到那两条路（我们不用 torchcrepe，f0 用 rmvpe 的 onnx）。
    # 依赖已经在第 4 步手动装齐了，这里只拿代码本体。
    pip(py, ["install", "-q", "--no-deps"] + mirror + ["tts-with-rvc-onnx"], env)

    # 7.5) 抢回 DirectML。
    # tts-with-rvc-onnx 依赖普通 onnxruntime，pip 会把它一起装上；两个包共存时
    # `import onnxruntime` 走的是普通版，providers 里就没有 DmlExecutionProvider，
    # 推理掉回 CPU（3.7 秒变 20 秒）。
    # 光 pip uninstall 不够——实测会留下一个空的命名空间包（`ort.__file__ is None`，
    # `get_available_providers` 直接不存在）。必须把 site-packages 里的目录一起删掉，
    # 再用 --force-reinstall 装 directml。
    cur += 1
    step(STEPS[6][0] + "（切回 DirectML）", cur, TOTAL)
    pip(py, ["uninstall", "-y", "-q", "onnxruntime"], env)
    sp = os.path.join(TARGET, "Lib", "site-packages")
    for n in list(os.listdir(sp)) if os.path.isdir(sp) else []:
        if n.startswith("onnxruntime"):
            shutil.rmtree(os.path.join(sp, n), ignore_errors=True)
    pip(py, ["install", "-q"] + mirror + ["--force-reinstall", "onnxruntime-directml"], env)
    out = run([py, "-c", "import onnxruntime as o;print(','.join(o.get_available_providers()))"], env=env)
    emit("  providers: " + out.strip())
    if "DmlExecutionProvider" not in out:
        emit("  [warn] 没拿到 DirectML，RVC 会退回 CPU 跑（慢，但能用）")

    # 7.6) 把 numpy 钉回 1.x。
    # tts-with-rvc-onnx 声明了 numpy==1.26.0，但别的包（librosa / numba 系）
    # 可能顺手把 numpy 顶到 2.x；而 scipy / librosa 的二进制都是按 1.x 编的，
    # 撞上 2.x 会在 import 阶段就报 ABI 错误。装完所有包之后再钉一次。
    cur += 1
    step("把 numpy 钉回 1.x", cur, TOTAL)
    pip(py, ["install", "-q"] + mirror + ["--force-reinstall", "numpy==1.26.0"], env)
    # 这里顺带验一遍替身：能不能 import、mel 能不能算。
    # 只看版本号是不够的 —— 前面就吃过「包都在、但 DmlExecutionProvider 不在」的亏。
    chk = run([py, "-c",
               "import sys,numpy;sys.path.insert(0,%r);"
               "import torch_shim as T;"
               "m=T.matmul(T.from_numpy(numpy.ones((4,8),'float32')),T.from_numpy(numpy.ones((8,3),'float32')));"
               "print(numpy.__version__, m.shape)" % HERE], env=env)
    emit("  numpy + 替身 " + chk.strip().replace("\n", " | "))

    # 8) 基础模型（hf-mirror，直连 huggingface 在国内会超时）
    cur += 1
    step(STEPS[7][0], cur, TOTAL)
    env2 = dict(env)
    env2["HF_ENDPOINT"] = "https://hf-mirror.com"
    models = os.path.join(HERE, "models")
    os.makedirs(models, exist_ok=True)
    jobs = [
        ("NaruseMioShirakana/MoeSS-SUBModel", "vec-768-layer-12.onnx"),
        ("lj1995/VoiceConversionWebUI", "rmvpe.onnx"),
    ]
    for repo, fn in jobs:
        dst = os.path.join(models, fn)
        if os.path.isfile(dst) and os.path.getsize(dst) > 1024 * 1024:
            emit("  已有 " + fn)
            continue
        emit("  下载 " + fn)
        run([py, "-c",
             "import os,time;from huggingface_hub import hf_hub_download as d;"
             "p=d(repo_id=%r,filename=%r,local_dir=%r,token=False);"
             "print('%.0f MB'%%(os.path.getsize(p)/1048576))" % (repo, fn, models)], env=env2)

    emit("[done] 安装完成")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        emit("[error] " + str(e))
        sys.exit(1)
