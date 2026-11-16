// 配置层（src/settings.js）的规则回归：纯函数，不启动 Electron。
//
// 为什么单独写这一份：test-persist 只验了「音量、缩放重启还在」两项，
// 而设置里有六十多个键、十来条夹取与类型校验。这些规则一旦被改松，
// 表现是「手改配置能把她搞没」「换了版本设置被重置」这类只在别人机器上
// 才出现的事故，事后极难复现。所以直接拿 sanitize/migrate 喂边界值。
const assert = require("assert");
const { DEFAULTS, sanitize, migrate } = require("../src/settings");

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name + (detail ? "  → " + detail : "")); }
};
// 值相等就过，不等把两边都打出来（对象也看得懂）。
const same = (name, actual, expect) => {
  let ok = true, why = "";
  try { assert.deepStrictEqual(actual, expect); }
  catch (e) { ok = false; why = "期望 " + JSON.stringify(expect) + "，实际 " + JSON.stringify(actual); }
  check(name, ok, why);
};

console.log("[settings-schema] 配置层规则");

// ---------- 1. 默认值本身就是合法值 ----------
const d0 = sanitize({});
same("空配置 → 全套默认值", d0, DEFAULTS);
same("默认值再过一次 sanitize 不变（幂等）", sanitize(DEFAULTS), DEFAULTS);
same("输出键与 DEFAULTS 完全一致（不多不少）",
  Object.keys(d0).sort(), Object.keys(DEFAULTS).sort());

// 未知键不能漏进来：配置文件是用户能手改的，多塞一个键不该被带下去。
const extra = sanitize({ hackKey: "x", __evil: 1, constructor: "y" });
check("未知键被丢掉", !("hackKey" in extra) && !("__evil" in extra) && extra.constructor === Object,
  JSON.stringify(Object.keys(extra).filter((k) => !(k in DEFAULTS))));

// 返回值不能和 DEFAULTS 共用对象：改它一下就把全局默认值也改了（踩过）。
const t = sanitize({});
t.viewBox.h = 0.9;
same("返回值是深拷贝，改它不影响 DEFAULTS", DEFAULTS.viewBox.h, 0.4);

// ---------- 2. 数值：越界夹、非数回默认 ----------
same("scale 超过上限被夹到 2", sanitize({ scale: 5 }).scale, 2);
same("scale 低于下限被夹到 0.5", sanitize({ scale: 0.1 }).scale, 0.5);
same("scale 不是数字回默认 1", sanitize({ scale: "abc" }).scale, 1);
same("opacity 0 被抬到 0.3（不能全透明，否则人以为没启动）", sanitize({ opacity: 0 }).opacity, 0.3);
same("resolution 9 被夹到 3", sanitize({ resolution: 9 }).resolution, 3);
same("resolution 2.6 取整成 3", sanitize({ resolution: 2.6 }).resolution, 3);
same("fpsCap 5 被抬到 15", sanitize({ fpsCap: 5 }).fpsCap, 15);
same("volume 2 被夹到 1", sanitize({ volume: 2 }).volume, 1);
same("rvcPitch 99 被夹到 12", sanitize({ rvcPitch: 99 }).rvcPitch, 12);
same("rvcPitch -20 被夹到 -12", sanitize({ rvcPitch: -20 }).rvcPitch, -12);
same("rvcPitch 3.7 取整成 4", sanitize({ rvcPitch: 3.7 }).rvcPitch, 4);
same("seeInterval 0 被抬到 0.8", sanitize({ seeInterval: 0 }).seeInterval, 0.8);
same("seeGap 999 被夹到 60", sanitize({ seeGap: 999 }).seeGap, 60);
same("offsetRight -9999 被夹到 -2000", sanitize({ offsetRight: -9999 }).offsetRight, -2000);
same("x 不是数字 → null（位置交给锚点算）", sanitize({ x: "left" }).x, null);
same("x 3.7 取整成 4", sanitize({ x: 3.7 }).x, 4);

// ---------- 3. 布尔：不是 boolean 就当没写 ----------
same("alwaysOnTop 传字符串被忽略，留默认 true", sanitize({ alwaysOnTop: "no" }).alwaysOnTop, true);
same("alwaysOnTop 传 false 生效", sanitize({ alwaysOnTop: false }).alwaysOnTop, false);
same("mute 传 0 被忽略（0 不是 false）", sanitize({ mute: 0 }).mute, false);

// ---------- 4. 字符串：类型不对回默认，路径类要做形状校验 ----------
same("apiKey 传数字回空串", sanitize({ apiKey: 123 }).apiKey, "");
same("apiBase 不是 http(s) 回空串", sanitize({ apiBase: "file:///etc/passwd" }).apiBase, "");
same("bridgeUrl 不是 http(s) 回默认", sanitize({ bridgeUrl: "javascript:alert(1)" }).bridgeUrl, DEFAULTS.bridgeUrl);
same("自带桥接的 8898 原样保留（1.6.1 起不再被改写）",
  sanitize({ bridgeUrl: "http://127.0.0.1:8898" }).bridgeUrl, "http://127.0.0.1:8898");
