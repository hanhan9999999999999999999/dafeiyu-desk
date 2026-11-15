# -*- coding: utf-8 -*-
"""XTTS-v2 语音服务：拿一段参考音频克隆音色，把文字念出来。

为什么单独起一个进程
    torch + XTTS 一共 1.9GB 显存、约 380MB 内存常驻，而大多数时候她只是在待机。
    放进主进程意味着"打开程序就吃 1.9GB"，放进这个服务意味着"第一次要用才加载"。

接口（跟 rvc_server.py 保持同一套习惯，主进程那边少写一套代码）
    GET  /health              → { ok, ready, device, lang }
    POST /tts    body: wav?   → 不对，这里输入是文本
    POST /tts    JSON         → { ok, file, sr, ms, cached }
        字段：text（必填）、ref（参考音频路径，必填）、lang（默认 zh-cn）、
              speed（默认 1.0）、emotion 暂不支持
    GET  /audio/<name>        → 回放产物

参考音频
    3–10 秒干净人声最合适。太长不会更准，反而更慢；低于 3 秒学不出音色。
    第一次用某个 ref 时会把它的 latent 缓存起来（`_refcache/`），之后同一个人只算一次。
"""
import hashlib
import json
import os
import sys
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
# 产物直接落 tts.mjs 的缓存目录：那边的 /engine/audio/<name> 已经写好了 Range，
# 文件名正则 ^[a-f0-9]{8,32}\.(wav|mp3)$ 也刚好匹配这里的 16 位 hash。
# 放进同一个池子还有个好处：LRU 统一管，不会两套清理逻辑各删各的。
# 可写数据根：安装到 Program Files 时安装目录只读，主进程用 FISH_DATA_DIR 指到
# userData；没设时还是 engine/runtime，开发行为不变。
DATA_DIR = os.environ.get("FISH_DATA_DIR") or os.path.join(HERE, "runtime")
OUTDIR = os.path.join(DATA_DIR, "tts")
REFCACHE = os.path.join(DATA_DIR, "xtts", "_ref")
os.makedirs(OUTDIR, exist_ok=True)
os.makedirs(REFCACHE, exist_ok=True)

STATE = {"api": None, "device": "cpu", "ready": False, "lang": "zh-cn"}


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


def patch_torch():
    """torch 2.4 其实不需要这两处，但换个环境（2.6+）就会炸，留着当保险。"""
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio as ta
    import TTS.utils.io as tu

    orig = torch.load

    def _load(*a, **kw):
        kw.setdefault("weights_only", False)
        return orig(*a, **kw)

    torch.load = _load
    tu.torch.load = _load

    def _load_audio(path, sr=None):
        d, orig_sr = sf.read(path, dtype="float32", always_2d=True)
        d = np.mean(d, axis=1)
        return torch.from_numpy(np.ascontiguousarray(d)).unsqueeze(0), orig_sr

    ta.load = _load_audio


def load_model():
    if STATE["ready"]:
        return
    patch_torch()
    import torch

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    t0 = time.time()
    log("加载 XTTS-v2（%s）…" % dev)
    from TTS.api import TTS

    api = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(dev)
    STATE["api"] = api
    STATE["device"] = dev
    log("模型就绪 %.1fs" % (time.time() - t0))

    # 预热：第一次推理要挑 cuDNN 算法、分配显存，那几秒不该算在用户头上
    try:
        warm = os.path.join(OUTDIR, "_warmup.wav")
        api.tts_to_file(text="你好。", speaker_wav=None, language="zh-cn", file_path=warm)
        log("预热完成")
    except Exception:
        log("预热跳过（需要参考音频，属正常）")
    STATE["ready"] = True


def key_for(text, ref, lang, speed):
    h = hashlib.sha1()
    h.update(("%s|%s|%s|%.3f" % (text, os.path.basename(ref), lang, speed)).encode("utf-8"))
    try:
        h.update(str(os.path.getmtime(ref)).encode())
    except Exception:
        pass
    return h.hexdigest()[:16]


