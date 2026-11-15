// 模型包（packs）的回归测试：不启动 Electron，直接跑 ModelAdapter 的后端。
//
// 守的是「适配器一打开就是一屏红字」这一类假故障 —— 它们的共同点是
// **判定用的路径不对**，文件其实在，界面却说没有：
//   1) 覆盖层（本机配置覆盖内置包）只存 pet.json，模型本体在 base：
//      只查用户目录会误报「模型文件不存在」→ 满屏红 + 分数掉到 40 以下；
//   2) 反过来，模型文件真的被删掉时，必须报出来（不能因为 base 里恰好有同名文件就放行）；
//   3) 纯用户包（没有 base）缺 moc3，同样要报；
//   4) 体检分数：缺模型必须掉到 40 以下（按 60 分扣），不能给「84 分能用」的假象。
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { ModelAdapter } = require(path.join(ROOT, "src", "packs"));

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
function eq(actual, expect, what) {
  if (actual !== expect) throw new Error((what || "值") + " 期望 " + JSON.stringify(expect) + "，实际 " + JSON.stringify(actual));
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dfy-packs-"));
function w(p, body) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

// 一个「完整」的内置包：清单 + model3 + moc3 + 一张贴图
function makeBuiltin(dir, id) {
  w(path.join(dir, "pet.json"), JSON.stringify({
    petManifestVersion: 2, id, displayName: "测试模型", version: "1.0.0",
    renderer: "live2d", live2d: { model: id + ".model3.json", scale: 1 },
  }, null, 2));
  w(path.join(dir, id + ".model3.json"), JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: id + ".moc3",
      Textures: ["tex00.png"],
      Motions: {},
      Expressions: [],
    },
  }, null, 2));
  w(path.join(dir, id + ".moc3"), Buffer.alloc(64, 7));
  w(path.join(dir, "tex00.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

function adapter(builtinDir, userDir) {
  return new ModelAdapter({
    root: path.dirname(builtinDir), // ModelAdapter 内部会拼 <root>/model
    userDir,
    motionsFile: path.join(ROOT, "src", "motions.js"),
    getSettings: () => ({ activePack: "" }),
    patchSettings: () => { },
    log: () => { },
    logErr: () => { },
  });
}

const CASES = path.join(TMP, "cases");

// ── 1. 覆盖层：本机只有 pet.json，模型本体在内置包里 ──────────────────
const A = path.join(CASES, "a");
makeBuiltin(path.join(A, "model"), "dafeiyu");
w(path.join(A, "user", "dafeiyu", "pet.json"), JSON.stringify({
  petManifestVersion: 2, id: "dafeiyu", displayName: "大肥鱼（本机调过）", version: "1.0.0",
  renderer: "live2d", live2d: { model: "dafeiyu.model3.json", scale: 1 },
}, null, 2));

const adA = adapter(path.join(A, "model"), path.join(A, "user"));
const recA = adA.store.read("dafeiyu");

ok("覆盖层：origin 是 override", () => eq(recA.origin, "override", "origin"));
ok("覆盖层：base 指回内置包", () => {
  if (!recA.base) throw new Error("base 为空，覆盖层应该带上内置包目录");
  fs.accessSync(recA.base);
});
ok("覆盖层：模型文件在 base 里，不该判成 missingModel", () => eq(recA.missingModel, false, "missingModel"));
ok("覆盖层：适配器列表也不标缺模型", () => {
  const p = adA.list().packs.find((x) => x.id === "dafeiyu");
  if (!p) throw new Error("列表里没有 dafeiyu");
  eq(p.missingModel, false, "list().missingModel");
});
ok("覆盖层：体检不出 missing-model 红条", () => {
  const op = adA.open("dafeiyu");
  eq(op.missingModel, false, "open().missingModel");
  const bad = (op.diagnose.issues || []).filter((i) => /模型文件不存在/.test(i.message || ""));
  eq(bad.length, 0, "missing-model 条数");
});
ok("覆盖层：清单里的自定义显示名生效（说明读的是用户那份）", () => {
  const op = adA.open("dafeiyu");
  eq(op.manifest.displayName, "大肥鱼（本机调过）", "displayName");
});

// ── 2. 覆盖层 + 内置包的 moc3 真被删了 → 必须报 ────────────────────
const B = path.join(CASES, "b");
makeBuiltin(path.join(B, "model"), "dafeiyu");
w(path.join(B, "user", "dafeiyu", "pet.json"), JSON.stringify({
  petManifestVersion: 2, id: "dafeiyu", displayName: "大肥鱼", version: "1.0.0",
  renderer: "live2d", live2d: { model: "dafeiyu.model3.json", scale: 1 },
}, null, 2));
fs.unlinkSync(path.join(B, "model", "dafeiyu.model3.json"));

const adB = adapter(path.join(B, "model"), path.join(B, "user"));
const recB = adB.store.read("dafeiyu");
ok("base 真缺文件时仍然算 missingModel", () => eq(recB.missingModel, true, "missingModel"));
ok("base 真缺文件时，体检给出「模型文件不存在」", () => {
  const op = adB.open("dafeiyu");
  const bad = (op.diagnose.issues || []).filter((i) => /模型文件不存在/.test(i.message || ""));
  if (!bad.length) throw new Error("没有任何 missing-model 提示：\n" + JSON.stringify(op.diagnose.issues, null, 1));
  eq(bad[0].level, "error", "level");
});
ok("缺模型时分数掉到 40 以下（不能留 84 分的假象）", () => {
  const op = adB.open("dafeiyu");
  if (!(op.diagnose.score < 40)) throw new Error("score=" + op.diagnose.score);
});

// ── 3. 纯用户包（没有 base）只有 pet.json → 必须报 ─────────────────
const C = path.join(CASES, "c");
fs.mkdirSync(path.join(C, "model"), { recursive: true });
w(path.join(C, "user", "orphan", "pet.json"), JSON.stringify({
  petManifestVersion: 2, id: "orphan", displayName: "孤儿配置", version: "1.0.0",
  renderer: "live2d", live2d: { model: "orphan.model3.json", scale: 1 },
}, null, 2));

const adC = adapter(path.join(C, "model"), path.join(C, "user"));
ok("纯用户包只有 pet.json → missingModel", () => eq(adC.store.read("orphan").missingModel, true, "missingModel"));
ok("纯用户包缺模型时 open() 也不崩", () => {
  const op = adC.open("orphan");
  if (!op || !op.diagnose) throw new Error("open() 返回空");
  eq(op.missingModel, true, "open().missingModel");
});

// ── 4. 完整的内置包：不该报任何 disk 层红条 ───────────────────────
const D = path.join(CASES, "d");
makeBuiltin(path.join(D, "model"), "solo");
const adD = adapter(path.join(D, "model"), path.join(D, "user"));
ok("完整内置包：missingModel=false", () => eq(adD.store.read("solo").missingModel, false, "missingModel"));
ok("完整内置包：没有 disk 层 error", () => {
  const op = adD.open("solo");
  const diskErr = (op.diagnose.issues || []).filter((i) => i.layer === "disk" && i.level === "error");
  if (diskErr.length) throw new Error(JSON.stringify(diskErr, null, 1));
});

// importDir 现在是 async（复制走 fs.promises，主进程不再被几百兆的拷贝堵死），
// 所以从这里往下的场景都放进一个 async 函数里跑，断言本身还是同步的。
async function tail() {
// ── 5. 导入的原子性：中途失败不许在 models 里留半个包 ───────────────
// 用户导入两三百兆的整合包，拷到八成时磁盘满 / 权限不够 / 源文件被挪走，
// 以前会直接在 models/<id> 留半个包：没有 pet.json、缺贴图，可下一次扫描
// 照样把它列成一个模型（名字乱、参数全默认），再导入一次又得到 <id>-2。
// 现在先拷进 .importing-* 临时目录，成功才改名顶上；失败就清干净。
const E = path.join(CASES, "e");
makeBuiltin(path.join(E, "model"), "solo");
const eUser = path.join(E, "user");
const adE = adapter(path.join(E, "model"), eUser);
const eSrc = path.join(E, "srcpack");
makeBuiltin(eSrc, "mypack");

const eStore = adE.store;
const realCopy = eStore._copyTree.bind(eStore);
eStore._copyTree = () => { throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }); };
let eThrew = "";
try { await eStore.importDir(eSrc); } catch (e) { eThrew = String(e && e.message || e); }
eStore._copyTree = realCopy;

ok("导入中途失败会把错误抛给界面（不是静默吞掉）", () => {
  if (!/ENOSPC/.test(eThrew)) throw new Error("没抛错，或者抛的不是原始错误：" + eThrew);
});
ok("导入中途失败后，models 里没有留下半个包", () => {
  const left = fs.existsSync(eUser) ? fs.readdirSync(eUser) : [];
  if (left.length) throw new Error("userDir 里还有：" + left.join(", "));
});
ok("导入中途失败后，包列表里没有多出一个坏模型", () => {
  const ids = adE.list().packs.map((p) => p.id);
  if (ids.includes("mypack")) throw new Error("列表里出现了 mypack：" + ids.join(", "));
});

// 成功路径：没有 .importing-* 残留，包能正常读出来
const okOut = await eStore.importDir(eSrc);
ok("导入成功后包能读到，id 取自目录名", () => eq(okOut.id, "srcpack", "id"));
ok("导入成功后 userDir 里没有 .importing-* 临时目录残留", () => {
  const left = (fs.existsSync(eUser) ? fs.readdirSync(eUser) : []).filter((n) => n.startsWith(".importing-"));
  if (left.length) throw new Error("残留：" + left.join(", "));
});
ok("导入成功后 manifest 里记录了来源是 imported", () => {
  eq(eStore.read("srcpack").manifest.adapter.origin, "imported", "adapter.origin");
});

// ── 6. 超限不许静默截断：少复制的文件要在返回值里说出来 ─────────────
// 以前 _copyTree 遇到「目录太深 / 文件数到顶」直接 return：包照样装上、照样能选中，
// 只是少了几张贴图，界面上表现为模型发黑或者加载报错，而原因写在代码里没人看得到。
const G = path.join(CASES, "g");
makeBuiltin(path.join(G, "model"), "solo");
const gSrc = path.join(G, "deep");
makeBuiltin(gSrc, "deep");
let deepDir = gSrc;
for (let i = 0; i < 9; i++) {
  deepDir = path.join(deepDir, "lvl" + i);
  fs.mkdirSync(deepDir, { recursive: true });
}
fs.writeFileSync(path.join(deepDir, "buried.png"), "x");

const adG = adapter(path.join(G, "model"), path.join(G, "user"));
const outG = await adG.store.importDir(gSrc);
ok("目录太深时导入不失败（能装上的部分要装上）", () => { if (!outG || outG.id !== "deep") throw new Error("导入没成功"); });
ok("目录太深时返回值标了 truncated", () => { if (outG.truncated !== true) throw new Error("truncated=" + outG.truncated); });
ok("目录太深时 skipped 里写明了原因", () => {
  const hit = (outG.skipped || []).find((s) => /目录层数/.test(String(s && s.why)));
  if (!hit) throw new Error("skipped：" + JSON.stringify(outG.skipped).slice(0, 200));
});
ok("没用满上限的普通包 truncated 为 false", () => { if (outG.truncated && okOut.truncated) throw new Error("okOut 也标了 truncated"); });

// 最后一条专测「正常包不被误标」：前面场景 e 的 srcpack 是浅层正常包
ok("正常导入的包 truncated 为 false", () => { if (okOut.truncated !== false) throw new Error("truncated=" + okOut.truncated); });

// ── 7. 导入要报进度：几十秒的复制不能只写「正在导入…」 ──────────────
// 以前整个导入是同步 copyFileSync，主进程被堵死：窗口拖不动、托盘点不动，
// Windows 超时还会给窗口盖一层「未响应」。现在复制走 fs.promises，每 16 个文件
// 或每 200ms 推一次 {files, bytes}，结尾补一次 {done:true}。
const H = path.join(CASES, "h");
makeBuiltin(path.join(H, "model"), "solo");
const hSrc = path.join(H, "many");
makeBuiltin(hSrc, "many");
fs.mkdirSync(path.join(hSrc, "tex"), { recursive: true });
for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(hSrc, "tex", "t" + i + ".png"), "x");

