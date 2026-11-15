# -*- coding: utf-8 -*-
"""大肥鱼的声音换色服务：常驻 HTTP，模型只加载一次。

为什么要常驻：加载模型虽然只要 0.4~2.3 秒，但每句话都来一次就没法对话了。

为什么有两种后端：
- `onnx`（默认）：推理走 onnxruntime，Windows 上用 DirectML（不挑显卡，也不需要
  CUDA Toolkit）。整条链路只装预编译 wheel，用户能自己装起来。
- `pth`：原来的 PyTorch 路线，速度稍快（GPU 3.5s vs 5.3s），但依赖 fairseq——
  它要在用户机器上现场编译，普通电脑装不上。留作本机自用和对照。

端点：
  GET  /health                     -> {ok, backend, model, device, sr, busy}
  POST /convert?pitch=0&f0=rmvpe   -> body 是音频二进制，返回 wav
  GET  /models                     -> 列出可用模型
"""
import argparse
import io
import json
import os
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))

# torch>=2.6 的 torch.load 默认 weights_only=True，会拦 fairseq 的自定义类。
# 必须在 import rvc_python 之前打这个补丁。
try:
    import torch as _t

    _orig_load = _t.load

    def _load(*a, **kw):
        kw.setdefault("weights_only", False)
        return _orig_load(*a, **kw)

    _t.load = _load
except Exception:
    pass

# 运行时其实只需要 torch 做 mel 变换（hann / stft / abs / matmul / log），
# 但那一个包就 1031MB。装了就用真的，没装就用同目录的 numpy 替身。
# 两者输出对拍过：最大绝对差 0.000039、相关性 1.00000000。
try:
    import torch as _torch_check  # noqa: F401
    _TORCH_REAL = True
except Exception:
    _TORCH_REAL = False
    try:
        sys.path.insert(0, HERE)
        import torch_shim as _shim
        sys.modules["torch"] = _shim
        sys.modules["torch.nn"] = _shim.nn
        sys.modules["torch.nn.functional"] = _shim.nn.functional
        # 这一行在 log() 定义之前执行，只能用 print
        print("[rvc] 没有 torch，用 numpy 替身（省 1GB，效果一样）", flush=True)
    except Exception as _e:
        print("[rvc] torch 替身加载失败：" + str(_e), flush=True)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

# 同目录的 EQ 模块。用 sys.path 兜底，因为服务可能从任何 cwd 被拉起。
sys.path.insert(0, HERE)
import post_eq as _post_eq  # noqa: E402

STATE = {
    "infer": None,
    "backend": "onnx",
    "model": "",
    "device": "",
    "sr": 48000,
    "busy": False,
    "lock": threading.Lock(),
    "error": "",
    # 多个模型按需加载后缓存起来：加载一个 110MB 的 onnx 要 2.4 秒，
    # 同一句试听要来回切模型时，每次都重载体验很差。
    # 只留最近 3 个 —— 每个引擎常驻 100MB 上下，留太多内存会难看。
    "engines": {},
    "engine_order": [],
    # 自动转换（.pth → .onnx）的进度，给设置面板显示用。
    # 用户只需要把 .pth 丢进 models/ 任意子目录，不用管别的。
    "convert": {"running": False, "total": 0, "done": 0, "current": "", "error": ""},
}

ENGINE_KEEP = 3


def engine_key(rel_path, backend, device):
    return (backend or "onnx") + "|" + (device or "") + "|" + (rel_path or "")


def resolve_model(rel_path):
    """把「用户填的相对路径」变成绝对路径。

    相对路径按本文件所在目录算 —— 早先按当前工作目录算，
    服务从任何别的目录被拉起就找不到模型了。
    """
    if not rel_path:
        return ""
    p = rel_path
    if not os.path.isabs(p):
        p = os.path.join(HERE, p)
    return os.path.normpath(p)


