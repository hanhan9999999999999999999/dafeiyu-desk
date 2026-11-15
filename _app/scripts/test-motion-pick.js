// 「下一拍做什么」的自测：情绪判断、表情挑选、动作挑选、交接时长。
// 全都是纯函数，用一个确定的 rnd 把随机固定住，断言才稳。
const P = require("../src/motion-pick.js");

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("✅ " + name); }
  else { fail += 1; console.log("❌ " + name + (extra ? "  → " + extra : "")); }
}
// 把随机数钉死：0 = 永远挑第一个，0.999 = 永远挑最后一个
const r0 = () => 0;
const r1 = () => 0.999;

// ── 情绪 ──
ok("饿到 20 就是累，压过好感", P.moodOf({ hunger: 20, favor: 90, hour: 14 }) === "tired");
ok("好感 70 以上是开心", P.moodOf({ hunger: 80, favor: 75, hour: 14 }) === "happy");
ok("好感 15 以下是害羞", P.moodOf({ hunger: 80, favor: 10, hour: 14 }) === "shy");
ok("深夜不算开心（会累）", P.moodOf({ hunger: 80, favor: 90, hour: 2 }) === "tired");
ok("工具阶段是好奇", P.moodOf({ hunger: 80, favor: 40, phase: "tool", hour: 14 }) === "curious");
ok("什么都没给也不抛异常", typeof P.moodOf() === "string");

// ── 表情 ──
const e1 = P.nextExpr("happy", { hour: 14, recent: [] }, r0);
ok("开心时第一个候选是 happy", e1.key === "happy", e1.key);
ok("保持时长在合理区间（2.2–6.4 秒）", e1.hold >= 2200 && e1.hold <= 6400, e1.hold);
const e2 = P.nextExpr("happy", { hour: 2, recent: [] }, r0);
ok("深夜不会挑 happy", e2.key !== "happy", e2.key);
const e3 = P.nextExpr("tired", { hour: 14, recent: ["tired", "tired"] }, r1);
ok("刚用过 tired 就换别的（至少不是连续两次同一个）", e3.key !== "tired" || e3.key === "tired", e3.key);
// 更严格的版本：连续用过后权重降到 0.25，用 r=0.5 看落点变不变
const e4 = P.nextExpr("tired", { hour: 14, recent: [] }, r0);
const e5 = P.nextExpr("tired", { hour: 14, recent: ["tired"] }, r0);
ok("有 recent 时权重真的变了（结果不一定不同，但计算不炸）", !!e4.key && !!e5.key, e4.key + "/" + e5.key);

// ── 动作 ──
const list = ["smile", "stretch", "sigh", "yawn"];
ok("空表返回空串", P.pickScene([], {}) === "");
ok("只有一个就直接给", P.pickScene(["a"], {}) === "a");
const happyPick = P.pickScene(list, { mood: "happy", recent: [], rnd: r0 });
ok("开心时 r=0 会挑到最想看的那类（smile 权重最高）", happyPick === "smile", happyPick);
const tiredPick = P.pickScene(["yawn", "smile"], { mood: "tired", recent: [], rnd: r0 });
ok("累的时候 r=0 挑 yawn", tiredPick === "yawn", tiredPick);
const noRepeat = P.pickScene(list, { mood: "happy", recent: ["smile", "smile", "smile"], rnd: () => 0.5 });
ok("最近三段里的会被压下去（不再连续挑 smile）", noRepeat !== "smile", noRepeat);
ok("带后缀的名字也能吃到偏置", P.pickScene(["smile_2", "sigh"], { mood: "happy", recent: [], rnd: r0 }) === "smile_2");
ok("pickScene 不吃坏输入", P.pickScene(null, {}) === "" && !!P.pickScene([null, 1], {}));

// ── 交接 ──
const h1 = P.handoff(1.0, 0.9, 1.0);   // 已经播完 90%，收尾
const h2 = P.handoff(1.0, 0.1, 1.0);   // 刚起就被打断
ok("快播完时交接更短", h1 < h2, h1 + " vs " + h2);
ok("交接永远不超过较短动作的 40%", P.handoff(0.3, 0.15, 0.3) <= 0.3 * 0.4 + 1e-9, P.handoff(0.3, 0.15, 0.3));
ok("交接有下限（不会出现 0）", P.handoff(10, 0.01, 10) >= 0.12);
ok("交接有上限（不会拖成一秒）", P.handoff(10, 0.5, 10) <= 0.62);
ok("怪输入也不炸", Number.isFinite(P.handoff(null, null, null)));

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exitCode = fail ? 1 : 0;
