# -*- coding: utf-8 -*-
"""一键安装「飞鱼」声音的运行环境与声库。

为什么需要这个脚本：
飞鱼（FeiyuVoice）是基于 CosyVoice3 的双风格角色 TTS——cute 是微调过的权重，
gentle 用基础模型加不同参考音频。整套东西**约 14 GB**（声库 7.1G + 环境 5.6G
+ 中文 Hubert 1.2G），不可能塞进安装包，但用户也不该为此去学 WSL、pip、
submodule 这些词。所以做成一个按钮。

装完之后长这样（--home 指到的目录）：
    <home>/venv/            Python 3.11 + torch 2.11.0+cu128 + CosyVoice 依赖
    <home>/cosyvoice/       CosyVoice 源码（commit 074ca6d）
    <home>/models/FeiyuVoice-CosyVoice3/   声库（含 cute 微调权重）
    <home>/zh-hubert/       中文 Hubert（CosyVoice 抽特征用）

进度通过 stdout 回传，主进程转给设置页：
    [step] 序号/总数 说明      当前在做什么
    [dl]   说明 百分比        下载进度
    [done] 说明                装完了
    [error] 说明               出错（带原因）

国内三处必须绕开的网络问题（都是踩出来的）：
1. github.com 直连超时 → CosyVoice 源码走 ghproxy.net 代理。
2. huggingface.co 直连超时、`HF_ENDPOINT` 对第三方下载器无效 → 手动拼 hf-mirror.com 的 URL。
3. download.pytorch.org 40 分钟零字节 → torch 走 mirrors.aliyun.com/pytorch-wheels。

用法：
    python feiyu_setup.py --home D:\\feiyu
    python feiyu_setup.py --home D:\\feiyu --skip-hub     # 只装环境，不下声库
"""
import argparse
import hashlib
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

PY_VER = "3.11.9"
PY_URL = "https://www.nuget.org/api/v2/package/python/%s" % PY_VER

# torch 的版本必须和 CosyVoice 验证过的一致（声库的 runtime.template.json 写着 2.11.0+cu128）
TORCH_VER = "2.11.0"
TORCH_CU = "cu128"
TORCH_BASE = "https://mirrors.aliyun.com/pytorch-wheels/%s/" % TORCH_CU

COSY_COMMIT = "074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc"
COSY_REPO = "https://github.com/FunAudioLLM/CosyVoice"
COSY_ZIP = "https://ghproxy.net/https://github.com/FunAudioLLM/CosyVoice/archive/%s.zip" % COSY_COMMIT
MATCHA_COMMIT = "dd9105b34bf2be2230f4aa1e4769fb586a3c824e"
MATCHA_ZIP = "https://ghproxy.net/https://github.com/shivammehta25/Matcha-TTS/archive/%s.zip" % MATCHA_COMMIT

HF = "https://hf-mirror.com"
VOICE_REPO = "Esmerubphire/FeiyuVoice-CosyVoice3"
HUBERT_REPO = "TencentGameMate/chinese-hubert-base"

PIP_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple"

