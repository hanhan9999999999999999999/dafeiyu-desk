// settings.js 的单元测试：不启动 Electron，只碰临时目录。
// 主要守住 sanitize 的边界：手改配置文件 / 旧版本 / 坏 JSON 都不能把程序带崩。
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");
const { Settings, DEFAULTS } = require("../src/settings.js");

let pass = 0;
function ok(name, fn) {
  try {
    fn();
    pass += 1;
    console.log("  ✓ " + name);
  } catch (e) {
    console.error("  ✗ " + name + "\n    " + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
}
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dafeiyu-settings-"));
}

console.log("settings.js 单元测试");

ok("新目录会生成默认配置，静音默认关", () => {
  const S = new Settings(tmp());
  assert.strictEqual(S.get("mute"), false);
  assert.strictEqual(S.get("hotkeyMute"), "CommandOrControl+Shift+Q");
  assert.strictEqual(S.get("version"), 2);
});

ok("数值会被夹到范围内，非法 URL 回默认", () => {
  const S = new Settings(tmp());
  const s = S.patch({ scale: 9, opacity: 0.01, fpsCap: 999, seeInterval: 0, volume: 2, bridgeUrl: "javascript:alert(1)" });
  assert.strictEqual(s.scale, 2);
  assert.strictEqual(s.opacity, 0.3);
  assert.strictEqual(s.fpsCap, 60);
  assert.strictEqual(s.seeInterval, 0.8);
  assert.strictEqual(s.volume, 1);
  assert.strictEqual(s.bridgeUrl, DEFAULTS.bridgeUrl);
});

ok("字符串字段被手改成数字/对象时回默认，不让 path.join 抛异常", () => {
  const S = new Settings(tmp());
  const s = S.patch({ cacheDir: 123, voiceId: { bad: true }, feiyuRef: null });
  assert.strictEqual(s.cacheDir, "");
  assert.strictEqual(s.voiceId, "");
  assert.strictEqual(s.feiyuRef, "");
});

ok("快捷键只收字母/数字/修饰键，空串表示禁用", () => {
  const S = new Settings(tmp());
  assert.strictEqual(S.patch({ hotkeyMute: "Ctrl+Shift+Q" }).hotkeyMute, "Ctrl+Shift+Q");
  assert.strictEqual(S.patch({ hotkeyMute: "中文键" }).hotkeyMute, DEFAULTS.hotkeyMute);
  assert.strictEqual(S.patch({ hotkeyMute: "" }).hotkeyMute, "");
});

ok("onnx 后端不会留下 CUDA 设备", () => {
  const S = new Settings(tmp());
  const s = S.patch({ rvcBackend: "onnx", rvcDevice: "cuda:0" });
  assert.strictEqual(s.rvcDevice, "dml");
});

ok("坏 JSON 会先备份再回默认，不覆盖原文件", () => {
  const dir = tmp();
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, "{ this is not json", "utf8");
  const S = new Settings(dir);
  assert.ok(S.lastLoadError && S.lastLoadError.backup);
  assert.ok(fs.existsSync(S.lastLoadError.backup));
  assert.strictEqual(S.get("mute"), false);
  assert.strictEqual(fs.readFileSync(S.lastLoadError.backup, "utf8"), "{ this is not json");
});

ok("patch 以磁盘为准合并，不会盖掉别的窗口刚写的字段", () => {
  const dir = tmp();
  const a = new Settings(dir);
  const b = new Settings(dir);
  a.patch({ scale: 1.4 });
  // b 的内存里还是旧值；它只改 fpsCap，不能把 a 写的 scale 打回去。
  const merged = b.patch({ fpsCap: 15 });
  assert.strictEqual(merged.scale, 1.4);
  assert.strictEqual(merged.fpsCap, 15);
});

console.log("\n结果：" + pass + " 通过" + (process.exitCode ? "，有失败" : "，0 失败"));