const calls = [];
const adH = adapter(path.join(H, "model"), path.join(H, "user"));
const outH = await adH.store.importDir(hSrc, { onProgress: (x) => calls.push(x) });

ok("导入过程会报进度（不是闷头拷完）", () => {
  if (calls.length < 2) throw new Error("只收到 " + calls.length + " 次进度");
});
ok("进度里的文件数只增不减", () => {
  for (let i = 1; i < calls.length; i++) {
    if (calls[i].files < calls[i - 1].files) throw new Error("第 " + i + " 次倒退了");
  }
});
ok("最后一次进度标了 done", () => {
  const last = calls[calls.length - 1];
  if (!last || !last.done) throw new Error("最后一次没有 done：" + JSON.stringify(last));
});
ok("done 那次的文件数等于实际复制数", () => {
  const last = calls[calls.length - 1];
  if (last.files !== outH.files) throw new Error("进度 " + last.files + " ≠ 实际 " + outH.files);
});
ok("进度里带了字节数（界面要显示 MB）", () => {
  const last = calls[calls.length - 1];
  if (!(last.bytes > 0)) throw new Error("bytes=" + last.bytes);
});
ok("不给 onProgress 也能正常导入（别把回调写成必需）", () => {
  if (!outH || outH.id !== "many") throw new Error("导入失败");
});
}

// ── 收尾 ─────────────────────────────────────────────────────────
function finish() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  console.log("");
  console.log("test-packs：" + pass + " 通过" + (process.exitCode ? "，有失败" : "，0 失败"));
}

tail().then(finish).catch((e) => {
  console.error("  ✗ 异步段抛错：" + ((e && e.message) || e));
  process.exitCode = 1;
  finish();
});