STEPS = [
    ("准备 Python %s" % PY_VER, 1),
    ("建立独立环境", 1),
    ("下载 PyTorch", 1),
    ("安装 PyTorch", 1),
    ("下载 CosyVoice 源码", 2),
    ("安装 CosyVoice 依赖", 1),
    ("下载飞鱼声库", 1),
    ("下载中文 Hubert", 1),
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
        raise RuntimeError("命令失败 rc=%d: %s\n%s" % (p.returncode, " ".join(str(c) for c in cmd[:4]),
                                                      "\n".join(tail)))
    return p.stdout or ""


def fetch(url, dest, label, expect_mb=None, hf_token=None):
    """带进度的下载。

    为什么用 curl 而不是 urllib：同一台机器、同一个 URL，
    urllib 只有 39 KB/s，curl 有 334 KB/s（实测），27 亿字节的 torch 包
    差出来就是十几小时和十几分钟的区别。curl.exe 是 Windows 10 1803 起
    自带的，不用额外装。`-C -` 让它断点续传，断了重跑接着下。
    """
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.isfile(dest) and os.path.getsize(dest) > 1024:
        emit("[dl] %s 已存在，跳过" % label)
        return

    curl = shutil.which("curl") or "curl.exe"
    tmp = dest + ".part"
    cmd = [curl, "-L", "--fail", "--retry", "3", "--retry-delay", "2",
           "-C", "-", "-s", "-S", "-o", tmp, url]
    if hf_token:
        cmd[-1:-1] = ["-H", "Authorization: Bearer " + hf_token]

    # curl 自己不出进度（-s 静音），这里轮询文件大小报进度
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    last_mb = -1
    while True:
        rc = proc.poll()
        size = os.path.getsize(tmp) if os.path.isfile(tmp) else 0
        mb = size >> 20
        if mb != last_mb:
            last_mb = mb
            emit("[dl] %s %.1f MB" % (label, size / 1048576.0))
        if rc is not None:
            break
        time.sleep(1.5)

    if rc != 0:
        err = ""
        try:
            err = (proc.stderr.read() or b"").decode("utf-8", "replace").strip()[:200]
        except Exception:
            pass
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise RuntimeError("下载失败 rc=%d %s：%s" % (rc, label, err))

    if not os.path.isfile(tmp) or os.path.getsize(tmp) < 1024:
        raise RuntimeError("下下来是空的：" + url)
    size = os.path.getsize(tmp)
    os.replace(tmp, dest)
    emit("[dl] %s %.1f MB 完成" % (label, size / 1048576.0))


def hf_files(repo, want=()):
    """列出 HF 仓库的文件与大小。要带鉴权的仓库这里不用（两个都是公开的）。"""
    url = "%s/api/models/%s?blobs=true" % (HF, repo)
    with urllib.request.urlopen(url, timeout=60) as r:
        j = json.loads(r.read().decode("utf-8"))
    out = []
    for s in j.get("siblings", []):
        name = s.get("rfilename") or ""
        if not name or name.startswith("."):
            continue
        if want and not any(name.startswith(w) for w in want):
            continue
        out.append((name, int(s.get("size") or 0)))
    return out


def hf_download(repo, name, dest, label):
    url = "%s/%s/resolve/main/%s" % (HF, repo, name)
    fetch(url, dest, label)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


# ---------------------------------------------------------------- 各步

def ensure_python(home):
    """下 nuget 的 Python 3.11（带 libs/*.lib，能编译扩 展），解到 <home>/_py。"""
    target = os.path.join(home, "_py")
    py = os.path.join(target, "python.exe")
    if os.path.isfile(py):
        emit("  Python 已有，跳过：" + py)
        return py
    os.makedirs(target, exist_ok=True)
    z = os.path.join(home, "_py.zip")
    emit("  " + PY_URL)
    fetch(PY_URL, z, "Python %s" % PY_VER)
    tmp = os.path.join(target, "_x")
    shutil.rmtree(tmp, ignore_errors=True)
    with zipfile.ZipFile(z) as zf:
        zf.extractall(tmp)
    # nuget 包里是 tools/ 下的一棵树；Windows 大小写不敏感，先落 Tools/ 再搬会撞名
    inner = os.path.join(tmp, "tools")
    src = inner if os.path.isdir(inner) else tmp
    moved = 0
    for n in os.listdir(src):
        s = os.path.join(src, n)
        d = os.path.join(target, n)
        if os.path.exists(d):
            continue
        shutil.move(s, d)
        moved += 1
    shutil.rmtree(tmp, ignore_errors=True)
    os.remove(z)
    emit("  解出 %d 项" % moved)
    if not os.path.isfile(py):
        raise RuntimeError("Python 没解出来：" + py)
    return py


def make_venv(home, base_py):
    """建独立 venv。飞鱼和 RVC / XTTS 各用各的环境，互不干扰。"""
    vpy = os.path.join(home, "venv", "Scripts", "python.exe")
    if os.path.isfile(vpy):
        emit("  环境已有，跳过：" + vpy)
        return vpy
    emit("  创建 " + os.path.join(home, "venv"))
    run([base_py, "-m", "venv", os.path.join(home, "venv")])
    if not os.path.isfile(vpy):
        raise RuntimeError("venv 没建出来：" + vpy)
    # pip 本身先升级到能装 wheel 的版本，再换国内镜像
    run([vpy, "-m", "pip", "install", "--upgrade", "pip", "--index-url", PIP_INDEX])
    return vpy


def install_torch(vpy, home):
    """torch 和 torchaudio 从阿里云镜像直连抓 wheel（官方源 40 分钟零字节）。"""
    cache = os.path.join(home, "_wheels")
    os.makedirs(cache, exist_ok=True)
    names = [
        "torch-%s+%s-cp311-cp311-win_amd64.whl" % (TORCH_VER, TORCH_CU),
        "torchaudio-%s+%s-cp311-cp311-win_amd64.whl" % (TORCH_VER, TORCH_CU),
    ]
    paths = []
    for n in names:
        # URL 里的 + 必须编码成 %2B，否则阿里云回 404
        url = TORCH_BASE + n.replace("+", "%2B")
        p = os.path.join(cache, n)
        fetch(url, p, n.split("-")[0] + " " + TORCH_VER)
        paths.append(p)
    emit("  安装（约 3 GB，几分钟）")
    run([vpy, "-m", "pip", "install", "--no-deps"] + paths)
    # --no-deps 省下的依赖手动补：torch 运行时真的需要这几个
    run([vpy, "-m", "pip", "install", "--index-url", PIP_INDEX,
         "filelock", "typing-extensions", "sympy", "networkx", "jinja2", "fsspec"])


def get_cosyvoice(home, vpy):
    """CosyVoice 源码。github.com 直连超时，走 ghproxy 代理下 zip。"""
    repo = os.path.join(home, "cosyvoice")
    if os.path.isdir(os.path.join(repo, "cosyvoice")):
        emit("  源码已有，跳过：" + repo)
        return repo
    z = os.path.join(home, "_cosy.zip")
    fetch(COSY_ZIP, z, "CosyVoice %s" % COSY_COMMIT[:8])
    tmp = os.path.join(home, "_cosy")
    shutil.rmtree(tmp, ignore_errors=True)
    with zipfile.ZipFile(z) as zf:
        zf.extractall(tmp)
    inner = None
    for n in os.listdir(tmp):
        if os.path.isdir(os.path.join(tmp, n)):
            inner = os.path.join(tmp, n)
            break
    if not inner:
        raise RuntimeError("CosyVoice 压缩包结构不对")
    shutil.move(inner, repo)
    shutil.rmtree(tmp, ignore_errors=True)
    os.remove(z)

    # third_party/Matcha-TTS 是 submodule，zip 里只有个空目录，要单独下
    matcha = os.path.join(repo, "third_party", "Matcha-TTS")
    if not os.path.isdir(os.path.join(matcha, "matcha")):
        emit("  下载 Matcha-TTS")
        mz = os.path.join(home, "_matcha.zip")
        fetch(MATCHA_ZIP, mz, "Matcha-TTS")
        mt = os.path.join(home, "_matcha")
        shutil.rmtree(mt, ignore_errors=True)
        with zipfile.ZipFile(mz) as zf:
            zf.extractall(mt)
        mi = None
        for n in os.listdir(mt):
            if os.path.isdir(os.path.join(mt, n)):
                mi = os.path.join(mt, n)
                break
        if mi:
            shutil.rmtree(matcha, ignore_errors=True)
            shutil.move(mi, matcha)
        shutil.rmtree(mt, ignore_errors=True)
        os.remove(mz)
    return repo


def install_cosy_deps(vpy, repo):
    """CosyVoice 的依赖。

    为什么不直接 `pip install -r requirements.txt`：那个文件第一行是
    `--extra-index-url https://download.pytorch.org/whl/cu121`，这一台机器上
    40 分钟零字节，pip 会一直卡在那儿重试；而且它钉 `torch==2.3.1`，和我们
    已经装好的 2.11.0 打架，会重下一遍 2.6GB。

    所以只装 Windows 真正跑推理要的那批：训练相关的（lightning / tensorboard /
    deepspeed）、Web UI（gradio）、linux-only（tensorrt）、可选的（modelscope /
    openai-whisper）全部跳过——我们有自己的 ASR，也不需要它的 demo 界面。
    """
    pkgs = [
        "conformer==0.3.2", "diffusers==0.29.0", "fastapi==0.115.6",
        "hydra-core==1.3.2", "HyperPyYAML==1.2.3", "inflect==7.3.1",
        "librosa==0.10.2", "matplotlib==3.7.5", "networkx==3.1",
        "numpy==1.26.4", "omegaconf==2.3.0", "onnx==1.16.0",
        "onnxruntime==1.18.0", "protobuf==4.25", "pyarrow==18.1.0",
        "pydantic==2.7.0", "pyworld==0.3.4", "rich==13.7.1",
        "soundfile==0.12.1", "transformers==4.51.3", "x-transformers==2.11.24",
        "uvicorn==0.30.0", "gdown==5.1.0", "wetext",
        # 注意包名：导入时是 `import yaml`，但 PyPI 上的名字是 PyYAML。
        # 写成 "yaml" 会报 "Could not find a version that satisfies the requirement yaml"。
        "PyYAML", "sentencepiece", "tqdm", "packaging",
    ]
    # 分批装：一锅端时某个包编译失败会让整条命令回滚，分批能看出卡在哪
    batch = 8
    for i in range(0, len(pkgs), batch):
        chunk = pkgs[i:i + batch]
        emit("  装 %d/%d：%s" % (i + len(chunk), len(pkgs), ", ".join(chunk[:3]) + ("...", "")[0]))
        try:
            run([vpy, "-m", "pip", "install", "--index-url", PIP_INDEX] + chunk)
        except Exception as e:
            # 单个包失败不该让整个安装停下（有些是可选增强，缺了也能跑）
            first = str(e).splitlines()[0][:120]
            emit("  这一批有包失败，跳过继续：%s" % first)


def get_voice(home):
    """飞鱼声库，32 个文件共 7.1 GB，从 hf-mirror 逐个下。"""
    root = os.path.join(home, "models", "FeiyuVoice-CosyVoice3")
    os.makedirs(root, exist_ok=True)
    files = hf_files(VOICE_REPO)
    if not files:
        raise RuntimeError("没列出仓库文件：" + VOICE_REPO)
    total_mb = sum(s for _, s in files) / 1048576.0
    emit("  共 %d 个文件，%.0f MB" % (len(files), total_mb))
    done = 0
    for name, size in files:
        dest = os.path.join(root, name.replace("/", os.sep))
        if os.path.isfile(dest) and os.path.getsize(dest) > 1024:
            done += 1
            continue
        hf_download(VOICE_REPO, name, dest, os.path.basename(name))
        done += 1
        emit("[dl] 声库进度 %d/%d 个文件" % (done, len(files)))

    # 校验 cute 那份权重（1.9G，下坏了最难查——加载时报个含糊的错）
    man = os.path.join(root, "manifest.json")
    if os.path.isfile(man):
        try:
            m = json.loads(io.open(man, encoding="utf-8").read())
            ck = m.get("styles", {}).get("cute", {})
            rel = ck.get("llm_checkpoint")
            want = ck.get("llm_sha256")
            if rel and want:
                p = os.path.join(root, rel.replace("/", os.sep))
                if os.path.isfile(p):
                    emit("  校验 cute 权重（1.9 GB，慢一点）")
                    got = sha256_of(p)
                    if got.lower() != want.lower():
                        raise RuntimeError("cute 权重校验失败：%s != %s" % (got[:16], want[:16]))
                    emit("  校验通过")
        except RuntimeError:
            raise
        except Exception as e:
            emit("  跳过校验（%s）" % str(e)[:80])
    return root


def get_hubert(home):
    """中文 Hubert，CosyVoice 抽语义特征用。只要 pytorch_model.bin 和 config。"""
    root = os.path.join(home, "zh-hubert")
    os.makedirs(root, exist_ok=True)
    want = ("pytorch_model.bin", "config.json", "preprocessor_config.json")
    files = [(n, s) for n, s in hf_files(HUBERT_REPO) if n in want]
    for name, _size in files:
        dest = os.path.join(root, name)
        hf_download(HUBERT_REPO, name, dest, name)
    return root


def selfcheck(vpy, home):
    """真的 import 一遍，不只看 pip list。"""
    code = (
        "import sys, torch, torchaudio, numpy, onnxruntime, librosa, soundfile, yaml, hydra\n"
        "print('python', sys.version.split()[0])\n"
        "print('torch', torch.__version__)\n"
        "print('cuda available', torch.cuda.is_available())\n"
        "print('cuda', torch.version.cuda)\n"
        "print('gpu', (torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none'))\n"
        "print('numpy', numpy.__version__)\n"
        "print('onnxruntime', onnxruntime.__version__, onnxruntime.get_available_providers()[0])\n"
    )
    out = run([vpy, "-c", code])
    for line in out.strip().splitlines():
        emit("  " + line)
    if "cuda available False" in out:
        emit("  ⚠ 没检测到 CUDA，跑起来会很慢（但仍能用 CPU）")

    # 声库关键文件在不在
    root = os.path.join(home, "models", "FeiyuVoice-CosyVoice3")
    need = [
        "models/feiyu_cute_F6_0040.pt",
        "models/Fun-CosyVoice3-0.5B-2512/llm.pt",
        "models/Fun-CosyVoice3-0.5B-2512/flow.pt",
        "models/Fun-CosyVoice3-0.5B-2512/hift.pt",
        "models/Fun-CosyVoice3-0.5B-2512/campplus.onnx",
        "models/Fun-CosyVoice3-0.5B-2512/speech_tokenizer_v3.onnx",
        "references/cute_N01.wav",
        "references/gentle_N10.wav",
    ]
    missing = [x for x in need if not os.path.isfile(os.path.join(root, x.replace("/", os.sep)))]
    if missing:
        raise RuntimeError("声库缺文件：" + ", ".join(missing[:4]))
    emit("  声库完整")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", default=os.environ.get("FEIYU_HOME") or os.path.join("D:\\", "feiyu"))
    ap.add_argument("--skip-hub", action="store_true", help="只装环境，不下声库（先试环境用）")
    ap.add_argument("--skip-torch", action="store_true", help="已经装过 torch 时跳过下载安装")
    args = ap.parse_args()

    home = os.path.abspath(args.home)
    os.makedirs(home, exist_ok=True)
    emit("[step] 0/%d 装到 %s" % (TOTAL, home))

    cur = 0
    step(STEPS[0][0], cur + 1, TOTAL)
    base_py = ensure_python(home)
    cur += 1

    step(STEPS[1][0], cur + 1, TOTAL)
    vpy = make_venv(home, base_py)
    cur += 1

    if args.skip_torch:
        step("跳过 PyTorch", cur + 1, TOTAL, "已指定 --skip-torch")
    else:
        step(STEPS[2][0], cur + 1, TOTAL)
        cur += 1
        step(STEPS[3][0], cur + 1, TOTAL)
        install_torch(vpy, home)
    cur += 2

    step(STEPS[4][0], cur + 1, TOTAL)
    repo = get_cosyvoice(home, vpy)
    cur += 2

    step(STEPS[5][0], cur + 1, TOTAL)
    install_cosy_deps(vpy, repo)
    cur += 1

    if args.skip_hub:
        step("跳过声库", cur + 1, TOTAL, "已指定 --skip-hub")
    else:
        step(STEPS[6][0], cur + 1, TOTAL)
        get_voice(home)
        cur += 1
        step(STEPS[7][0], cur + 1, TOTAL)
        get_hubert(home)
    cur += 2

    step(STEPS[8][0], cur + 1, TOTAL)
    selfcheck(vpy, home)

    emit("")
    emit("[done] 装好了。把这个目录填进设置的「环境」：%s" % home)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit("[error] " + str(e))
        sys.exit(1)
