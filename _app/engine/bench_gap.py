# -*- coding: utf-8 -*-
"""播放饥饿基准：量「音频块到达时刻」对比「播放进度」的领先量。

判定标准（这次要回答的唯一问题）：
  首块一到就开始播，之后第 k 块到达时，播放头已经走到哪里？
  lead_k = 到达时刻 - (首块到达 + 前面所有块的音频时长)
  lead_k < 0 → 播放头已经等米下锅，实际听到的是 lead_k 秒的静音 → 中段断音。
  所以 sum(max(0, -lead_k)) 就是「整段话里累计断掉多少秒」。

用法：
  python bench_gap.py --style cute [--fp16 0] [--strategies a,b,c,d] [--json out.json]
"""
import argparse
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

TEXTS = {
    "27字": "这个问题我想了一下。其实不难。你先把设置页里的语音引擎切到飞鱼。",
    "72字": ("主人回来啦。本鲸刚刚在海面上换完气，尾巴还湿漉漉的呢。"
             "你要是有话想说，慢慢讲就好，海水有的是时间。今天想聊点什么呢？"),
}


def no_op_empty_cache():
    import torch
    return torch.cuda.empty_cache


def split_cur(text):
    import feiyu_server as fs
    return fs.split_text(text)


def split_wide(text):
    import feiyu_server as fs
    return fs.split_text(text, first_max=30, next_max=60)


def split_none(text):
    """不切：整段交给 cosyvoice 自己的 text_normalize（60-80 token 一段）。"""
    return [text]


def run_variant(fs, text, splitter, prompt, ref_path, sid, patch_sleep=None, no_ec=False):
    import torch
    segments = splitter(text)
    events = []
    sr = int(fs.STATE["voice"].sample_rate)
    t0 = time.perf_counter()
    old_sleep = time.sleep
    empty_cache = torch.cuda.empty_cache

    if patch_sleep is not None:
        def fast_sleep(sec):
            return old_sleep(min(sec, patch_sleep))
        time.sleep = fast_sleep
    if no_ec:
        torch.cuda.empty_cache = lambda *a, **k: None
    try:
        for si, seg in enumerate(segments):
            with fs.STATE["lock"], torch.inference_mode():
                for x in fs.STATE["voice"].inference_zero_shot(
                    seg, prompt, str(ref_path), zero_shot_spk_id=sid,
                    stream=True, speed=1.0, text_frontend=True,
                ):
                    sp = x.get("tts_speech")
                    if sp is None:
                        continue
                    audio = sp.detach().float().cpu().numpy().reshape(-1)
                    if audio.size < 80:
                        continue
                    events.append({
                        "t": round(time.perf_counter() - t0, 3),
                        "dur": round(audio.size / float(sr), 3),
                        "seg": si,
                        "chars": len(seg),
                    })
    finally:
        time.sleep = old_sleep
        torch.cuda.empty_cache = empty_cache

    wall = time.perf_counter() - t0
    first = events[0]["t"] if events else None
    gaps, lead_at = [], []
    if events:
        play_end = events[0]["t"] + events[0]["dur"]
        for ev in events[1:]:
            lead = play_end - ev["t"]          # >0 还有余粮，<0 已经断流
            lead_at.append(round(lead, 3))
            if lead < 0:
                gaps.append(-lead)
            play_end = max(play_end, ev["t"]) + ev["dur"]
    audio_total = round(sum(e["dur"] for e in events), 2)
    return {
        "segments": len(segments),
        "chunks": len(events),
        "first": first,
        "audio": audio_total,
        "wall": round(wall, 2),
        "rtf": round(wall / audio_total, 3) if audio_total else None,
        "gap_total": round(sum(gaps), 2),
        "gap_max": round(max(gaps), 2) if gaps else 0.0,
        "leads": lead_at,
        "events": events,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", default="cute")
    ap.add_argument("--strategies", default="a,b,c,d")
    ap.add_argument("--texts", default="27字,72字")
    ap.add_argument("--json", default="")
    ap.add_argument("--cudnn", default="1")
    args = ap.parse_args()

    import torch
    torch.backends.cudnn.benchmark = args.cudnn == "1"

    import feiyu_server as fs
    fs.log("bench_gap: cudnn.benchmark=%s fp16=%s" % (args.cudnn, os.environ.get("FEIYU_FP16")))

    t_load = time.perf_counter()
    if not fs.load_model():
        fs.log("模型加载失败", fs.STATE.get("err") or "")
        return 2
    fs.use_style(args.style)
    torch.backends.cudnn.benchmark = args.cudnn == "1"
    load_ms = int((time.perf_counter() - t_load) * 1000)

    # 统一用「可爱」这条参考音，保证各策略只差在切分上
    picked = fs.pick_ref("可爱", prefer=None)
    if picked:
        ref_path, prompt, ref_name = picked["path"], fs.STATE["params"]["prompt_prefix"] + picked["text"], picked["name"]
    else:
        m = fs.read_manifest() or {}
        sel = m["styles"][args.style]
        ref_path = str(fs.PKG / sel["reference_audio"])
        prompt = fs.STATE["params"]["prompt_prefix"] + sel["reference_text"]
        ref_name = args.style
    sid = fs._spk_id(args.style, prompt, ref_path)
    if sid not in fs.STATE["voice"].frontend.spk2info:
        fs.STATE["voice"].add_zero_shot_spk(prompt, str(ref_path), sid)

    strategies = {
        "a": ("现有切分 13/30", split_cur, None, False),
        "b": ("放宽切分 30/60", split_wide, None, False),
        "c": ("整段不切", split_none, None, False),
        "d": ("放宽+快轮询+免empty_cache", split_wide, 0.02, True),
        "e": ("整段+快轮询+免empty_cache", split_none, 0.02, True),
        "f": ("放宽+只快轮询", split_wide, 0.02, False),
        "g": ("整段+只快轮询", split_none, 0.02, False),
        "h": ("放宽+只免empty_cache", split_wide, None, True),
    }
    want = [s.strip() for s in args.strategies.split(",") if s.strip()]
    texts = [t.strip() for t in args.texts.split(",") if t.strip()]

    # 预热一轮，避免第一次 cudnn autotune 污染第一组数据
    fs.log("预热中…")
    run_variant(fs, "预热一下。", split_none, prompt, ref_path, sid, patch_sleep=0.02, no_ec=True)

    out = {"style": args.style, "ref": ref_name, "load_ms": load_ms,
           "cudnn": args.cudnn, "results": {}}
    for key in want:
        if key not in strategies:
            continue
        label, splitter, psleep, noec = strategies[key]
        for tkey in texts:
            text = TEXTS.get(tkey) or tkey
            r = run_variant(fs, text, splitter, prompt, ref_path, sid, patch_sleep=psleep, no_ec=noec)
            out["results"]["%s|%s" % (key, tkey)] = dict(r, label=label, chars=len(text))
            fs.log("%-26s %-5s 句%2d 块%2d 首块%5.2fs 音频%5.1fs 墙钟%5.1fs RTF%5.2f 断流%5.2fs 最长%5.2fs" % (
                label, tkey, r["segments"], r["chunks"], r["first"] or -1, r["audio"],
                r["wall"], r["rtf"] or -1, r["gap_total"], r["gap_max"]))
            if r["leads"]:
                fs.log("   领先序列 %s" % r["leads"])

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
    print("BENCH_GAP " + json.dumps({"ok": True, "json": args.json, "load_ms": load_ms}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
