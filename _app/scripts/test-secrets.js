// 密钥静态加密回归（P1-4）
//
// 竞品/审计里最容易被问的一句是「用户填的 API Key 存在哪」。
// 这份测试把承诺钉成可执行的断言：
//   1. 系统密钥库可用时，settings.json 里不能出现密钥明文
//   2. 换成新进程（新实例）还读得回来
//   3. 密钥库不可用 / 解不开时，既不假装加密，也不能把密文弄丢
//   4. 密文不走 sanitize 的字段规则（seeKey 那条 400 字符截断会毁掉密文）
//
// 用假 crypto（不是 Windows DPAPI），因为它只关心「进什么出什么」，
// 真 DPAPI 的行为在真机上由 probe 验。
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { Settings, SECRET_KEYS } = require("../src/settings.js");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log("✅ " + name);
  } catch (e) {
    fail++;
    console.log("❌ " + name + "  → " + String((e && e.message) || e));
  }
};

const dirs = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-sec-"));
  dirs.push(d);
  return d;
};

// 假加密：前缀 + base64，解不开时返回 null（模拟换账户/换机器）
const crypto = {
  encrypt: (v) => "safe1:" + Buffer.from("X:" + v, "utf8").toString("base64"),
  decrypt: (b) => (b.startsWith("safe1:") ? Buffer.from(b.slice(6), "base64").toString("utf8").slice(2) : null),
};
const readFile = (d) => fs.readFileSync(path.join(d, "settings.json"), "utf8");
const parseFile = (d) => JSON.parse(readFile(d));

// ① 没有加密器：明文落盘，并且如实标成 plaintext（不假装安全）
check("没有加密器时按明文保存，状态是 plaintext", () => {
  const d = tmp();
  const s = new Settings(d);
  assert.strictEqual(s.secureState, "plaintext");
  s.patch({ apiKey: "sk-plain-AAAA", seeKey: "vk-plain-BBBB" });
  const disk = readFile(d);
  assert.ok(disk.includes("sk-plain-AAAA"), "明文应在盘上（降级路径）");
  assert.strictEqual(s.secureState, "plaintext");
});

// ② 挂上加密器：迁移成密文，明文消失
check("挂上加密器后一次性迁移，明文不再落盘", () => {
  const d = tmp();
  const s = new Settings(d);
  s.patch({ apiKey: "sk-live-1234567890", seeKey: "vk-live-abcdef" });
  const state = s.attachCrypto(crypto);
  assert.strictEqual(state, "encrypted");
  const disk = readFile(d);
  const obj = JSON.parse(disk);
  assert.ok(!/sk-live-1234567890|vk-live-abcdef/.test(disk), "盘上不该再有明文");
  assert.ok(obj.secure && obj.secure.apiKey, "密文应写在 secure.apiKey");
  assert.ok(!("apiKey" in obj), "顶层不该再留 apiKey 字段");
  assert.strictEqual(s.get("apiKey"), "sk-live-1234567890", "内存里仍是明文");
});

// ③ 新实例（等同重启）读回原文
check("新实例带加密器能解回原文", () => {
  const d = tmp();
  new Settings(d).attachCrypto(crypto);
  const a = new Settings(d, crypto);
  a.patch({ apiKey: "sk-roundtrip-42", seeKey: "vk-roundtrip-43" });
  const b = new Settings(d, crypto);
  assert.strictEqual(b.secureState, "encrypted");
  assert.strictEqual(b.get("apiKey"), "sk-roundtrip-42");
  assert.strictEqual(b.get("seeKey"), "vk-roundtrip-43");
});

// ④ 没挂加密器就重载：locked，值空，但密文不许被 save 抹掉
check("密钥库缺席时置 locked，且不销毁密文", () => {
  const d = tmp();
  new Settings(d).attachCrypto(crypto).valueOf();
  const a = new Settings(d, crypto);
  a.patch({ apiKey: "sk-locked-999" });
  const locked = new Settings(d);          // 没有 crypto
  assert.strictEqual(locked.secureState, "locked");
  assert.strictEqual(locked.get("apiKey"), "");
  locked.patch({ volume: 0.5 });           // 触发一次 save
  assert.ok(readFile(d).includes("safe1:"), "锁定状态下保存不能把密文删掉");
  const again = new Settings(d, crypto);
  assert.strictEqual(again.get("apiKey"), "sk-locked-999", "恢复加密器后密钥还在");
});

