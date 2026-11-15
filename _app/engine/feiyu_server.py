# -*- coding: utf-8 -*-
"""飞鱼 CosyVoice3 常驻服务。

为什么要常驻：fc 里一次推理本身只要 4-5 秒，
但 `feiyu_speak.py` 每次都要重新加载 3.5GB 模型，光加载就十几秒。
做成常驻进程后，加载只发生一次，之后每句就是纯推理时间。

    GET  /health              → { ok, ready, style, device, styles }
    POST /tts    JSON {text, style, speed}  → { ok, file, url, dur, ms, cached }
    POST /unload              → 还显存
    GET  /audio/<name>        → 支持 Range（<audio> 边下边播必须）

产物落在 engine/runtime/tts/（打包后是 userData/runtime/tts/），和 Edge/XTTS
共用同一个目录和 LRU——主程序的 /engine/audio/<name> 那条路由已经写好了 Range，直接能播。
"""
import hashlib
import io
import base64
import json
import os
import re
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
# 可写数据根：安装到 Program Files 时安装目录只读，主进程用 FISH_DATA_DIR 指到
# userData；没设时还是 engine/runtime，开发行为不变。
# ⚠ 必须和 asr.mjs / tts.mjs / xtts_server.py 用同一套规则——它们共用 tts 目录，
# 任何一处漏改都会变成「合成成功但 /engine/audio 404、一句都不播」。
_DATA = Path(os.environ.get("FISH_DATA_DIR") or (HERE / "runtime"))
OUTDIR = _DATA / "tts"
OUTDIR.mkdir(parents=True, exist_ok=True)

PORT = int(os.environ.get("FISH_FEIYU_PORT", "8895"))

PKG = Path(os.environ.get("FEIYU_PKG", r"D:\feiyu\models\FeiyuVoice-CosyVoice3"))
REPO = Path(os.environ.get("FEIYU_REPO", r"D:\feiyu\cosyvoice"))

STATE = {
    "ready": False,
    "loading": False,
    "style": None,      # 当前装的是哪个声线
    "device": "cpu",
    "styles": [],
    "voice": None,      # AutoModel 实例
    "params": None,     # manifest["inference"]
    "last_used": 0.0,
    "invocations": 0,
    # 半精度开关。4060 上实测：fp32 RTF≈1.18、fp16 RTF≈1.21，fp16 反而略慢
    # （CosyVoice3 的 llm 走 autocast，flow 的 DiT 对 fp16 不友好），所以默认按
    # manifest 走 fp32。想试：FISH_FEIYU_FP16=1 起服务。
    "fp16": False,
    # 推理串行锁。CosyVoice 的 llm/flow/hift 共享同一份权重和显存，
    # 两个请求同时进来不会更快，只会互相抢显存最后一起 OOM。
    # 前端可以放心并行预取，服务端在这里排队，顺序不乱。
    "lock": None,
    # 显存里当前那份 llm 权重对应的文件（绝对路径字符串）。
    # 切声线时用它判断要不要真的重装权重——光看 style 名字会踩
    # 「cute → gentle 都以为自己在用对权重」的坑。
    "llm_ckpt": None,
}


STATE["lock"] = threading.Lock()
STATE["last_stream"] = {}