def get_engine(rel_path, backend, device, models_dir):
    """按路径取引擎，命中缓存就直接用；没命中就加载并把最旧的挤出去。

    返回 (engine, error)。error 非空时 engine 是 None。
    """
    abs_path = resolve_model(rel_path)
    if not abs_path or not os.path.isfile(abs_path):
        return None, "找不到模型：" + str(rel_path)

    key = engine_key(abs_path, backend, device)
    cached = STATE["engines"].get(key)
    if cached is not None:
        # 命中就把它挪到队尾，让「最久没用」的那个先被淘汰
        try:
            STATE["engine_order"].remove(key)
        except ValueError:
            pass
        STATE["engine_order"].append(key)
        return cached, ""

    try:
        if backend == "pth":
            eng = load_pth(abs_path, device)
        else:
            eng = load_onnx(abs_path, device, models_dir)
    except Exception as e:
        return None, "加载失败：" + str(e)[:200]

    STATE["engines"][key] = eng
    STATE["engine_order"].append(key)
    while len(STATE["engine_order"]) > ENGINE_KEEP:
        old = STATE["engine_order"].pop(0)
        STATE["engines"].pop(old, None)
        log("释放旧引擎：%s" % old.split("|")[-1])

    # 最近用过的这个同步到 STATE，/health 和自动转换那边都在看它
    STATE["infer"] = eng
    STATE["model"] = abs_path
    STATE["sr"] = int(
        getattr(eng, "sampling_rate", 0)
        or getattr(getattr(eng, "vc", None), "tgt_sr", 0)
        or STATE["sr"]
    )
    return eng, ""


def _resample(data, sr_in, sr_out):
    """带抗混叠滤波的重采样。

    用线性插值直接下采样会丢弃高频信息却不做低通，
    8kHz 以上的能量按采样定理折叠回低频，听感就是持续的沙沙声。
    resample_poly 内部先做低通再抽取，能避免这个问题。
    """
    from math import gcd

    import numpy as _np

    g = gcd(int(sr_in), int(sr_out))
    up = int(sr_out) // g
    down = int(sr_in) // g
    try:
        from scipy.signal import resample_poly

        y = resample_poly(data.astype("float32"), up, down)
    except Exception:
        # 没有 scipy 就退到线性插值（会差一点，但不会崩）
        n = int(round(len(data) * sr_out / sr_in))
        idx = _np.linspace(0, len(data) - 1, n)
        y = _np.interp(idx, _np.arange(len(data)), data)
    return y.astype("float32")


def log(msg):
    sys.stdout.write("[rvc] " + str(msg) + "\n")
    sys.stdout.flush()


# ------------------------------------------------------- .pth → .onnx 自动转换
#
# 主人要的效果：把 .pth 丢进 models/ 就行，程序自己转。
# 之所以能不用 fairseq：转换只需要 torch + 模型定义（fish_rvc_model 里带着），
# 而推理走的是 onnxruntime。fairseq 只在训练/推理 .pth 时才需要。

PTH_TO_ONNX = os.path.join(HERE, "pth_to_onnx.py")


def find_pth_models(base):
    """找 models/ 下所有还没有对应 .onnx 的 .pth。"""
    out = []
    if not os.path.isdir(base):
        return out
    for root, _dirs, files in os.walk(base):
        # _dl 是下载中转目录，不进正式列表
        if os.sep + "_dl" in root:
            continue
        for f in files:
            if not f.lower().endswith(".pth"):
                continue
            pth = os.path.join(root, f)
            onnx = os.path.splitext(pth)[0] + ".onnx"
            if os.path.isfile(onnx):
                continue          # 已经转过了
            # 已经有一个同目录的 .onnx 就别重复转（同一模型换个名字放进来）
            out.append(pth)
    return sorted(out)


