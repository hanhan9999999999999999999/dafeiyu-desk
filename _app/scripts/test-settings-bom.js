// 设置文件的「换个人机器也不会丢配置」回归：
// 很多人会拿记事本或 PowerShell 直接改 settings.json，那两步都会写进 UTF-8 BOM。
// JSON.parse 见到 BOM 会直接抛，于是整份设置被当成坏文件、备份走、回默认值——
// 用户看到的是「我的音色、快捷键、API Key 全没了」，而根因只是文件头三字节。
// 这个测试就是钉住那条「剥 BOM 再解析」。
const assert = require("assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Settings } = require("../src/settings");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("× " + name + (detail ? "  → " + detail : "")); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dafeiyu-bom-"));
const write = (dir, text) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), text, "utf8");
};
const read = (dir) => fs.readFileSync(path.join(dir, "settings.json"), "utf8");

// ── 1. 带 BOM 但内容合法：必须原样读进来，不许当坏文件 ──────────────
const d1 = path.join(tmp, "bom");
const body = JSON.stringify({ scale: 0.7, voiceId: "zh-CN-YunxiNeural", volume: 0.42, x: 1520, y: 300 });
write(d1, "\uFEFF" + body);
const s1 = new Settings(d1);
ok("带 BOM 的配置能读进来（不是坏文件）", s1.lastLoadError === null, s1.lastLoadError && s1.lastLoadError.error);
ok("scale 保住了", s1.get("scale") === 0.7, String(s1.get("scale")));
ok("voiceId 保住了", s1.get("voiceId") === "zh-CN-YunxiNeural", String(s1.get("voiceId")));
ok("volume 保住了", Math.abs(s1.get("volume") - 0.42) < 1e-9, String(s1.get("volume")));
ok("没生成 .bad 备份（说明根本没走坏文件分支）",
  !fs.readdirSync(d1).some((f) => f.includes(".bad-")), fs.readdirSync(d1).join(","));

// ── 2. patch 时重读盘上那份也要剥 BOM ─────────────────────────────
// 否则「另一个窗口写进 BOM」会把这次 patch 前的重读炸掉，回退成内存旧值。
const d2 = path.join(tmp, "bom-patch");
write(d2, JSON.stringify({ volume: 0.5, scale: 0.8 }));
const s2 = new Settings(d2);
write(d2, "\uFEFF" + JSON.stringify({ volume: 0.5, scale: 0.8, opacity: 0.6 }));
s2.patch({ volume: 0.9 });
ok("patch 前重读能跨过 BOM（opacity 被保留）", Math.abs(s2.get("opacity") - 0.6) < 1e-9, String(s2.get("opacity")));
ok("patch 自己那一个字段生效", Math.abs(s2.get("volume") - 0.9) < 1e-9, String(s2.get("volume")));

// ── 3. 真坏的文件仍然要备份 + 回默认值（这条不能因为剥 BOM 被改坏） ──
const d3 = path.join(tmp, "broken");
write(d3, "{ 这不是 JSON");
const s3 = new Settings(d3);
ok("真坏的配置仍有备份记录", !!(s3.lastLoadError && s3.lastLoadError.backup), JSON.stringify(s3.lastLoadError));
ok("真坏的配置回默认值", s3.get("scale") === 1, String(s3.get("scale")));
ok("备份文件确实落在盘上", !!(s3.lastLoadError && fs.existsSync(s3.lastLoadError.backup)));
ok("重写出来的文件不带 BOM", !read(d3).startsWith("\uFEFF"), "开头字节：" + JSON.stringify(read(d3).slice(0, 1)));

// ── 4. 读回来的东西一定还能再写、再读 ────────────────────────────────
const s4 = new Settings(d1);
s4.patch({ voiceId: "zh-CN-XiaoxiaoNeural" });
const s5 = new Settings(d1);
ok("写盘后重读仍然是同一个值", s5.get("voiceId") === "zh-CN-XiaoxiaoNeural", String(s5.get("voiceId")));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exitCode = fail ? 1 : 0;
