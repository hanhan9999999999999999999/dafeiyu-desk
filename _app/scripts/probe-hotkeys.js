"use strict";
/**
 * 快捷键真机探针（round 23）
 *
 * 要回答的问题：快捷键「注册上了」和「按下去真的会发生」之间隔着一层。
 * 这里用只在自测实例里存在的 __test:summon 跑一次真正的唤出动作，看窗口变成什么样。
 *
 * 已知要抓的：summonDock 里无条件 setAlwaysOnTop(true, "screen-saver")，
 * 用户把「总在最前」关掉之后按一次唤出热键，窗口就永久置顶了 —— 而没有任何路径会把它降回去
 * （applySettings 只在「这次改动里含 alwaysOnTop」时才同步）。
 */
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { sampleFrom, findTarget } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_PORT || 9303);

let pass = 0, fail = 0;
const bad = [];
const ok = (name, detail) => { pass++; console.log("✅ " + name + (detail ? "  " + detail : "")); };
const no = (name, detail) => { fail++; bad.push(name); console.log("❌ " + name + (detail ? "  " + detail : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanEnv(extra) {
  const e = Object.assign({}, process.env, extra || {});
  delete e.ELECTRON_RUN_AS_NODE;
  delete e.CHROME_CRASHPAD_PIPE_NAME;
  delete e.ELECTRON_NO_ATTACH_CONSOLE;
  return e;
}

const INDEX_PICK = (t) => t && t.type === "page" && /\/src\/index\.html/.test(t.url || "");
const SETTINGS_PICK = (t) => t && t.type === "page" && /\/src\/settings\.html/.test(t.url || "");

async function evalOn(pick, expr, ms) {
  return sampleFrom(PORT, pick, expr, ms || 15000);
}

const READY = `JSON.stringify({
  s: document.readyState,
  model: !!(window.__fishDebug && window.__fishDebug().model)
})`;

async function waitReady(pick, hasId) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await evalOn(pick, hasId
        ? `JSON.stringify({ s: document.readyState, has: !!document.getElementById(${JSON.stringify(hasId)}) })`
        : READY, 6000);
      if (r && r.s === "complete" && (hasId ? r.has : r.model)) return true;
    } catch (e) { }
    await sleep(400);
  }
  return false;
}

async function readWinState() {
  const r = await evalOn(INDEX_PICK, `(async () => JSON.stringify(await window.deskfish.testWinState()))()`, 8000);
  return r || null;
}

async function readHotkeyStatus() {
  const r = await evalOn(INDEX_PICK, `(async () => JSON.stringify(await window.deskfish.hotkeyStatus()))()`, 8000);
  return r || null;
}

