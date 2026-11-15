#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""bench_model.py —— 飞鱼模型侧的加速 A/B（同进程、同一段文本、同一参考音色）

为什么要在进程内测：HTTP 那一层（base64、分块、WAV 打包）只占几十毫秒，
真正决定「开口快不快」的是三件事——
  ① text frontend（文本归一化 + 音素/特征）——纯 CPU；
  ② llm 自回归出 speech token ——GPU，跟字数成正比；
  ③ flow + hift 把 token 解成波形 ——GPU，跟音频长度成正比。
参考音频越长，①②里的 prompt 前缀就越长，每次请求都要重吃一遍。
所以这里把 frontend、llm+flow、以及不同后端开关分开量，才知道该开哪一刀。

用法：
  <venv>\\Scripts\\python.exe bench_model.py --texts default --cache 0
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import feiyu_server as fs  # noqa: E402

TEXTS = [
    "嗯，我在呢。",
    "主人回来啦，本鲸刚刚在海面上换完气，尾巴还湿漉漉的呢。",
    "这个问题我想了一下，其实不难。你先把设置页里的语音引擎切到飞鱼，"
    "再点一下测速，它会告诉你这台机器首声要多久。要是超过三秒，就说明模型还在冷启动。",
]


def no_cache():
    """关掉句子级缓存，量的是纯粹算出来的时间。"""
    class _P:
        def __init__(self, name):
            self.name = name
        def exists(self):
            return False
        def stat(self):
            raise OSError("no")
    fs.stream_cache_file = lambda *a, **k: _P("nocache")


def set_flags(threads, cudnn, tf32):
    import torch
    torch.set_num_threads(threads)
    torch.backends.cudnn.benchmark = bool(cudnn)
    try:
        torch.backends.cuda.matmul.allow_tf32 = bool(tf32)
        torch.backends.cudnn.allow_tf32 = bool(tf32)
        torch.set_float32_matmul_precision("high" if tf32 else "highest")
    except Exception as e:
        print("  tf32 设置失败:", e)


def frontend_probe(voice, text, prompt_text, ref_path):
    """单独量 frontend：文本 + 参考音 → 模型输入。"""
    import torch
    t0 = time.perf_counter()
    with torch.inference_mode():
        mi = voice.frontend.frontend_zero_shot(
            text, prompt_text, str(ref_path), voice.sample_rate, "")
    dt = time.perf_counter() - t0
    tok = mi.get("text") if isinstance(mi, dict) else None
    prompt_tok = mi.get("prompt_text") if isinstance(mi, dict) else None
    return {
        "ms": round(dt * 1000, 1),
        "text_tokens": int(tok.shape[-1]) if hasattr(tok, "shape") else None,
        "prompt_tokens": int(prompt_tok.shape[-1]) if hasattr(prompt_tok, "shape") else None,
    }


def run_text(text, style="cute", speed=1.0):
    picked = fs.pick_ref(text)
    if picked:
        ref_path, prompt = picked["path"], fs.STATE["params"]["prompt_prefix"] + picked["text"]
    else:
        sel = fs.STATE["manifest_styles"][style]
        ref_path = str(fs.PKG / sel["reference_audio"])
        prompt = fs.STATE["params"]["prompt_prefix"] + sel["reference_text"]
    sid = fs._spk_id(style, prompt, ref_path)
    if sid not in fs.STATE["voice"].frontend.spk2info:
        fs.STATE["voice"].add_zero_shot_spk(prompt, str(ref_path), sid)

    fe = frontend_probe(fs.STATE["voice"], fs.split_text(text)[0], prompt, ref_path)

    t0 = time.perf_counter()
    first = None
    n = 0
    audio = 0.0
    for ch in fs.synth_stream(text, {"style": style, "speed": speed}):
        if first is None:
            first = time.perf_counter() - t0
        n += 1
        audio += float(ch["dur"])
    total = time.perf_counter() - t0
    return {
        "chars": len(text), "chunks": n, "first": round(first or 0, 3),
        "total": round(total, 3), "audio": round(audio, 3),
        "rtf": round(total / audio, 3) if audio else None,
        "frontend": fe, "ref": os.path.basename(ref_path),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threads", default="4,8,12")
    ap.add_argument("--texts", default="default")
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    if not fs.load_model():
        print("模型加载失败：", fs.STATE.get("err"))
        return 1
    fs.use_style("cute")
    fs.STATE["manifest_styles"] = json.loads((fs.PKG / "manifest.json").read_text(encoding="utf-8-sig"))["styles"]
    no_cache()
    texts = TEXTS if args.texts == "default" else [args.texts]

    report = {"combos": []}
    for threads in [int(x) for x in str(args.threads).split(",")]:
        for cudnn in (False, True):
            for tf32 in (False, True):
                set_flags(threads, cudnn, tf32)
                tag = "threads=%d cudnn=%s tf32=%s" % (threads, int(cudnn), int(tf32))
                rec = {"tag": tag, "threads": threads, "cudnn": cudnn, "tf32": tf32, "runs": []}
                # 第一次调用带 kernel autotune，单独丢弃，不污染中位数
                try:
                    run_text(texts[1])
                except Exception as e:
                    print("%-32s 预热失败 %s" % (tag, e))
                    continue
                for t in texts:
                    try:
                        rec["runs"].append(run_text(t))
                    except Exception as e:
                        print("  失败:", e)
                if rec["runs"]:
                    rec["first_med"] = round(statistics.median([r["first"] for r in rec["runs"]]), 3)
                    rec["rtf_med"] = round(statistics.median([r["rtf"] for r in rec["runs"]]), 3)
                    rec["fe_med"] = round(statistics.median([r["frontend"]["ms"] for r in rec["runs"]]), 1)
                report["combos"].append(rec)
                print("%-34s 首块中位 %.3fs  RTF中位 %.3f  frontend中位 %.0fms"
                      % (tag, rec.get("first_med", 0), rec.get("rtf_med", 0), rec.get("fe_med", 0)))
                for r in rec["runs"]:
                    print("      %2d字 首块%.3f 总%.3f 音频%.2f RTF%.3f fe=%.0fms prompt_tok=%s"
                          % (r["chars"], r["first"], r["total"], r["audio"], r["rtf"] or 0,
                             r["frontend"]["ms"], r["frontend"]["prompt_tokens"]))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print("写入 " + args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