def convert_one(pth_path):
    """调 pth_to_onnx.py 转一个。返回 (.onnx 路径, 错误信息)。"""
    dst = os.path.splitext(pth_path)[0] + ".onnx"
    cmd = [sys.executable, PTH_TO_ONNX, pth_path, dst]
    log("开始转换 %s" % os.path.basename(pth_path))
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", env=env, timeout=1800)
    except Exception as e:
        return None, "%s: %s" % (type(e).__name__, str(e)[:200])
    if r.returncode == 0 and os.path.isfile(dst):
        tail = ""
        for line in (r.stdout or "").strip().splitlines():
            if "完成" in line:
                tail = line.strip()
        log("转换完成 %s  %s" % (os.path.basename(dst), tail))
        return dst, ""
    # 失败：把脚本最后一行（[onnx] 失败: ...）拿出来给用户看
    msg = "转换失败"
    for line in reversed((r.stdout or "").strip().splitlines()):
        if "[onnx]" in line:
            msg = line.replace("[onnx]", "").strip()
            break
    log("转换失败 %s：%s" % (os.path.basename(pth_path), msg))
    return None, msg


def auto_convert_worker(base, backend, device, models_dir):
    """后台线程：把没转过的 .pth 一个个转掉。"""
    try:
        pend = find_pth_models(base)
        STATE["convert"].update({"running": True, "total": len(pend), "done": 0,
                                 "current": "", "error": ""})
        if not pend:
            STATE["convert"]["running"] = False
            return
        log("发现 %d 个待转换的 .pth" % len(pend))
        for i, pth in enumerate(pend):
            STATE["convert"]["current"] = os.path.splitext(os.path.basename(pth))[0]
            dst, err = convert_one(pth)
            if err:
                STATE["convert"]["error"] = os.path.basename(pth) + ": " + err
            else:
                STATE["convert"]["done"] = i + 1
                # 转好了但当前没有可用模型（或后端就是 onnx）→ 顺手换上
                if backend == "onnx" and (STATE["infer"] is None or not STATE["model"]):
                    try:
                        t0 = time.time()
                        STATE["infer"] = load_onnx(dst, device, models_dir)
                        STATE["sr"] = int(getattr(STATE["infer"], "sampling_rate", 48000))
                        STATE["model"] = dst
                        STATE["error"] = ""
                        log("已切换到新模型 %s (%.1fs)" % (os.path.basename(dst), time.time() - t0))
                    except Exception as e:
                        log("新模型加载失败：%s" % e)
    except Exception as e:
        STATE["convert"]["error"] = str(e)[:300]
        log("自动转换线程出错：%s" % e)
    finally:
        STATE["convert"]["running"] = False
        STATE["convert"]["current"] = ""


def start_auto_convert(base, backend, device, models_dir):
    t = threading.Thread(target=auto_convert_worker,
                         args=(base, backend, device, models_dir), daemon=True)
    t.start()


# ---------------------------------------------------------------- onnx 后端

def load_onnx(model_path, device, models_dir):
    from tts_with_rvc import TTS_RVC

    eng = TTS_RVC(
        model_path=model_path,
        voice="zh-CN-XiaoxuanNeural",
        f0_method="rmvpe",
        device=device,
        sampling_rate=48000,
        hop_size=512,
        models_dir=models_dir,
    )
    return eng