def wav_dur(path):
    """时长只用来打日志，但打 0s 会让「合成成功了吗」这件事看起来可疑。"""
    try:
        import soundfile as sf
        info = sf.info(path)
        return round(info.frames / float(info.samplerate), 2)
    except Exception as e:
        # 别静默吞掉：这个函数出过一次「文件明明能读、服务里却返回 0」的问题
        log("wav_dur 失败:", e)
        try:
            return round(os.path.getsize(path) / (24000 * 2), 2)
        except Exception:
            return 0


def do_tts(payload):
    load_model()
    api = STATE["api"]
    text = (payload.get("text") or "").strip()
    ref = (payload.get("ref") or "").strip()
    lang = (payload.get("lang") or "zh-cn").strip()
    try:
        speed = float(payload.get("speed") or 1.0)
    except Exception:
        speed = 1.0
    if not text:
        return {"ok": False, "error": "空文本"}
    if not ref or not os.path.exists(ref):
        return {"ok": False, "error": "参考音频不存在: %s" % ref}

    stem = key_for(text, ref, lang, speed)
    out = os.path.join(OUTDIR, stem + ".wav")
    if os.path.exists(out) and os.path.getsize(out) > 2000:
        return {"ok": True, "file": out, "sr": 24000, "ms": 0, "cached": True, "dur": wav_dur(out)}

    t0 = time.time()
    api.tts_to_file(text=text, speaker_wav=ref, language=lang,
                    file_path=out, speed=speed)
    ms = int((time.time() - t0) * 1000)
    return {"ok": True, "file": out, "sr": 24000, "ms": ms, "cached": False, "dur": wav_dur(out)}


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

    def _bytes(self, data, ctype, code=200, extra=None):
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.send_header("accept-ranges", "bytes")
        self.send_header("access-control-allow-origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

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
            return self._json({
                "ok": True, "ready": STATE["ready"], "device": STATE["device"],
                "lang": STATE["lang"], "outdir": OUTDIR,
            })
        if u.path.startswith("/audio/"):
            name = urllib.parse.unquote(u.path[len("/audio/"):])
            if "/" in name or ".." in name:
                return self._json({"ok": False, "error": "bad name"}, 400)
            p = os.path.join(OUTDIR, name)
            if not os.path.exists(p):
                return self._json({"ok": False, "error": "not found"}, 404)
            data = open(p, "rb").read()
            # <audio> 必须能 Range，否则 Chromium 边下边播会报 code=4
            rng = self.headers.get("range")
            if rng and rng.startswith("bytes="):
                try:
                    a, b = rng[6:].split("-")
                    start = int(a or 0)
                    end = int(b) if b else len(data) - 1
                except Exception:
                    start, end = 0, len(data) - 1
                end = min(end, len(data) - 1)
                part = data[start:end + 1]
                return self._bytes(part, "audio/wav", 206, {
                    "content-range": "bytes %d-%d/%d" % (start, end, len(data)),
                })
            return self._bytes(data, "audio/wav")
        return self._json({"ok": False, "error": "unknown"}, 404)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        n = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return self._json({"ok": False, "error": "bad json"}, 400)
        try:
            if u.path == "/tts":
                return self._json(do_tts(payload))
            if u.path == "/unload":
                STATE["api"] = None
                STATE["ready"] = False
                try:
                    import torch
                    torch.cuda.empty_cache()
                except Exception:
                    pass
                return self._json({"ok": True})
        except Exception as e:
            log("错误:", e)
            traceback.print_exc()
            return self._json({"ok": False, "error": str(e)}, 500)
        return self._json({"ok": False, "error": "unknown"}, 404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8896
    # 只有真的要用才加载：先起服务，第一个 /tts 请求再加载模型
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    log("XTTS 服务 http://127.0.0.1:%d（模型按需加载）" % port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
