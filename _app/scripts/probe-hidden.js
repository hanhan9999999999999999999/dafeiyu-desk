"use strict";
// 自测窗口「真的看不见」的运行时验收。
//
// 背景：脚本一跑就有一堆窗口弹到主人桌面上，把他正在用的东西顶掉，他只能去关进程。
// 现在自测统一走 FISH_TEST_HIDDEN=1：窗口照常创建（不然 fps 会被 Chromium 压到 1），
// 但做成 alpha=0 的分层窗口 + 点击穿透 + 不进任务栏。
//
// 这个脚本量的就是那句话本身：枚举该进程的所有可见顶层窗口，逐个读 Win32 的
// GetLayeredWindowAttributes，要求 alpha 必须是 0。alpha=255 就是「又挡住了」。
//
// 用法：node scripts/probe-hidden.js [--wait 11000] [--keep]
// 退出码：0 = 全部透明（看不见）；1 = 有窗口不透明；2 = 起不来。

const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const WAIT_MS = Number(arg("wait", "11000"));
const KEEP = argv.includes("--keep");

const PS = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -TypeDefinition @'",
  "using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;",
  "public class DfyWin {",
  "  public delegate bool EnumProc(IntPtr h, IntPtr l);",
  "  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);",
  "  [DllImport(\"user32.dll\")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);",
  "  [DllImport(\"user32.dll\")] public static extern bool GetLayeredWindowAttributes(IntPtr h, out uint color, out byte alpha, out uint flags);",
  "  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h);",
  "  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);",
  "  public static List<string> Scan(int want) {",
  "    var outp = new List<string>();",
  "    EnumWindows((h, l) => {",
  "      int pid; GetWindowThreadProcessId(h, out pid);",
  "      if (pid == want && IsWindowVisible(h)) {",
  "        var sb = new StringBuilder(256); GetWindowTextW(h, sb, 256);",
  "        if (sb.Length > 0) {",
  "          uint c; byte a = 255; uint f = 0;",
  "          bool ok = GetLayeredWindowAttributes(h, out c, out a, out f);",
  "          outp.Add(sb.ToString() + \"\\t\" + (ok ? a.ToString() : \"n/a\"));",
  "        }",
  "      }",
  "      return true;",
  "    }, IntPtr.Zero);",
  "    return outp;",
  "  }",
  "}",
  "'@",
  "$rows = @()",
  "foreach ($p in (Get-Process -Name electron -ErrorAction SilentlyContinue)) {",
  "  foreach ($r in [DfyWin]::Scan($p.Id)) { $rows += ($p.Id.ToString() + \"`t\" + $r) }",
  "}",
  "$rows -join \"`n\"",
].join("\n");

function scan() {
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", PS], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  const rows = [];
  for (const line of String(out).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split("\t");
    if (parts.length < 3) continue;
    rows.push({ pid: Number(parts[0]), title: parts[1], alpha: parts[2] });
  }
  return rows;
}

function main() {
  const ud = path.join(ROOT, "_tmp", "hidden-probe-" + Date.now());
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  for (const k of ["ELECTRON_RUN_AS_NODE", "CHROME_CRASHPAD_PIPE_NAME", "ELECTRON_NO_ATTACH_CONSOLE"]) delete env[k];

  const child = spawn(path.join(ROOT, "runtime", "electron.exe"),
    ["--user-data-dir=" + ud, "."], { cwd: ROOT, env, stdio: "ignore", windowsHide: true });

  setTimeout(() => {
    let rows = [];
    try { rows = scan(); } catch (e) { console.log("查询失败：" + e.message); }

    console.log("可见顶层窗口 " + rows.length + " 个：");
    for (const r of rows) console.log("  pid " + r.pid + "  " + JSON.stringify(r.title) + "  alpha=" + r.alpha);

    const opaque = rows.filter((r) => r.alpha !== "0");
    console.log("");
    if (!KEEP) {
      try { spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) { }
    }
    const cleanup = () => {
      try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { }
    };

    if (rows.length === 0) {
      console.log("⚠ 没抓到任何可见窗口——可能是还没起来，加大 --wait 再看");
      setTimeout(() => { cleanup(); process.exit(2); }, 600);
      return;
    }
    if (opaque.length) {
      console.log("❌ 有窗口不是全透明，会挡住主人：" + opaque.map((r) => r.title + "(alpha=" + r.alpha + ")").join(", "));
      setTimeout(() => { cleanup(); process.exit(1); }, 600);
      return;
    }
    console.log("✅ 所有窗口 alpha=0 + 点击穿透 → 主人看不见也点不到，跑测试不再抢屏");
    setTimeout(() => { cleanup(); process.exit(0); }, 600);
  }, WAIT_MS);
}

main();