def convert_onnx(eng, wav_bytes, pitch, f0, index_rate, tmpdir, rms_mix=0.25, protect=0.45,
                 filter_radius=3, resample_to=0):
    """onnx 后端的转换：先落盘成临时文件（它只吃路径），转完读回来。

    resample_to:
      0   = 保持输入原样（推荐）—— TTS 给的是 24k，模型是 48k，让引擎自己重采样，
            它内部用的是正经的重采样器，比我们先降到 16k 再让它升回 48k 好得多。
      16000 / 48000 等 = 先重采样到这个值再喂（留作对照）。
    """
    import uuid

    tag = uuid.uuid4().hex[:10]
    src = os.path.join(tmpdir, "in_%s.wav" % tag)
    data, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data[:, 0]

    # 旧版这里无条件降到 16k，注释说「RVC 的输入是 16k」——那是把 f0 提取模型的
    # 采样率错当成整个前端的采样率了。模型是 48k 的，降成 16k 等于把 8kHz 以上
    # 的信息全扔掉，再让引擎插值回 48k，听感就是又闷又空、缺空气感。
    # 现在默认不降（resample_to=0），让引擎按自己的路径处理。
    if resample_to and sr != resample_to:
        data = _resample(data, sr, resample_to)
        sr = resample_to
    sf.write(src, data, sr, format="WAV", subtype="PCM_16")

    out_name = "out_%s.wav" % tag
    # voiceover_file 的返回值就是输出路径（它自己挑临时目录，不受 tmpdir 控制），
    # 别去猜目录——第一版按固定目录找，结果它写到了 E:\Temp\... 下面。
    ret = eng.voiceover_file(
        src,
        pitch=int(pitch),
        index_rate=float(index_rate),
        f0method=f0,
        filter_radius=int(filter_radius),
        resample_sr=0,
        rms_mix_rate=float(rms_mix),
        protect=float(protect),
        output_filename=out_name,
        verbose=False,
    )

    cands = []
    if isinstance(ret, str) and os.path.isfile(ret):
        cands.append(ret)
    # 兜底：万一将来版本改成只返回布尔，再按几个可能的位置找
    try:
        d = getattr(eng, "output_directory", None) or getattr(eng, "_output_directory", None)
        if d:
            cands.append(os.path.join(str(d), out_name))
    except Exception:
        pass
    cands.append(os.path.join(tmpdir, out_name))
    for c in cands:
        if os.path.isfile(c):
            try:
                # 后处理校正：模型出来的声音中低频偏多、3-6k 偏亮、高频偏少，
                # 听感像收音机。这里拉回接近原声（参数是实测扫出来的）。
                _x, _sr = sf.read(c, dtype="float32", always_2d=False)
                if _x.ndim > 1:
                    _x = _x.mean(axis=1)
                _x = _post_eq.condition(_x, _sr)
                _bio = io.BytesIO()
                sf.write(_bio, _x, _sr, format="WAV", subtype="PCM_16")
                buf = _bio.getvalue()
            except Exception as _e:
                log("[rvc] 后处理跳过：%s" % str(_e)[:120])
                buf = io.open(c, "rb").read()
            try:
                os.remove(c)
            except Exception:
                pass
            try:
                os.remove(src)
            except Exception:
                pass
            return buf
    raise RuntimeError("转换完成但找不到输出文件：%s" % cands)


# ---------------------------------------------------------------- pth 后端

def load_pth(model_path, device):
    from rvc_python.api import RVCInference
    import torch

    ck = torch.load(model_path, map_location="cpu", weights_only=False)
    ver = ck.get("version", "v1")
    weight = ck.get("weight") or {}
    if "enc_p.emb_phone.weight" in weight:
        dim = weight["enc_p.emb_phone.weight"].shape[1]
        ver = "v1" if dim == 256 else "v2"
    del ck, weight

    rvc = RVCInference(device=device)
    rvc.load_model(model_path, version=ver)
    rvc.set_params(f0method="rmvpe", f0up_key=0, index_rate=0.30,
                   filter_radius=3, resample_sr=0, rms_mix_rate=0.25, protect=0.45)
    return rvc


