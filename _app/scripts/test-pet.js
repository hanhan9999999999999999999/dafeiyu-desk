// 养成数据的单元测试：不启动 Electron，直接把 pet.js 放进一个假的 localStorage 里跑。
// 重点守住三件容易回归的事：
//   1) 好感跨过 100 后等级仍然正确，旧存档不会被 clamp 回去；
//   2) 成就是「从计数推导」而不是另存一份，旧存档也要能算出进度；
//   3) 七日数据永远是 7 格、最后一格是今天。
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert");

const SRC = path.join(__dirname, "..", "src", "pet.js");
const KEY = "dafeiyu.pet";
const DAY = 24 * 60 * 60 * 1000;

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

function boot(seed) {
  const store = new Map();
  if (seed) store.set(KEY, JSON.stringify(seed));
  const sandbox = {
    window: {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    console,
    setTimeout: () => 0,
    clearTimeout: () => { },
    setInterval: () => 0,
    clearInterval: () => { },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), sandbox, { filename: "pet.js" });
  return sandbox.window.FishPet;
}

const ACT_IDS = ["eat", "rest", "sleep", "bath", "groom", "play", "stretch", "sun", "read", "sing", "movie", "walk", "daze"];

console.log("pet.js 单元测试");

// 1. 空存档：初始等级、七日长度
{
  const P = boot(null);
  ok("空存档的初始好感是 12，等级为「初见」", () => {
    const s = P.snapshot();
    assert.strictEqual(s.favor, 12);
    assert.strictEqual(s.level.name, "初见");
    assert.strictEqual(s.level.next, "熟悉");
    assert.strictEqual(s.level.need, 8);
  });
  ok("七日数据永远 7 格，最后一格是今天", () => {
    const w = P.week();
    assert.strictEqual(w.length, 7);
    assert.strictEqual(w[6].today, true);
    assert.strictEqual(new Set(w.map((d) => d.key)).size, 7);
  });
  ok("未知活动 / 没有活动时 tick 不会抛异常", () => {
    assert.strictEqual(P.startAct("nope").ok, false);
    assert.strictEqual(P.tickAct(), null);
  });
}

// 2. 一份「玩了很久」的旧存档：好感 130、成就覆盖大部分
{
  const now = Date.now();
  const P = boot({
    hunger: 70, energy: 70, clean: 70, favor: 130, mood: "calm",
    lastFed: now - 60000, lastPlay: now - 60000, lastPet: now - 60000,
    bornAt: now - 8 * DAY, totalFed: 10, totalPlay: 10, totalPet: 30, totalAct: 20,
    act: null, actDone: Object.fromEntries(ACT_IDS.map((id) => [id, 1])),
    actLog: [], foodMask: 15, today: {}, history: [], lastTick: now,
  });
  ok("好感 130 是「依赖」，下一级「默契」还差 70", () => {
    const lv = P.level();
    assert.strictEqual(lv.name, "依赖");
    assert.strictEqual(lv.next, "默契");
    assert.strictEqual(lv.need, 70);
    assert.ok(lv.progress > 0 && lv.progress < 1);
  });
  ok("旧存档能推导出 9/10 枚徽章", () => {
    const a = P.achievements();
    assert.strictEqual(a.total, 10);
    assert.strictEqual(a.got, 9);
    assert.strictEqual(a.list.find((x) => x.id === "favor-120").got, true);
    assert.strictEqual(a.list.find((x) => x.id === "favor-320").got, false);
  });
  ok("喂食会加饱腹/好感，并记进今天", () => {
    const before = P.snapshot();
    const r = P.feed(0);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.food, "小鱼干");
    const after = P.snapshot();
    assert.ok(after.hunger > before.hunger);
    assert.ok(after.favor > before.favor);
    assert.strictEqual(after.today.fed, 1);
  });
  ok("好感不会被 999 上限截断成 100", () => {
    P.grow(500);
    const lv = P.level();
    assert.ok(lv.favor >= 500);
    assert.strictEqual(lv.name, "本命");
  });
}

// 3. 徽章提醒：新拿到的说一次，旧存档升级后不补刷
{
  const P = boot(null);
  ok("第一次喂食会返回「第一口」，下一次互动不再重复", () => {
    const r = P.feed(0);
    assert.strictEqual(r.ok, true);
    assert.ok(r.unlocked.some((a) => a.id === "first-feed"));
    const r2 = P.pet();
    assert.ok(r2.ok);
    assert.ok(!r2.unlocked.some((a) => a.id === "first-feed"));
  });
}
{
  const now = Date.now();
  const P = boot({
    hunger: 70, energy: 70, clean: 70, favor: 130, mood: "calm",
    lastFed: now - 60000, lastPlay: now - 60000, lastPet: now - 60000,
    bornAt: now - 8 * DAY, totalFed: 26, totalPlay: 10, totalPet: 30, totalAct: 20,
    act: null, actDone: Object.fromEntries(ACT_IDS.map((id) => [id, 1])),
    actLog: [], foodMask: 15, today: {}, history: [], lastTick: now,
  });
  ok("旧存档没有 achSeen 时，已有的徽章不会在升级后补刷", () => {
    const r = P.feed(0);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.unlocked.length, 0);
  });
}



// 9. 等级跨越：喂食把好感从 19 推到 21，返回的 levelUp 要带新称号
{
  const P = boot(null);
  P.grow(7);
  const r = P.feed(0);
  ok("好感跨过 20 时，喂食结果带「熟悉」", () => {
    assert.strictEqual(r.ok, true);
    assert.ok(r.levelUp, "levelUp 应该存在");
    assert.strictEqual(r.levelUp.name, "熟悉");
  });
}

console.log("\n结果：" + pass + " 通过" + (process.exitCode ? "，有失败" : "，0 失败"));