(async () => {
  const ud = makeTmp("dfy-hotkey-");
  console.log("[hotkey] userData " + ud);
  const child = spawn(EXE, [
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + ud,
    ".",
  ], { cwd: APP, env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += String(d); });
  child.stderr.on("data", (d) => { out += String(d); });

  try {
    const ready = await waitReady(INDEX_PICK);
    if (!ready) { no("页面起来了", "20 秒内没等到 complete + model"); throw new Error("no page"); }
    ok("页面起来了");

    // ---- 1. 三条热键的注册真相 ----
    const st = await readHotkeyStatus();
    const hasStatus = !!(st && st.ok !== false && Array.isArray(st.bound));
    hasStatus ? ok("hotkey:status 可用", JSON.stringify(st)) : no("hotkey:status 可用");

    const s0 = await evalOn(INDEX_PICK, `(async () => JSON.stringify(await window.deskfish.settingsGet()))()`, 8000);
    const wantSummon = String((s0 && s0.hotkeySummon) || "");
    const bound = (st && st.bound) || [];
    wantSummon && bound.includes(wantSummon)
      ? ok("唤出键真的注册上了", wantSummon)
      : no("唤出键真的注册上了", "want=" + wantSummon + " bound=" + JSON.stringify(bound));
    bound.includes("CommandOrControl+Alt+S")
      ? ok("伸懒腰键也注册上了", "CommandOrControl+Alt+S")
      : no("伸懒腰键也注册上了");

    // ---- 2. 关掉「总在最前」，然后唤出一次 ----
    const before = await readWinState();
    if (!before || !before.ok) { no("能读到主窗口状态"); throw new Error("no win state"); }
    await evalOn(INDEX_PICK, `(async () => { await window.deskfish.settingsPatch({ alwaysOnTop: false }); return JSON.stringify({ ok: true }); })()`, 8000);
    await sleep(600);
    const afterOff = await readWinState();
    afterOff && afterOff.alwaysOnTop === false
      ? ok("关掉总在最前后窗口不置顶")
      : no("关掉总在最前后窗口不置顶", JSON.stringify(afterOff));

    const summoned = await evalOn(INDEX_PICK, `(async () => JSON.stringify(await window.deskfish.testSummon()))()`, 8000);
    summoned && summoned.ok ? ok("能触发一次唤出") : no("能触发一次唤出", JSON.stringify(summoned));
    await sleep(900);
    const afterSummon = await readWinState();
    // 这一条是本体：唤出之后不能把「总在最前」这个开关废掉。
    afterSummon && afterSummon.alwaysOnTop === false
      ? ok("唤出之后仍然不置顶（尊重「总在最前」关）", JSON.stringify({ alwaysOnTop: afterSummon.alwaysOnTop }))
      : no("唤出之后仍然不置顶（尊重「总在最前」关）", "alwaysOnTop=" + JSON.stringify(afterSummon && afterSummon.alwaysOnTop));

    // ---- 3. 开着「总在最前」时，唤出必须把它顶上来 ----
    await evalOn(INDEX_PICK, `(async () => { await window.deskfish.settingsPatch({ alwaysOnTop: true }); return JSON.stringify({ ok: true }); })()`, 8000);
    await sleep(600);
    await evalOn(INDEX_PICK, `(async () => JSON.stringify(await window.deskfish.testSummon()))()`, 8000);
    await sleep(700);
    const onSummon = await readWinState();
    onSummon && onSummon.alwaysOnTop === true
      ? ok("开着「总在最前」时唤出仍然置顶")
      : no("开着「总在最前」时唤出仍然置顶", JSON.stringify(onSummon));

    // ---- 4. 快捷键清空后，status 要如实反映 ----
    await evalOn(INDEX_PICK, `(async () => { await window.deskfish.settingsPatch({ hotkeySummon: "" }); return JSON.stringify({ ok: true }); })()`, 8000);
    await sleep(700);
    const st2 = await readHotkeyStatus();
    const b2 = (st2 && st2.bound) || [];
    const s1 = await evalOn(INDEX_PICK, `(async () => JSON.stringify(await window.deskfish.settingsGet()))()`, 8000);
    (s1 && s1.hotkeySummon === "") ? ok("清空唤出键之后设置里是空的") : no("清空唤出键之后设置里是空的", JSON.stringify(s1 && s1.hotkeySummon));
    b2.filter((a) => a !== "CommandOrControl+Alt+S").length === 0 || b2.length < bound.length
      ? ok("清空后 bound 里少了那个键", JSON.stringify(b2))
      : no("清空后 bound 里少了那个键", JSON.stringify(b2));

    // ---- 5. 同一个键给两个功能：主进程只保留一个，界面文案不能说是「别的软件占的」 ----
    await evalOn(INDEX_PICK, `(async () => { const r = await window.deskfish.settingsPatch({ hotkeySummon: "CommandOrControl+Shift+M", hotkeyMic: "CommandOrControl+Shift+M" }); return JSON.stringify(r || {}); })()`, 8000);
    await sleep(800);
    const st3 = await readHotkeyStatus();
    const dup = st3 && Array.isArray(st3.skipped) && st3.skipped.length > 0;
    dup ? ok("同一个键撞车时 status 里有 skipped", JSON.stringify(st3.skipped)) : no("同一个键撞车时 status 里有 skipped", JSON.stringify(st3));

    const logs = out;
    /唤出热键已注册/.test(logs) ? ok("run.log 里有注册记录") : no("run.log 里有注册记录");
    /热键注册异常/.test(logs) ? no("注册过程没有异常") : ok("注册过程没有异常");

    // 先关一次再开：refreshHotkeyStatus 只在初始化 / 保存 / 导入时跑，
    // 设置窗要是早在撞车之前就开着，读到的是旧文案（第一版就踩了这个）。
    await evalOn(INDEX_PICK, `(async () => { try { window.deskfish.closeSettings(); } catch (e) { } return JSON.stringify({ ok: true }); })()`, 8000);
    await sleep(500);
    const settingsWinOk = await (async () => {
      await evalOn(INDEX_PICK, `(async () => { window.deskfish.openSettings(); return JSON.stringify({ ok: true }); })()`, 8000);
      return waitReady(SETTINGS_PICK, "hotkeyResult");
    })();
    settingsWinOk ? ok("设置窗打开且热键状态区在") : no("设置窗打开且热键状态区在");
    if (settingsWinOk) {
      const txt = await evalOn(SETTINGS_PICK, `JSON.stringify((document.getElementById("hotkeyResult")||{}).textContent||"")`, 8000);
      /占用|已生效|空着|同一个键/.test(txt || "") ? ok("热键状态真的有文案", String(txt).slice(0, 60)) : no("热键状态真的有文案", JSON.stringify(txt));
      // 撞车那次的文案不该把责任推给「别的软件」，而且两个功能不能都说「已生效」
      const blame = /被别的软件占用/.test(txt || "");
      blame && dup ? no("撞车时别说是「别的软件占用」", String(txt).slice(0, 90)) : ok("撞车时别说是「别的软件占用」");
      const saysDup = /同一个键/.test(txt || "");
      dup ? (saysDup ? ok("撞车时文案说是「同一个键」", String(txt).slice(0, 90)) : no("撞车时文案说是「同一个键」", String(txt).slice(0, 90)))
          : ok("撞车时文案说是「同一个键」（未造出撞车，跳过）");
      const claimsBoth = /开麦 Ctrl \+ Shift \+ M/.test(txt || "") && /唤出 Ctrl \+ Shift \+ M/.test(txt || "");
      dup && claimsBoth ? no("撞车时不能两个功能都说已生效", String(txt).slice(0, 90)) : ok("撞车时不能两个功能都说已生效");
    }
  } catch (e) {
    no("探针跑完不抛异常", String(e && e.message || e));
  } finally {
    try { child.kill(); } catch (e) { }
    await sleep(500);
    try { spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) { }
    await sleep(800);
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { }
  }

  console.log("");
  console.log("结果：" + pass + " 通过，" + fail + " 失败");
  if (fail) { console.log("失败项：" + bad.join(" / ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