def convert_pth(rvc, wav_bytes, pitch, f0, index_rate, tmpdir, rms_mix=0.25, protect=0.45,
                filter_radius=3, resample_to=0):
    import uuid

    tag = uuid.uuid4().hex[:10]
    src = os.path.join(tmpdir, "in_%s.wav" % tag)
    dst = os.path.join(tmpdir, "out_%s.wav" % tag)
    data, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data[:, 0]
    # 同 convert_onnx：不再无条件降到 16k。resample_to=0 保持原样。
    if resample_to and sr != resample_to:
        data = _resample(data, sr, resample_to)
        sr = resample_to
    sf.write(src, data, sr, format="WAV", subtype="PCM_16")

    # vc_single 的位置参数顺序（和 voiceover_file 不同，别搞混）：
    #   sid, input_path, f0_up_key, f0_file, f0_method, file_index, file_index2,
    #   index_rate, filter_radius, resample_sr, rms_mix_rate, protect
    # 旧版这里把 rms_mix / protect 写死成 0.25 / 0.33，函数参数根本没用上 —— 已修。
    out = rvc.vc.vc_single(
        0, src, int(pitch), None, f0, None, None,
        float(index_rate), int(filter_radius), 0, float(rms_mix), float(protect),
    )
    # 三种返回形态都得接：失败 (info, (None,None)) / 成功 (audio, sr) / 成功 ndarray
    if isinstance(out, tuple) and len(out) == 2 and isinstance(out[1], tuple):
        raise RuntimeError("转换失败：" + str(out[0])[:400])
    if isinstance(out, tuple) and len(out) == 2:
        audio, out_sr = out[0], out[1]
    else:
        audio, out_sr = out, rvc.vc.tgt_sr

    audio = np.asarray(audio)
    if audio.dtype != np.int16:
        peak = float(np.abs(audio).max()) or 1.0
        audio = (audio / peak * 32767 * 0.9).astype("int16")
    sf.write(dst, audio, int(out_sr), format="WAV", subtype="PCM_16")
    buf = io.open(dst, "rb").read()
    for p in (src, dst):
        try:
            os.remove(p)
        except Exception:
            pass
    return buf


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/health":
            self._json({
                "ok": STATE["infer"] is not None,
                "backend": STATE["backend"],
                "model": os.path.basename(STATE["model"]) if STATE["model"] else "",
                "device": STATE["device"],
                "sr": STATE["sr"],
                "busy": STATE["busy"],
                "error": STATE["error"],
                # 自动转换进度：设置面板据此显示「正在把 xxx.pth 转成模型」
                "convert": STATE["convert"],
            })
            return
        if u.path == "/models":
            d = os.path.join(HERE, "models")
            out = []
            if os.path.isdir(d):
                for n in sorted(os.listdir(d)):
                    p = os.path.join(d, n)
                    if os.path.isdir(p):
                        for f in sorted(os.listdir(p)):
                            if f.endswith((".pth", ".onnx")):
                                out.append({"name": f, "path": os.path.join(p, f),
                                            "mb": round(os.path.getsize(os.path.join(p, f)) / 1048576, 1)})
            self._json({"ok": True, "models": out})
            return
        self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/convert":
            self._json({"ok": False, "error": "not found"}, 404)
            return
        q = parse_qs(u.query)
        pitch = int((q.get("pitch") or ["0"])[0])
        f0 = (q.get("f0") or ["rmvpe"])[0]
        index_rate = float((q.get("index_rate") or ["0.30"])[0])
        rms_mix = float((q.get("rms_mix") or ["0.25"])[0])
        protect = float((q.get("protect") or ["0.45"])[0])
        # filter_radius：中值滤波半径，压气泡音。原版写死 3，调到 5-7 能把
        # 换声后那种「咔咔」的哑音磨平。太大会吞字，超过 9 就开始糊。
        filter_radius = int((q.get("filter_radius") or ["3"])[0])
        # resample_to：0 = 保持输入原样，让引擎自己重采样（默认，最好的路径）。
        # 之所以允许传，是为了 A/B 时能复现「降到 16k 再喂」那个旧行为做对照。
        resample_to = int((q.get("resample_to") or ["0"])[0])
        # ?model= 只对本次请求生效，不改变 STATE 里的「当前模型」
        # —— 试听时来回切模型不该把用户的默认选择带跑。
        want_model = (q.get("model") or [""])[0]

        n = int(self.headers.get("content-length") or 0)
        if n <= 0:
            self._json({"ok": False, "error": "空请求体"}, 400)
            return
        wav_bytes = self.rfile.read(n)

        if want_model:
            # models_dir 要用「基础模型所在的根目录」，不是模型自己的子目录 ——
            # vec-768 / rmvpe 都在 models/ 根下，传子目录会让它去找 huggingface。
            eng, err = get_engine(want_model, STATE["backend"], STATE["device"],
                                  STATE.get("models_dir") or os.path.join(HERE, "models"))
            if eng is None:
                self._json({"ok": False, "error": err or "模型加载失败"}, 503)
                return
        else:
            eng = STATE["infer"]
        if eng is None:
            self._json({"ok": False, "error": STATE["error"] or "模型没加载"}, 503)
            return
        if not STATE["lock"].acquire(blocking=False):
            self._json({"ok": False, "error": "上一句还在转换"}, 429)
            return
        STATE["busy"] = True
        t0 = time.time()
        try:
            tmpdir = os.path.join(os.environ.get("FISH_DATA_DIR") or HERE, "_tmp")
            os.makedirs(tmpdir, exist_ok=True)
            if STATE["backend"] == "onnx":
                buf = convert_onnx(eng, wav_bytes, pitch, f0, index_rate, tmpdir, rms_mix, protect,
                                   filter_radius=filter_radius, resample_to=resample_to)
            else:
                buf = convert_pth(eng, wav_bytes, pitch, f0, index_rate, tmpdir, rms_mix, protect,
                                  filter_radius=filter_radius, resample_to=resample_to)
            log("convert ok %.2fs in=%d out=%d" % (time.time() - t0, len(wav_bytes), len(buf)))
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(buf)))
            self.end_headers()
            self.wfile.write(buf)
        except Exception as e:
            log("convert 失败：%s" % e)
            traceback.print_exc()
            self._json({"ok": False, "error": str(e)[:400]}, 500)
        finally:
            STATE["busy"] = False
            STATE["lock"].release()
            # 这次转换产生的临时 wav 用完就删。
            # 之前一直没清，跑了一天堆了三百多个文件（磁盘泄漏）。
            try:
                _prune_tmp(os.path.join(HERE, "_tmp"), keep=6, max_age=600)
            except Exception:
                pass