// ⑤ 解不开：error + 原因 + 密文保留
check("解不开时标 error、给原因、密文不被覆盖", () => {
  const d = tmp();
  new Settings(d).attachCrypto(crypto);
  const a = new Settings(d, crypto);
  a.patch({ apiKey: "sk-broken-777" });
  const b = new Settings(d, { encrypt: crypto.encrypt, decrypt: () => null });
  assert.strictEqual(b.secureState, "error");
  assert.ok(b.secureError.indexOf("重新填写") >= 0, "应给出可读原因，实际：" + b.secureError);
  assert.strictEqual(b.get("apiKey"), "");
  b.patch({ scale: 1.1 });
  assert.ok(readFile(d).includes("safe1:"), "解不开也不许把密文覆盖掉");
});

// ⑥ patch 其它字段：密钥必须还在（走 _readDisk 解密再合并）
check("patch 其它字段不会把密钥冲掉", () => {
  const d = tmp();
  new Settings(d).attachCrypto(crypto);
  const s = new Settings(d, crypto);
  s.patch({ apiKey: "sk-keep-888", seeKey: "vk-keep-889" });
  s.patch({ volume: 0.33, scale: 1.2 });
  const s2 = new Settings(d, crypto);
  assert.strictEqual(s2.get("apiKey"), "sk-keep-888");
  assert.strictEqual(s2.get("seeKey"), "vk-keep-889");
  assert.strictEqual(s2.get("volume"), 0.33);
});

// ⑦ 清空 = 删除密文
check("清空密钥后盘上不再保留该密文", () => {
  const d = tmp();
  new Settings(d).attachCrypto(crypto);
  const s = new Settings(d, crypto);
  s.patch({ apiKey: "sk-clear-1", seeKey: "vk-clear-2" });
  s.patch({ apiKey: "" });
  const obj = parseFile(d);
  assert.ok(!obj.secure || !obj.secure.apiKey, "apiKey 的密文应被删除");
  assert.ok(obj.secure && obj.secure.seeKey, "没清的那一个要留着");
});

// ⑧ 长密钥：seeKey 的 400 字符截断只作用于明文输入，密文不受影响
check("超过 400 字符的密钥也能完整加解密", () => {
  const d = tmp();
  new Settings(d).attachCrypto(crypto);
  const s = new Settings(d, crypto);
  const longKey = "sk-" + "A".repeat(1200);
  s.patch({ apiKey: longKey });
  const s2 = new Settings(d, crypto);
  assert.strictEqual(s2.get("apiKey").length, longKey.length);
  assert.strictEqual(s2.get("apiKey"), longKey);
});

// ⑨ 迁移只做一次：重复构造不应重写文件
check("已经加密的文件再启动不会重写", () => {
  const d = tmp();
  new Settings(d).attachCrypto(crypto);
  const s = new Settings(d, crypto);
  s.patch({ apiKey: "sk-stable-5" });
  const before = readFile(d);
  const t0 = fs.statSync(path.join(d, "settings.json")).mtimeMs;
  new Settings(d, crypto);
  const after = readFile(d);
  assert.strictEqual(after, before, "内容不该变");
  assert.strictEqual(fs.statSync(path.join(d, "settings.json")).mtimeMs, t0, "不该重新落盘");
});

// ⑩ secure 区只认 SECRET_KEYS：往里塞别的键不生效
check("secure 区不接受未知字段", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "settings.json"), JSON.stringify({
    scale: 1,
    secure: { apiKey: crypto.encrypt("sk-known-3"), evil: crypto.encrypt("x"), volume: crypto.encrypt("9") },
  }), "utf8");
  const s = new Settings(d, crypto);
  assert.strictEqual(s.get("apiKey"), "sk-known-3");
  assert.strictEqual(s.get("volume"), 0.85, "volume 不能被 secure 区改写");
  assert.strictEqual(SECRET_KEYS.length, 2);
});

// ⑪ 坏文件仍然走「备份 + 回默认」，加密不改变这条兜底
check("坏 JSON 仍然先备份再回默认", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "settings.json"), "{ 这不是 json", "utf8");
  const s = new Settings(d, crypto);
  assert.ok(s.lastLoadError && s.lastLoadError.backup, "应留下备份路径");
  assert.ok(fs.existsSync(s.lastLoadError.backup));
  assert.strictEqual(s.get("scale"), 1);
});

for (const d of dirs) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { }
}

console.log("");
console.log("结果：" + pass + " 通过，" + fail + " 失败");
if (fail) process.exitCode = 1;