same("局域网地址原样保留",
  sanitize({ bridgeUrl: "http://192.168.1.226:8899" }).bridgeUrl, "http://192.168.1.226:8899");
same("feiyuRefDir 不含斜杠 → 空（否则拼出全是错的路径）", sanitize({ feiyuRefDir: "语音" }).feiyuRefDir, "");
same("feiyuHome 含反斜杠就保留", sanitize({ feiyuHome: "D:\\feiyu" }).feiyuHome, "D:\\feiyu");
same("feiyuRef 被截到 120 字", sanitize({ feiyuRef: "x".repeat(500) }).feiyuRef.length, 120);

// ---------- 5. 模型包 id 会拼进路径和 URL，必须挡住穿越 ----------
same("activePack 带 ../ 被清空", sanitize({ activePack: "../../etc" }).activePack, "");
same("activePack 带大写被清空（只认小写）", sanitize({ activePack: "Dafeiyu" }).activePack, "");
same("activePack 合法值保留", sanitize({ activePack: "dafeiyu-2" }).activePack, "dafeiyu-2");

// ---------- 6. 快捷键：空串 = 主动禁用，非法字符 = 回默认 ----------
same("hotkeyMic 空串保留（用户主动关掉）", sanitize({ hotkeyMic: "" }).hotkeyMic, "");
same("hotkeyMic 没写 → 补默认键", sanitize({}).hotkeyMic, DEFAULTS.hotkeyMic);
same("hotkeySummon 含尖括号 → 回默认", sanitize({ hotkeySummon: "<script>" }).hotkeySummon, DEFAULTS.hotkeySummon);
same("hotkeyMute 合法写法保留", sanitize({ hotkeyMute: "Control+Alt+Q" }).hotkeyMute, "Control+Alt+Q");

// ---------- 7. 取景矩形 ----------
same("viewBox 越界被夹（h 最大 1、y 最大 1）", sanitize({ viewBox: { h: 9, y: 9 } }).viewBox, { h: 1, y: 1 });
same("viewBox 正常值四舍五入到 4 位",
  sanitize({ viewBox: { h: 0.412345, y: -0.023456 } }).viewBox, { h: 0.4123, y: -0.0235 });
same("viewBox 的 pack 合法时保留",
  sanitize({ viewBox: { h: 0.4, y: 0, pack: "dafeiyu" } }).viewBox.pack, "dafeiyu");
same("viewBox 的 pack 非法时去掉",
  sanitize({ viewBox: { h: 0.4, y: 0, pack: "../x" } }).viewBox.pack, undefined);
same("viewBox 传字符串整体回默认", sanitize({ viewBox: "big" }).viewBox, DEFAULTS.viewBox);

// ---------- 8. 枚举与语速 ----------
same("voiceOut 非法值回 feiyu", sanitize({ voiceOut: "gpt" }).voiceOut, "feiyu");
same("voiceOut 合法值保留", sanitize({ voiceOut: "tts" }).voiceOut, "tts");
same("feiyuStyle 非法回 cute", sanitize({ feiyuStyle: "angry" }).feiyuStyle, "cute");
same("feiyuSpeed 0 表示不干预，保留 0", sanitize({ feiyuSpeed: 0 }).feiyuSpeed, 0);
same("feiyuSpeed 0.2 被抬到 0.5（太慢听不清）", sanitize({ feiyuSpeed: 0.2 }).feiyuSpeed, 0.5);
same("feiyuSpeed 2 被夹到 1.5", sanitize({ feiyuSpeed: 2 }).feiyuSpeed, 1.5);
same("xttsSpeed 0.1 被抬到 0.6", sanitize({ xttsSpeed: 0.1 }).xttsSpeed, 0.6);
same("rvcBackend 非法回 onnx", sanitize({ rvcBackend: "trt" }).rvcBackend, "onnx");
same("onnx 后端配 cuda 设备被判不配套，改 dml", sanitize({ rvcBackend: "onnx", rvcDevice: "cuda:0" }).rvcDevice, "dml");
same("pth 后端配 dml 设备被判不配套，改 cuda:0", sanitize({ rvcBackend: "pth", rvcDevice: "dml" }).rvcDevice, "cuda:0");

// ---------- 9. 迁移 ----------
{
  const d = { version: 1, bridgeUrl: "http://127.0.0.1:8898/" };
  const changed = migrate(d);
  check("v1 配置被迁移（返回 true）", changed === true);
  same("迁移后 version 变 2", d.version, 2);
  same("迁移后 8898 原样保留（自带桥接又回来了）", d.bridgeUrl, "http://127.0.0.1:8898/");
  check("已经是 v2 时 migrate 不动（返回 false）", migrate({ version: 2 }) === false);
}

// ---------- 10. 坏输入不能让程序抛 ----------
for (const bad of [null, undefined, 0, "x", [], () => 1]) {
  let threw = false, out = null;
  try { out = sanitize(bad); } catch (e) { threw = true; }
  check("sanitize 遇到 " + String(bad && typeof bad === "object" ? "[]" : String(bad)) + " 不抛且回默认",
    !threw && out && out.scale === DEFAULTS.scale);
}

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