def _prune_tmp(tmpdir, keep=6, max_age=600):
    """清掉 _tmp 里没人认领的旧文件。

    每次转换都会写一个 in_<hash>.wav 和一个 out_*.wav，正常情况下一秒就该删；
    但异常退出、并发请求、转换中途崩掉都会留下孤儿文件。
    这里按「最后修改时间」兜底：超过 max_age 秒的一律删，
    再额外只留最近的 keep 个，免得目录无限膨胀。
    """
    if not os.path.isdir(tmpdir):
        return
    now = time.time()
    items = []
    for name in os.listdir(tmpdir):
        p = os.path.join(tmpdir, name)
        if not os.path.isfile(p):
            continue
        try:
            st = os.stat(p)
        except OSError:
            continue
        age = now - st.st_mtime
        if age > max_age:
            try:
                os.remove(p)
            except OSError:
                pass
            continue
        items.append((st.st_mtime, p))
    # 还剩下的，只保留最近的几个
    items.sort(reverse=True)
    for _, p in items[keep:]:
        try:
            os.remove(p)
        except OSError:
            pass


def _watch_parent():
    """每隔 2 秒看一眼父进程还在不在，不在就硬退出。"""
    parent = os.getppid()
    if not parent or parent <= 0:
        return

    def loop():
        while True:
            time.sleep(2)
            alive = True
            try:
                # Windows 上 os.getppid() 在父进程死后会返回当前 pid 或保持不变，
                # 真正可靠的判断是拿 pid 去问系统还在不在。
                import ctypes
                h = ctypes.windll.kernel32.OpenProcess(0x1000, False, parent)  # QUERY_LIMITED_INFORMATION
                if not h:
                    alive = False
                else:
                    code = ctypes.c_ulong()
                    ok = ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
                    ctypes.windll.kernel32.CloseHandle(h)
                    if not ok or code.value != 259:  # 259 = STILL_ACTIVE
                        alive = False
            except Exception:
                alive = True  # 查不清就别乱杀自己
            if not alive:
                # 先退出，再（尽可能）打个招呼。
                # 顺序不能反：父进程一死，stdout 的管道就断了，log() 会抛
                # BrokenPipeError 把这条线程当场搞崩，os._exit 就永远轮不到。
                try:
                    log("父进程 %d 已退出，跟着关" % parent)
                except Exception:
                    pass
                os._exit(0)

    t = threading.Thread(target=loop, daemon=True)
    t.start()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8897)
    ap.add_argument("--backend", default="onnx", choices=["onnx", "pth"])
    ap.add_argument("--model", default="")
    ap.add_argument("--device", default="dml")
    ap.add_argument("--models-dir", default="")
    # 调试用：单独起服务时不跟着父进程退出。生产里别加这个参数。
    ap.add_argument("--no-watch", action="store_true")
    a = ap.parse_args()

    STATE["backend"] = a.backend
    STATE["device"] = a.device

    model = a.model
    if not model:
        base = os.path.join(HERE, "models")
        want = ".onnx" if a.backend == "onnx" else ".pth"
        for d in sorted(os.listdir(base)) if os.path.isdir(base) else []:
            p = os.path.join(base, d)
            if os.path.isdir(p):
                for f in sorted(os.listdir(p)):
                    if f.endswith(want):
                        model = os.path.join(p, f)
                        break
            if model:
                break

    # --model 可能是相对路径（设置里默认就写 models/warma/Warma-03.onnx）。
    # os.path.isfile 是按「当前工作目录」判断的，而这个服务可能从任何目录被拉起，
    # 那样相对路径永远找不到 —— 统一改成相对 rvc/ 目录解析。
    if model and not os.path.isabs(model):
        cand = os.path.join(HERE, model)
        if os.path.isfile(cand):
            model = cand

    if model and os.path.isfile(model):
        t0 = time.time()
        try:
            if a.backend == "onnx":
                md = a.models_dir or os.path.join(HERE, "models")
                STATE["models_dir"] = md
                STATE["infer"] = load_onnx(model, a.device, md)
                STATE["sr"] = int(getattr(STATE["infer"], "sampling_rate", 48000))
            else:
                STATE["models_dir"] = a.models_dir or os.path.join(HERE, "models")
                STATE["infer"] = load_pth(model, a.device)
                STATE["sr"] = int(STATE["infer"].vc.tgt_sr)
            STATE["model"] = model
            # 启动时加载的这个也进缓存，后面切回来就不用重载了
            STATE["engines"][engine_key(model, a.backend, a.device)] = STATE["infer"]
            STATE["engine_order"].append(engine_key(model, a.backend, a.device))
            log("loaded %s in %.1fs  backend=%s device=%s sr=%s"
                % (os.path.basename(model), time.time() - t0, a.backend, a.device, STATE["sr"]))
        except Exception as e:
            STATE["error"] = str(e)[:300]
            log("加载失败：%s" % e)
            traceback.print_exc()
    else:
        STATE["error"] = "没有可用的模型文件"
        log("没有可用的模型文件（backend=%s）" % a.backend)

    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    log("listening on 127.0.0.1:%d" % a.port)

    # 服务已经能用了，再在后台把用户丢进来的 .pth 转掉。
    # 放在 serve_forever 之前起线程，但线程自己跑，不挡监听。
    if a.backend == "onnx":
        md = a.models_dir or os.path.join(HERE, "models")
        start_auto_convert(md, a.backend, a.device, md)

    # 父进程（大肥鱼）没了就自己退出。
    # 光靠主进程的 before-quit 不够：崩溃或被 taskkill 的时候它根本不触发，
    # 这里留下的 python.exe 会一直占着 8897，下次启动直接撞端口。
    if not getattr(a, "no_watch", False):
        _watch_parent()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
