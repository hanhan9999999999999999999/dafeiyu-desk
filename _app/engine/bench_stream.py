#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""bench_stream.py —— 飞鱼流式合成的延迟基准（发布前必跑）

量的是「用户真正感受到的那一下」：
  first   从发出请求到第一块 WAV 到达（前端就是拿它开口的）
  gap     第一块到第二块之间的空档（空档大于块时长就会听见停顿）
  total   整段合成结束
  health  /health 的往返（前端每次合成前都要先 ping 一次）

用法：
  <venv>\\Scripts\\python.exe bench_stream.py                    # 默认 5 句 x 3 轮
  <venv>\\Scripts\\python.exe bench_stream.py --rounds 3 --warm 0
  <venv>\\Scripts\\python.exe bench_stream.py --json out.json

只读：不改服务端状态，除了一次可选的 /warm。
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8895"

# 真实场景里出现最多的几种长度：短应答、带逗号的中句、长段落。
TEXTS = [
    "嗯，我在呢。",
    "主人回来啦，本鲸刚刚在海面上换完气，尾巴还湿漉漉的呢。",
    "这个问题我想了一下，其实不难。你先把设置页里的语音引擎切到飞鱼，"
    "再点一下测速，它会告诉你这台机器首声要多久。要是超过三秒，就说明模型还在冷启动。",
]


def post(path, payload, timeout=180):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"content-type": "application/json"})
    return urllib.request.urlopen(req, timeout=timeout)


def get(path, timeout=30):
    return urllib.request.urlopen(BASE + path, timeout=timeout)


def stream_once(text, style="cute"):
    t0 = time.perf_counter()
    r = post("/tts_stream", {"text": text, "style": style})
    first = None
    marks = []
    durs = []
    chunks = 0
    meta = None
    done_ms = None
    for raw in r:
        line = raw.decode("utf-8").strip()
        if not line:
            continue
        ev = json.loads(line)
        if ev.get("t") == "meta":
            meta = ev
        elif ev.get("t") == "first":
            first = ev["ms"] / 1000.0
        elif ev.get("t") == "chunk":
            marks.append(time.perf_counter() - t0)
            durs.append(float(ev.get("dur") or 0))
            chunks += 1
        elif ev.get("t") == "done":
            done_ms = ev["ms"] / 1000.0
        elif ev.get("t") == "err":
            raise RuntimeError(ev.get("error"))
    total = time.perf_counter() - t0
    gap = (marks[1] - marks[0]) if len(marks) >= 2 else 0.0
    return {
        "chars": len(text), "chunks": chunks, "first": round(first or 0, 3),
        "gap": round(gap, 3), "total": round(total, 3),
        "audio": round(sum(durs), 3), "server_total": round(done_ms or 0, 3),
        "ready": bool(meta and meta.get("ready")), "device": (meta or {}).get("device"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--style", default="cute")
    ap.add_argument("--warm", type=int, default=1)
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    out = {"texts": [], "health": []}
    if args.warm:
        t0 = time.perf_counter()
        try:
            with post("/warm", {"style": args.style}) as r:
                j = json.loads(r.read().decode("utf-8"))
            out["warm"] = {"ms": int((time.perf_counter() - t0) * 1000), "resp": j}
            print("预热 %.1fs ready=%s" % (time.perf_counter() - t0, j.get("ok")))
        except Exception as e:
            print("预热失败：%s" % e, file=sys.stderr)

    for _ in range(5):
        t0 = time.perf_counter()
        with get("/health") as r:
            r.read()
        out["health"].append(round((time.perf_counter() - t0) * 1000, 1))
    hs = out["health"]
    print("/health 往返 ms：%s（中位 %.1f）" % (hs, statistics.median(hs)))

    for text in TEXTS:
        runs = []
        for _ in range(max(1, args.rounds)):
            try:
                runs.append(stream_once(text, args.style))
            except Exception as e:
                print("  失败：%s" % e, file=sys.stderr)
        if not runs:
            continue
        rec = {
            "text": text,
            "chars": len(text),
            "chunks": runs[0]["chunks"],
            "runs": runs,
            "first_med": round(statistics.median([r["first"] for r in runs]), 3),
            "gap_med": round(statistics.median([r["gap"] for r in runs]), 3),
            "total_med": round(statistics.median([r["total"] for r in runs]), 3),
        }
        out["texts"].append(rec)
        print("[%2d 字] 块=%d 首块 中位 %.3fs  块间 %.3fs  总 %.3fs  音频 %.2fs"
              % (rec["chars"], rec["chunks"], rec["first_med"], rec["gap_med"],
                 rec["total_med"], runs[0]["audio"]))
        for r in runs:
            print("        first %.3f gap %.3f total %.3f server %.3f ready=%s"
                  % (r["first"], r["gap"], r["total"], r["server_total"], r["ready"]))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print("结果写入 " + args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