def log(*a):
    try:
        print("[feiyu]", *a, flush=True)
    except Exception:
        pass
    # stdout 被父进程接管时偶尔收不到（venv 的 python.exe 会再 exec 一次 base 解释器，
    # 那之后 print 落到哪个管道不一定）。所以再写一份自己的日志文件，排障靠它。
    try:
        import io as _io, os as _os, time as _t
        _root = _os.environ.get("FISH_DATA_DIR") or _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "runtime")
        p = _os.path.join(_root, "feiyu-server.log")
        _os.makedirs(_os.path.dirname(p), exist_ok=True)
        with _io.open(p, "a", encoding="utf-8") as f:
            f.write(_t.strftime("%H:%M:%S ") + " ".join(str(x) for x in a) + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------- 环境

def patch_torchaudio():
    """torchaudio 2.11 的 load() 走 torchcodec，Windows 下缺 FFmpeg DLL。

    用 soundfile 顶掉。注意 TTS 自己会重采样，这里只负责读出来 + 转成 [C, N]。
    """
    import soundfile as sf
    import torch
    import torchaudio

    def _sf_load(wav, sample_rate=None, **kw):
        data, sr = sf.read(wav, dtype="float32", always_2d=True)
        speech = torch.from_numpy(data.T)
        if sample_rate is not None and sr != sample_rate:
            speech = torchaudio.functional.resample(speech, sr, sample_rate)
            sr = sample_rate
        return speech, sr

    torchaudio.load = _sf_load


def prepare_env():
    os.environ.update(
        HF_HUB_OFFLINE="1",
        TRANSFORMERS_OFFLINE="1",
        PYTHONDONTWRITEBYTECODE="1",
        OMP_NUM_THREADS="4",
    )
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    mt = str(REPO / "third_party" / "Matcha-TTS")
    if mt not in sys.path:
        sys.path.append(mt)


# ---------------------------------------------------------------- 模型

def read_manifest():
    """manifest 只有几 KB，启动就读——不然 /health 报不出有哪些声线，
    而且没加载模型时 /tts 想拿默认 speed 会踩到 params=None。"""
    try:
        m = json.loads((PKG / "manifest.json").read_text(encoding="utf-8-sig"))
        STATE["styles"] = sorted(m["styles"].keys())
        STATE["params"] = m["inference"]
        return m
    except Exception as e:
        log("manifest 读不出来:", e)
        return None


def load_model():
    """第一次 /tts 才加载。返回 False 表示加载失败，错误在 STATE['err'] 里。"""
    if STATE["ready"]:
        return True
    if STATE["loading"]:
        # 预热和「第一句」可能同时到达（启动时后台 warm，正好她也开口）。
        # 原来这里直接 return False，两边都以为加载失败；现在等加载线程落地。
        t0 = time.perf_counter()
        while STATE["loading"] and time.perf_counter() - t0 < 180:
            time.sleep(0.2)
        return STATE["ready"]
    STATE["loading"] = True
    t0 = time.perf_counter()
    try:
        manifest = read_manifest()
        if manifest is None:
            raise RuntimeError("manifest.json 读不出来")
        base = PKG / manifest["base_model_dir"]

        prepare_env()
        patch_torchaudio()

        import torch
        from cosyvoice.cli.cosyvoice import AutoModel

        torch.set_num_threads(4)
        # fp16 开关：环境变量优先，默认关。A/B 实测 fp16 没有收益（见 STATE 注释），
        # 想对比就 FISH_FEIYU_FP16=1 起服务，试听文件放 _试听/。
        env = os.environ.get("FISH_FEIYU_FP16", "0").strip().lower()
        fp16 = env not in ("0", "false", "no", "off")
        if not torch.cuda.is_available():
            fp16 = False
            log("没有 CUDA，fp16 关闭")
        log("加载基础模型 ... fp16=%s" % fp16)
        voice = AutoModel(model_dir=str(base), fp16=fp16, load_trt=False, load_vllm=False)
        STATE["voice"] = voice
        STATE["fp16"] = bool(getattr(voice, "fp16", fp16))
        STATE["device"] = str(next(voice.model.llm.parameters()).device)
        STATE["ready"] = True
        STATE["style"] = None
        # 记住当前显存里坐的是哪份 llm 权重：切回基础权重的声线时必须能识别出来重装，
        # 否则 cute(F6) → gentle(base) 会继续用 F6，两个声线出来一模一样。
        STATE["llm_ckpt"] = str((base / "llm.pt").resolve())
        log("模型就绪 %.1fs device=%s" % (time.perf_counter() - t0, STATE["device"]))
        return True
    except Exception as e:
        STATE["err"] = "%s: %s" % (type(e).__name__, e)
        log("加载失败", STATE["err"])
        traceback.print_exc()
        return False
    finally:
        STATE["loading"] = False


def use_style(style):
    """换声线要重装 llm 权重（1.9GB），已装过就直接用。"""
    if STATE["style"] == style:
        return True
    import torch

    manifest = json.loads((PKG / "manifest.json").read_text(encoding="utf-8-sig"))
    if style not in manifest["styles"]:
        raise KeyError("未知声线 %s，可选 %s" % (style, STATE["styles"]))
    sel = manifest["styles"][style]
    base = PKG / manifest["base_model_dir"]
    ckpt = (PKG / sel["llm_checkpoint"]).resolve()

    t0 = time.perf_counter()
    if STATE.get("llm_ckpt") == str(ckpt):
        # 同一份权重只是换了标签（或 base → 用 base 的声线），不必再读 1.9GB。
        log("声线 %s 复用当前权重" % style)
    else:
        log("装声线 %s (%.0f MB)" % (style, ckpt.stat().st_size / 1048576))
        state = torch.load(str(ckpt), map_location="cpu", weights_only=True)
        STATE["voice"].model.llm.load_state_dict(state, strict=True)
        del state
        STATE["llm_ckpt"] = str(ckpt)

    STATE["voice"].model.llm.eval()
    from cosyvoice.utils.common import set_all_random_seed
    set_all_random_seed(STATE["params"]["seed"])
    STATE["style"] = style
    log("声线就绪 %.1fs" % (time.perf_counter() - t0))
    return True


# ---------------------------------------------------------------- 合成

SAFE = re.compile(r"^[a-f0-9]{8,32}\.(wav|mp3)$")


# ================= 参考音频文件夹 =================
# 用户把 wav 丢进这里，旁边放一个同名 .txt 写「这段音频里说了什么」——
# prompt_text 必须跟音频对得上，写错了音色会飘。
# 文件名就是标签，多个标签用 + 或 、 隔开，比如「可爱+撒娇.wav」「温柔.wav」。
# 合成时按文本情绪挑最贴近的那条；挑不到就用 default。
REFDIR = Path(os.environ.get("FISH_FEIYU_REFS", "")) if os.environ.get("FISH_FEIYU_REFS") else (HERE.parent / "assets" / "refvoice")
AUDIO_EXT = (".wav", ".mp3", ".flac", ".ogg", ".m4a")

# 情绪 → 关键词。命中越多分越高，同分取更短的那条参考音频
# （参考音频越长，LLM 要消化的前缀 token 越多，合成越慢）。
EMO = {
    "撒娇": ["嘛", "啦", "呀", "呢", "好嘛", "陪我", "抱抱", "才不", "哼"],
    "傲娇": ["哼", "才不", "谁要", "讨厌", "笨蛋", "随便你", "懒得"],
    "温柔": ["辛苦", "休息", "睡", "累", "早点", "照顾", "慢", "轻轻", "安静"],
    "开心": ["好耶", "太好了", "哈哈", "喜欢", "开心", "棒", "！"],
    "难过": ["唉", "算了", "没关系", "对不起", "难过", "想哭"],
    "疑问": ["？", "?", "吗", "呢", "什么", "怎么", "为什么"],
    # 默认声线就是 cute（「可爱」），文件名又不带情绪词 —— 词典里缺这一条，
    # 它就永远拿 0 分，每次都被「最短的那条」兜底抢走，等于不按文本挑参考音。
    "可爱": ["可爱", "喵", "咕噜", "摸摸", "么么", "呜", "～", "~"],
}


def emo_keywords(tag):
    """标签 → 情绪关键词表。

    参考音文件名常带后缀（「温柔大姐姐」「可爱小鲸鱼」），而 EMO 的键是
    短词（「温柔」「撒娇」）。直接 EMO.get(tag) 精确查会整个落空 →
    打分恒为 0 → 永远退回最短的那条，「按情绪换参考音」名存实亡。
    所以精确命中失败时再做一次双向包含匹配，并取最长的那个键
    （「温柔」比「温」更该赢，将来加短键也不会被抢走）。
    """
    if tag in EMO:
        return EMO[tag]
    hits = [k for k in EMO if k in tag or tag in k]
    if not hits:
        return None
    return EMO[max(hits, key=len)]


def scan_refs():
    """扫参考音频文件夹，返回 [{id, name, tags, text, dur, path}]。
    没有同名 .txt 的条目会 text="" —— 那种用不了，直接跳过。"""
    out = []
    try:
        if not REFDIR.exists():
            return out
        for p in sorted(REFDIR.iterdir()):
            if not p.is_file() or p.suffix.lower() not in AUDIO_EXT:
                continue
            txt = p.with_suffix(".txt")
            if not txt.exists():
                continue
            try:
                raw = txt.read_text(encoding="utf-8-sig").strip()
            except Exception:
                continue
            if not raw:
                continue
            name = p.stem
            tags = [t for t in re.split(r"[+、,，_]", name) if t and t != "默认"]
            out.append({
                "id": p.name,
                "name": name,
                "tags": tags,
                "text": raw,
                "dur": round(wav_dur(p), 2),
                "path": str(p),
            })
    except Exception as e:
        log("[refs] 扫描失败: %s" % e)
    return out


def pick_ref(text, prefer=None):
    """优先精确指定；否则按情绪打分挑一条；都没有返回 None（回落 manifest 预设）。"""
    refs = scan_refs()
    if not refs:
        return None
    if prefer:
        for r in refs:
            if r["id"] == prefer or r["name"] == prefer or prefer in r["tags"]:
                return r
    # 按标签匹配打分
    scored = []
    for r in refs:
        score = 0
        for tag in r["tags"]:
            kws = emo_keywords(tag)
            if kws:
                score += sum(1 for k in kws if k in text)
            if tag in text:
                score += 1
        # 有分才参与；同分短的优先
        scored.append((score, -r["dur"], r))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    if scored and scored[0][0] > 0:
        return scored[0][2]
    # 全都没分：用名字里带「默认」的，否则用最短的那条
    for r in refs:
        if "默认" in r["tags"]:
            return r
    return min(refs, key=lambda r: r["dur"])


def key_for(text, style, speed, ref=""):
    raw = "%s|%s|%.3f|%s" % (text, style, speed, ref)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def wav_dur(path):
    try:
        import soundfile as sf
        return float(sf.info(str(path)).duration)
    except Exception:
        try:
            return os.path.getsize(path) / (24000 * 2)
        except Exception:
            return 0.0


def wav_bytes(audio, sr):
    """numpy float32 → 内存里的 PCM16 WAV。流式接口每一块都用它包一层。"""
    import numpy as np
    import soundfile as sf
    a = np.asarray(audio, dtype=np.float32).reshape(-1)
    # 防止个别 chunk 越界导致整数溢出成爆音
    np.clip(a, -1.0, 1.0, out=a)
    buf = io.BytesIO()
    sf.write(buf, a, int(sr), format="WAV", subtype="PCM_16")
    return buf.getvalue()


def split_text(text, first_max=13, next_max=30):
    """把一段话切成「先短后长」的合成单元。

    为什么要先短：第一块的合成耗时直接决定开口时间。整段 36 字要 7-13s 才
    出第一声；切成 8-13 字的头块，1-2s 就能开口，后面的块在播放时并行合成。
    为什么后面要长：块太碎会切断句间韵律，后面的块攒到 20-30 字再送，音色
    和语调更稳，也少走几次前端。
    """
    s = re.sub(r"[ \t]+", " ", str(text or "")).strip()
    s = re.sub(r"\n{2,}", "\n", s)
    if not s:
        return []
    parts = re.split(r"(?<=[。！？!?；;…\n])|(?<=[，,、])|(?<=\.\s)", s)
    parts = [p.strip() for p in parts if p.strip()]
    out, buf, limit = [], "", first_max
    for p in parts:
        # 纯标点不单独送合成，粘到上一块
        if not re.search(r"[0-9A-Za-z\u4e00-\u9fff]", p):
            buf += p
            continue
        if not buf:
            buf = p
        elif len(buf) + len(p) <= limit:
            buf += p
        else:
            out.append(buf)
            buf = p
            limit = next_max
        # 块边界尽量落在句号上，韵律最自然
        if buf and buf[-1] in "。！？!?；;…" and len(buf) >= 8:
            out.append(buf)
            buf = ""
            limit = next_max
    if buf:
        if out and len(buf) < 5:
            out[-1] += buf
        else:
            out.append(buf)
    res = []
    for seg in out:
        while len(seg) > 64:
            cut = max(seg.rfind("，", 0, 60), seg.rfind(",", 0, 60), seg.rfind("、", 0, 60))
            cut = cut + 1 if cut >= 20 else 60
            res.append(seg[:cut])
            seg = seg[cut:]
        if seg.strip():
            res.append(seg.strip())
    return res


def _spk_id(style, prompt, ref_path):
    return "s_" + hashlib.sha1(
        ("%s|%s|%s" % (style, prompt, ref_path)).encode("utf-8")).hexdigest()[:12]


def stream_cache_file(sent, style, speed, ref_name):
    d = OUTDIR / "stream"
    d.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha1(
        ("%s|%s|%.3f|%s" % (sent, style, speed, ref_name)).encode("utf-8")).hexdigest()[:20]
    return d / (h + ".wav")


def synth_stream(text, payload):
    """生成器：逐句、逐块产出 (index, wav_bytes, info)。

    为什么不用「整段 stream=True」：
      CosyVoice 的流式是 token 级的，一句 40 字能吐 8 块；但句与句之间
      要重新走 frontend（text_normalize / 抽特征），那一小段是纯 CPU，
      正好和上一句的 hift 尾巴重叠。按句切还能让前端在第二句还没算完时
      就已经在播第一句 —— 这是「1 合成完立刻输出，同时合成 2」的实现。
    """
    style = payload.get("style") or "cute"
    speed = float(payload.get("speed") or 0)
    want_ref = (payload.get("ref") or "").strip()

    if STATE["params"] is None and read_manifest() is None:
        raise RuntimeError("manifest.json 读不出来")
    if speed <= 0:
        speed = float(STATE["params"]["speed"])

    if not load_model():
        raise RuntimeError(STATE.get("err") or "模型加载失败")

    use_style(style)
    manifest = read_manifest() or {}
    if style not in manifest.get("styles", {}):
        raise RuntimeError("未知声线 %s" % style)

    picked = pick_ref(text, prefer=want_ref or None)
    if picked:
        ref_path = picked["path"]
        prompt = STATE["params"]["prompt_prefix"] + picked["text"]
        ref_name = picked["name"]
    else:
        sel = manifest["styles"][style]
        ref_path = str(PKG / sel["reference_audio"])
        prompt = STATE["params"]["prompt_prefix"] + sel["reference_text"]
        ref_name = style

    import torch
    import numpy as np

    # 参考音色特征只抽一次：add_zero_shot_spk 把 prompt 的 speech token / feat
    # 缓存进 spk2info，后面每句都不必再对 2-3 秒参考音频重跑一遍（省 0.3-0.8s/句）
    sid = _spk_id(style, prompt, ref_path)
    try:
        if sid not in STATE["voice"].frontend.spk2info:
            t0 = time.perf_counter()
            STATE["voice"].add_zero_shot_spk(prompt, str(ref_path), sid)
            log("  预抽参考音色 %.2fs / %s" % (time.perf_counter() - t0, ref_name))
    except Exception as e:
        log("  预抽参考音色失败，回落逐句抽", "%s: %s" % (type(e).__name__, e))
        sid = ""

    sentences = split_text(text)
    total = len(sentences)
    idx = 0
    t_all = time.perf_counter()
    sr = int(STATE["voice"].sample_rate)
    for si, sent in enumerate(sentences):
        t_sent = time.perf_counter()
        cf = stream_cache_file(sent, style, speed, ref_name)
        if cf.exists() and cf.stat().st_size > 2000:
            data = cf.read_bytes()
            try:
                import soundfile as sf
                info = sf.info(io.BytesIO(data))
                dur = info.frames / float(info.samplerate)
            except Exception:
                dur = max(0.1, (len(data) - 44) / (sr * 2.0))
            yield {"i": idx, "si": si, "n": total, "dur": round(dur, 3),
                   "wav": data, "text": sent, "cached": True}
            idx += 1
            log("  流式句%d/%d 命中缓存 %.2fs" % (si + 1, total, dur))
            continue

        pieces = []
        with STATE["lock"], torch.inference_mode():
            for x in STATE["voice"].inference_zero_shot(
                sent, prompt, str(ref_path), zero_shot_spk_id=sid,
                stream=True, speed=speed, text_frontend=True,
            ):
                sp = x.get("tts_speech")
                if sp is None:
                    continue
                audio = sp.detach().float().cpu().numpy().reshape(-1)
                if audio.size < 80:      # 不足 3ms 的碎片丢掉，避免 44 字节的空 WAV
                    continue
                dur = audio.size / float(sr)
                pieces.append(audio)
                yield {
                    "i": idx, "si": si, "n": total, "dur": round(dur, 3),
                    "wav": wav_bytes(audio, sr),
                    "text": sent,
                }
                idx += 1
        # 整句攒成一条落盘：同一句话第二次出现（问候、口头禅）就能秒出
        if pieces:
            try:
                import soundfile as sf
                sf.write(str(cf), np.concatenate(pieces), sr, format="WAV", subtype="PCM_16")
            except Exception as e:
                log("  句子缓存写失败", "%s: %s" % (type(e).__name__, e))
        log("  流式句%d/%d 用时%.2fs" % (si + 1, total, time.perf_counter() - t_sent))

    log("流式完成 %d 字 / %d 句 / %d 块 / %dms / %s / 参考=%s / fp16=%s" % (
        len(text), total, idx, int((time.perf_counter() - t_all) * 1000),
        style, ref_name, STATE.get("fp16")))
    STATE["last_stream"] = {
        "chars": len(text), "sentences": total, "chunks": idx,
        "ms": int((time.perf_counter() - t_all) * 1000),
    }


def do_warm(payload):
    """把模型和默认声线提前装进显存。

    应用启动后如果用户选的是飞鱼，就在后台先调一次：真开口时不用再等
    17-22 秒的加载，只剩首句那 2.5-3 秒的固定开销。
    """
    t0 = time.perf_counter()
    if STATE["params"] is None and read_manifest() is None:
        raise RuntimeError("manifest.json 读不出来")
    if not load_model():
        raise RuntimeError(STATE.get("err") or "模型加载失败")
    style = payload.get("style") or "cute"
    use_style(style)
    manifest = read_manifest() or {}
    sel = (manifest.get("styles") or {}).get(style)
    if sel:
        ref_path = str(PKG / sel["reference_audio"])
        prompt = STATE["params"]["prompt_prefix"] + sel["reference_text"]
        sid = _spk_id(style, prompt, ref_path)
        try:
            if sid not in STATE["voice"].frontend.spk2info:
                t_ref = time.perf_counter()
                STATE["voice"].add_zero_shot_spk(prompt, ref_path, sid)
                log("  预热参考音色 %.2fs / %s" % (time.perf_counter() - t_ref, style))
        except Exception as e:
            log("  预热参考音色失败（不影响使用）", "%s: %s" % (type(e).__name__, e))
    ms = int((time.perf_counter() - t0) * 1000)
    log("预热完成 %dms / %s / fp16=%s" % (ms, style, STATE.get("fp16")))
    return {"ok": True, "ms": ms, "style": style,
            "fp16": bool(STATE.get("fp16")), "device": STATE.get("device", "")}


TTS_MAX_BYTES = int(os.environ.get("PHONE_TTS_MAX_BYTES") or 128 * 1024 * 1024)
TTS_MAX_FILES = int(os.environ.get("PHONE_TTS_MAX_FILES") or 1200)


def prune_tts():
    """按容量淘汰最旧的缓存。

    tts.mjs 里也有一份同样规则的 prune，但它只在 edge 引擎合成后调用；
    飞鱼是默认引擎，不自己清的话 runtime/tts 会一直涨到把盘吃满。
    """
    try:
        files = []
        for p in OUTDIR.iterdir():
            if not p.is_file():
                continue
            st = p.stat()
            files.append((st.st_mtime, st.st_size, p))
        if not files:
            return
        files.sort(key=lambda x: x[0])
        total = sum(x[1] for x in files)
        drop = max(0, len(files) - TTS_MAX_FILES)
        i = 0
        while total > TTS_MAX_BYTES and i < len(files):
            total -= files[i][1]
            i += 1
            drop = max(drop, i)
        for _, _, p in files[:drop]:
            try:
                p.unlink()
            except Exception:
                pass
    except Exception:
        pass


def do_tts(payload):
    text = (payload.get("text") or "").strip()
    if not text:
        return {"ok": False, "error": "empty text"}, 400
    style = payload.get("style") or "cute"
    speed = float(payload.get("speed") or 0)
    want_ref = (payload.get("ref") or "").strip()

    if STATE["params"] is None and read_manifest() is None:
        return {"ok": False, "error": "manifest.json 读不出来"}, 500
    if speed <= 0:
        speed = float(STATE["params"]["speed"])

    # 参考音频：文件夹里挑一条（指定 > 按情绪自动挑 > 回落 manifest 预设）
    picked = pick_ref(text, prefer=want_ref or None)
    ref_key = picked["id"] if picked else ""

    name = key_for(text, style, speed, ref_key) + ".wav"
    out = OUTDIR / name
    if out.exists() and out.stat().st_size > 1024:
        STATE["last_used"] = time.time()
        return {"ok": True, "file": name, "url": "/engine/audio/" + name,
                "dur": round(wav_dur(out), 2), "ms": 0, "cached": True,
                "ref": picked["name"] if picked else "", "refDur": picked["dur"] if picked else 0}, 200

    if not load_model():
        return {"ok": False, "error": getattr(STATE, "err", None) or STATE.get("err") or "模型加载失败"}, 503

    try:
        import numpy as np
        import soundfile as sf
        import torch

        use_style(style)

        manifest = read_manifest() or {}
        if style not in manifest.get("styles", {}):
            return {"ok": False, "error": "未知声线 %s" % style}, 400
        if picked:
            # 文件夹里的参考音频：文本从同名 .txt 读，走 zero_shot
            ref_path = picked["path"]
            prompt = STATE["params"]["prompt_prefix"] + picked["text"]
            ref_name = picked["name"]
        else:
            # 没配文件夹 → 退回 manifest 里写死的预设
            sel = manifest["styles"][style]
            ref_path = str(PKG / sel["reference_audio"])
            prompt = STATE["params"]["prompt_prefix"] + sel["reference_text"]
            ref_name = style

        t0 = time.perf_counter()
        log("合成 text=%r prompt=%r ref=%s" % (text[:30], prompt[:40], ref_path))
        with torch.inference_mode():
            chunks = []
            for x in STATE["voice"].inference_zero_shot(
                text, prompt, ref_path,
                stream=False,
                speed=speed,
                text_frontend=True,
            ):
                sp = x.get("tts_speech")
                n = 0 if sp is None else int(sp.reshape(-1).shape[0])
                log("  段: speech=%s 点数=%d" % ("None" if sp is None else "ok", n))
                if sp is not None:
                    chunks.append(sp.detach().cpu().numpy()[0])
        if not chunks:
            log("!! 合成结果为空 text=%r ref=%s" % (text[:40], ref_path))
            return {"ok": False, "error": "合成结果为空"}, 500

        audio = np.concatenate(chunks)
        tmp = out.with_suffix(".part")
        # soundfile 靠扩展名猜容器，.part 它认不出来，得显式指定
        sf.write(str(tmp), audio, STATE["voice"].sample_rate, format="WAV", subtype="PCM_16")
        os.replace(tmp, out)          # 原子替换，别的进程不会读到半个文件
        prune_tts()

        ms = int((time.perf_counter() - t0) * 1000)
        STATE["last_used"] = time.time()
        STATE["invocations"] += 1
        log("合成 %d 字 / %.2fs / %dms / %s / 参考=%s" % (len(text), wav_dur(out), ms, style, ref_name))
        return {"ok": True, "file": name, "url": "/engine/audio/" + name,
                "dur": round(wav_dur(out), 2), "ms": ms, "cached": False,
                "ref": ref_name}, 200
    except Exception as e:
        log("合成失败", "%s: %s" % (type(e).__name__, e))
        traceback.print_exc()
        return {"ok": False, "error": "%s: %s" % (type(e).__name__, e)}, 500


# ---------------------------------------------------------------- HTTP

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(b)))
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(b)

    def _stream(self, payload):
        """边合成边吐：HTTP chunked + 每行一个 JSON（WAV 用 base64 放 b64）。

        每块都是「能独立播的完整 WAV」，前端拿到第一块就能开口，
        不用等整段算完，也不依赖浏览器对 chunked WAV 的支持。
        """
        text = (payload.get("text") or "").strip()
        if not text:
            return self._json({"ok": False, "error": "empty text"}, 400)
        self.send_response(200)
        self.send_header("content-type", "application/x-ndjson; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("transfer-encoding", "chunked")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-expose-headers", "*")
        self.end_headers()

        def emit(obj):
            line = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
            self.wfile.write(("%X\r\n" % len(line)).encode("ascii") + line + b"\r\n")
            self.wfile.flush()

        t0 = time.perf_counter()
        first = None
        n = 0
        try:
            emit({"t": "meta", "ready": bool(STATE["ready"]), "fp16": STATE.get("fp16"),
                  "device": STATE["device"], "style": payload.get("style") or "cute"})
            for ch in synth_stream(text, payload):
                if first is None:
                    first = time.perf_counter() - t0
                    emit({"t": "first", "ms": int(first * 1000)})
                n += 1
                emit({"t": "chunk", "i": ch["i"], "n": ch["n"], "dur": ch["dur"],
                      "b64": base64.b64encode(ch["wav"]).decode("ascii")})
            emit({"t": "done", "ms": int((time.perf_counter() - t0) * 1000),
                  "firstMs": int((first or 0) * 1000), "chunks": n})
        except Exception as e:
            log("流式失败", "%s: %s" % (type(e).__name__, e))
            traceback.print_exc()
            try:
                emit({"t": "err", "error": "%s: %s" % (type(e).__name__, e)})
            except Exception:
                pass
        finally:
            try:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except Exception:
                pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
        self.send_header("content-length", "0")
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/health":
            refs = scan_refs()
            return self._json({
                "ok": True, "ready": STATE["ready"], "style": STATE["style"],
                "device": STATE["device"], "styles": STATE["styles"],
                "invocations": STATE["invocations"],
                "refs": len(refs), "refdir": str(REFDIR),
            })
        if u.path == "/refs":
            # 给设置界面用：文件夹里有哪些参考音频、每条对应什么文字、多长
            return self._json({"ok": True, "dir": str(REFDIR), "refs": scan_refs()})
        if u.path.startswith("/audio/"):
            name = urllib.parse.unquote(u.path[len("/audio/"):])
            if not SAFE.match(name):
                return self._json({"ok": False, "error": "bad name"}, 400)
            p = OUTDIR / name
            if not p.exists():
                return self._json({"ok": False, "error": "not found"}, 404)
            data = p.read_bytes()
            # <audio> 必须能 Range，否则 Chromium 边下边播会报 MediaError code=4
            rng = self.headers.get("range")
            if rng:
                m = re.match(r"bytes=(\d*)-(\d*)", rng)
                if m:
                    total = len(data)
                    s = int(m.group(1) or 0)
                    e = int(m.group(2)) if m.group(2) else total - 1
                    e = min(e, total - 1)
                    if s > e or s >= total:
                        self.send_response(416)
                        self.send_header("content-range", "bytes */%d" % total)
                        self.send_header("content-length", "0")
                        self.end_headers()
                        return
                    body = data[s:e + 1]
                    self.send_response(206)
                    self.send_header("content-type", "audio/wav")
                    self.send_header("content-length", str(len(body)))
                    self.send_header("content-range", "bytes %d-%d/%d" % (s, e, total))
                    self.send_header("accept-ranges", "bytes")
                    self.send_header("access-control-allow-origin", "*")
                    self.end_headers()
                    self.wfile.write(body)
                    return
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(data)))
            self.send_header("accept-ranges", "bytes")
            self.send_header("access-control-allow-origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return
        return self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        n = int(self.headers.get("content-length") or 0)
        try:
            payload = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        except Exception:
            return self._json({"ok": False, "error": "bad json"}, 400)

        if u.path == "/tts":
            body, code = do_tts(payload)
            return self._json(body, code)
        if u.path == "/tts_stream":
            return self._stream(payload)
        if u.path == "/warm":
            try:
                return self._json(do_warm(payload))
            except Exception as e:
                return self._json({"ok": False, "error": "%s: %s" % (type(e).__name__, e)}, 500)
        if u.path == "/unload":
            STATE["voice"] = None
            STATE["ready"] = False
            STATE["style"] = None
            try:
                import torch
                torch.cuda.empty_cache()
            except Exception:
                pass
            log("已卸载，显存归还")
            return self._json({"ok": True, "ready": False})
        return self._json({"ok": False, "error": "not found"}, 404)


def main():
    read_manifest()          # 先填 styles / params，/health 才有内容
    log("服务启动 :%d  pkg=%s  声线=%s" % (PORT, PKG, STATE["styles"]))
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    srv.serve_forever()


if __name__ == "__main__":
    main()
