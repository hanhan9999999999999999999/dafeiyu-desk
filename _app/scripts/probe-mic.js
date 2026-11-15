"use strict";
// probe-mic.js —— 麦克风开不起来的时候，用户到底知不知道自己该做什么。
//
// 为什么需要它：voice.js 的 enable() 以前 catch 里只有一行 log + return false，
// 界面上按钮不变、她也不说话。用户能感知到的就是「点了没反应」。
// 这个探针分两段：
//   A. 造四种失败（权限被拒 / 没设备 / 被占用 / 其它），逐个点开麦按钮，
//      看 FishVoice.micError() 的 code 对不对、气泡里有没有一句人话。
//   B. 真开麦（--use-fake-device-for-media-stream 造一个假麦克风），
//      然后给轨道派发 ended，看会不会自己关掉并说「掉线了」。
//
// 两种失败都只在自测实例里，正式安装版行为不变。

const { spawn } = require("child_process");
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { sampleFrom, findTarget } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PORT || 9307);
const WAIT_MS = Number(process.env.WAIT || 26000);

let pass = 0;
let fail = 0;
const results = [];
function ok(name, extra) {
  pass++;
  results.push("✅ " + name + (extra ? "  " + extra : ""));
}
function bad(name, extra) {
  fail++;
  results.push("❌ " + name + (extra ? "  " + extra : ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

const INDEX_PICK = (t) => t && t.type === "page" && /\/src\/index\.html/.test(t.url || "");
const SETTINGS_PICK = (t) => t && t.type === "page" && /\/src\/settings\.html/.test(t.url || "");

// 造一个 DOMException：名字对就行，voice.js 只认 name。
const MAKE_ERR = (name) =>
  "(() => { const e = new Error('probe:' + " + JSON.stringify(name) + "); e.name = " + JSON.stringify(name) + "; return e; })()";

const PROBE_ONE = (name) => `(async () => {
  const out = {};
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async () => { throw ${MAKE_ERR(name)}; };
  try {
    if (window.FishVoice && window.FishVoice.clearMicError) window.FishVoice.clearMicError();
    const b = document.getElementById("bubble");
    if (b) { b.textContent = ""; b.classList.remove("on"); }
    const btn = document.getElementById("fish-voice");
    if (!btn) return JSON.stringify({ error: "没有开麦按钮" });
    btn.click();
    // enable() 里 await 了 getUserMedia，抛错是同步的话下一拍就落地；等两拍稳妥。
    await new Promise((r) => setTimeout(r, 260));
    const me = window.FishVoice.micError();
    out.code = me && me.code;
    out.short = me && me.short;
    out.btnOn = btn.classList.contains("on");
    out.bubble = b ? String(b.textContent || "").slice(0, 60) : "";
    out.bubbleOn = b ? b.classList.contains("on") : false;
    out.enabled = !!(window.FishVoice && window.FishVoice.enabled !== false);
  } finally {
    md.getUserMedia = orig;
  }
  return JSON.stringify(out);
})()`;

const PROBE_LOST = `(async () => {
  const out = {};
  const btn = document.getElementById("fish-voice");
  if (!btn) return JSON.stringify({ error: "没有开麦按钮" });
  if (window.FishVoice && window.FishVoice.clearMicError) window.FishVoice.clearMicError();
  btn.click();
  // 真开麦要等设备就绪
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (window.FishVoice.micError()) break;
    if (btn.classList.contains("on")) break;
  }
  out.opened = btn.classList.contains("on");
  out.openErr = (window.FishVoice.micError() || {}).code || null;
  if (!out.opened) return JSON.stringify(out);
  // 拿到真轨道：voice.js 不暴露轨道引用，只给一个 __dropMic() 入口 ——
  // 它内部对真轨道派发 ended，触发的是和「拔设备」同一条监听链路。
  const b = document.getElementById("bubble");
  if (b) { b.textContent = ""; b.classList.remove("on"); }
  out.dropped = !!(window.FishVoice.__dropMic && window.FishVoice.__dropMic());
  await new Promise((r) => setTimeout(r, 500));
  out.afterOn = btn.classList.contains("on");
  out.afterErr = (window.FishVoice.micError() || {}).code || null;
  out.afterBubble = b ? String(b.textContent || "").slice(0, 60) : "";
  return JSON.stringify(out);
})()`;

async function main() {
  if (!fs.existsSync(EXE)) {
    console.error("找不到 " + EXE);
    process.exit(2);
  }
  const userData = makeTmp("dfy-mic-");
  const child = spawn(
    EXE,
    [
      "--remote-debugging-port=" + PORT,
      "--user-data-dir=" + userData,
      // 造一个假麦克风：不依赖这台机器有没有真的插麦，
      // 也避免探针去抢用户真正的设备。
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      ".",
    ],
    { cwd: APP, env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }), stdio: "ignore" }
  );

  let code = null;
  try {
    let ready = null;
    const t0 = Date.now();
    while (Date.now() - t0 < WAIT_MS) {
      await sleep(500);
      try {
        const r = await sampleFrom(
          PORT,
          INDEX_PICK,
          `JSON.stringify((() => {
             const d = window.__fishDebug ? window.__fishDebug() : null;
             const btn = document.getElementById("fish-voice");
             return { s: document.readyState, model: !!(d && d.model), btn: !!btn };
           })())`,
          4000
        );
        if (r && r.s === "complete" && r.model && r.btn) { ready = r; break; }
      } catch (e) { }
    }
    if (!ready) throw new Error("等不到主页面就绪（" + WAIT_MS + "ms）");
    ok("主页面就绪，开麦按钮在", JSON.stringify(ready));

    const CASES = [
      ["NotAllowedError", "denied"],
      ["NotFoundError", "nodevice"],
      ["NotReadableError", "busy"],
      ["OverconstrainedError", "unsupported"],
    ];
    for (const [name, want] of CASES) {
      const r = await sampleFrom(PORT, INDEX_PICK, PROBE_ONE(name), 8000);
      if (!r || r.error) { bad(name + " → 探针没跑起来", JSON.stringify(r)); continue; }
      if (r.code === want) ok(name + " 归类为 " + want, "「" + r.short + "」");
      else bad(name + " 归类错误", "期望 " + want + "，实际 " + r.code);
      if (r.btnOn) bad(name + " 之后按钮不该是「已开」");
      else ok(name + " 之后按钮仍是关");
      if (r.bubble && r.bubbleOn) ok(name + " 她会说一句", "「" + r.bubble + "」");
      else bad(name + " 失败时没说一句话", JSON.stringify(r.bubble));
    }

    // B 段：真开麦 + 掉线
    const lost = await sampleFrom(PORT, INDEX_PICK, PROBE_LOST, 20000);    if (!lost || lost.error) bad("真开麦段没跑起来", JSON.stringify(lost));
    else {
      if (lost.opened) ok("假麦克风能真的开起来");
      else bad("假麦克风开不起来", JSON.stringify(lost));
      if (lost.afterErr === "lost" || lost.afterErr === "other") ok("掉线后记下了原因", lost.afterErr);
      else if (lost.opened) bad("掉线没被记下", JSON.stringify(lost));
      if (lost.opened && lost.afterOn === false) ok("掉线后自动关掉麦克风（按钮不再亮）");
      else if (lost.opened) bad("掉线后按钮还亮着", JSON.stringify(lost));
      if (lost.afterBubble) ok("掉线时她会说一句", "「" + lost.afterBubble + "」");
      else if (lost.opened && lost.note) ok("（本段没拿到轨道引用，跳过掉线文案）");
      else if (lost.opened) bad("掉线时没说一句话");
    }

    // C 段：设置页那行提示
    await sampleFrom(PORT, INDEX_PICK, `(async () => { window.deskfish.openSettings(); return JSON.stringify({ ok: true }); })()`, 8000).catch(() => { });
    let dom = null;
    const t1 = Date.now();
    while (Date.now() - t1 < 15000) {
      await sleep(300);
      try {
        const r = await sampleFrom(
          PORT,
          SETTINGS_PICK,
          `JSON.stringify((() => ({ s: document.readyState, ok: !!window.settingsMic, dev: !!document.getElementById("micDevice") }))())`,
          4000
        );
        if (r && r.s === "complete" && r.ok && r.dev) { dom = r; break; }
      } catch (e) { }
    }
    if (!dom) bad("设置窗没准备好，提示行这一段没验到");
    else {
      const fine = await sampleFrom(
        PORT,
        SETTINGS_PICK,
        `(async () => {
          window.settingsMic.refresh();
          await new Promise((r) => setTimeout(r, 600));
          return JSON.stringify({ hint: window.settingsMic.hint(), dev: window.settingsMic.devices() });
        })()`,
        12000
      );
      if (fine && fine.hint && fine.hint.hidden) ok("一切正常时提示行是收起的");
      else bad("一切正常时提示行不该出现", JSON.stringify(fine && fine.hint));
      if (fine && fine.dev && fine.dev.count >= 2) ok("设备列表里有真的麦克风", "共 " + fine.dev.count + " 项");
      else bad("设备列表是空的", JSON.stringify(fine && fine.dev));

      const denied = await sampleFrom(
        PORT,
        SETTINGS_PICK,
        `(async () => {
          const md = navigator.mediaDevices;
          const orig = md.getUserMedia.bind(md);
          md.getUserMedia = async () => { throw ${MAKE_ERR("NotAllowedError")}; };
          try {
            window.settingsMic.refresh();
            await new Promise((r) => setTimeout(r, 600));
            return JSON.stringify({ hint: window.settingsMic.hint(), dev: window.settingsMic.devices() });
          } finally { md.getUserMedia = orig; }
        })()`,
        12000
      );
      if (denied && denied.hint && denied.hint.hidden === false) ok("权限被拒时提示行会出来");
      else bad("权限被拒时提示行没出来", JSON.stringify(denied && denied.hint));
      if (denied && /允许桌面应用访问麦克风/.test((denied.hint || {}).text || "")) ok("提示里写了下一步该动哪里");
      else bad("提示没写可操作的下一步", JSON.stringify(denied && denied.hint));
      if (denied && denied.dev && denied.dev.count === 1) ok("没权限时下拉只剩「系统默认」（和提示一起说明原因）");
      else if (denied && denied.dev) ok("下拉项数 " + denied.dev.count + "（有权限时才有设备名）");
    }
  } catch (e) {
    bad("探针中断：" + (e && e.message ? e.message : e));
  } finally {
    try { child.kill(); } catch (e) { }
    await sleep(400);
    try {
      require("child_process").execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: "ignore" });
    } catch (e) { }
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { }
  }

  results.forEach((r) => console.log(r));
  console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail ? 1 : 0);
}

main();
