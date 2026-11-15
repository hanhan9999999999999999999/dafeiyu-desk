// 冒烟探针（主进程）：把托盘/右键的两条快捷互动真跑一遍，再按 Esc 关掉相处档案。
// 由 smoke-electron.js 的 --main-eval-file 执行；返回 JSON 字符串给 scripts/test-ui.js 断言。
(async () => {
  const req = typeof require === "function" ? require : process.mainModule.require.bind(process.mainModule);
  const fs = req("fs");
  const path = req("path");
  const { BrowserWindow } = req("electron");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const main = wins.find((w) => /index\.html/i.test(w.webContents.getURL())) || wins[0];
  const profile = wins.find((w) => /profile\.html/i.test(w.webContents.getURL()));
  if (!main) return JSON.stringify({ ok: false, why: "no main window" });

  const readBubble = () => main.webContents.executeJavaScript(
    "(()=>{const b=document.getElementById('bubble');return b?{text:b.textContent.replace(/\\s+/g,' ').trim(),cls:b.className,role:b.getAttribute('role'),live:b.getAttribute('aria-live'),atomic:b.getAttribute('aria-atomic')}:null;})()"
  );

  if (!profile) return JSON.stringify({ ok: false, why: "profile window not open" });

  // 留一张档案窗口的实拍图给人工复核（_shots 已在 .gitignore 里）。
  let shot = null;
  try {
    const img = await profile.webContents.capturePage();
    const dir = path.join(process.cwd(), "_shots");
    fs.mkdirSync(dir, { recursive: true });
    shot = path.join(dir, "profile-ui.png");
    fs.writeFileSync(shot, img.toPNG());
  } catch (e) {
    shot = "capture failed: " + String((e && e.message) || e);
  }

  const before = await readBubble();
  const a11y = await main.webContents.executeJavaScript(
    "(()=>{const i=document.getElementById('dockInput');const e=document.getElementById('err');const b=document.getElementById('bubble');return {inputLabel:i?i.getAttribute('aria-label'):null,errRole:e?e.getAttribute('role'):null,errLive:e?e.getAttribute('aria-live'):null,bubbleLive:b?b.getAttribute('aria-live'):null,bubbleRole:b?b.getAttribute('role'):null};})()"
  );
  main.webContents.send("pet:quick", { kind: "feed", idx: 0 });
  await sleep(1500);
  const afterFeed = await readBubble();

  // 立刻再喂一次：预期得到冷却/吃饱的说明，而不是毫无反应。
  main.webContents.send("pet:quick", { kind: "feed", idx: 0 });
  await sleep(900);
  const afterCooldown = await readBubble();

  main.webContents.send("pet:quick", { kind: "pet" });
  await sleep(900);
  const afterPet = await readBubble();

  // Esc：主进程 sendInputEvent 在无真实焦点的自动化窗口里不生效，
  // 这里直接触发渲染进程的 keydown，验证的是产品里的处理器确实接上了。
  let escClosed = false;
  try {
    await profile.webContents.executeJavaScript(
      "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
    );
    await sleep(800);
    escClosed = !BrowserWindow.getAllWindows().some(
      (w) => !w.isDestroyed() && /profile\.html/i.test(w.webContents.getURL())
    );
  } catch (e) {
    escClosed = "error: " + String((e && e.message) || e);
  }

  // ---- 养成面板：Esc 能关，但正在输入时不抢 ----
  let panelOpened = false;
  let escWhileTypingKeptOpen = null;
  let escAfterBlurClosed = null;
  let panelA11y = null;
  let tabFocus = null;
  let bridgeTest = null;
  try {
    await main.webContents.executeJavaScript("window.deskfish.openPetPanel()");
    let panel = null;
    for (let i = 0; i < 20 && !panel; i++) {
      await sleep(100);
      panel = BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed() && /petpanel\.html/i.test(w.webContents.getURL())
      );
    }
    panelOpened = !!panel;
    if (panel) {
      // 键盘可达性：卡片要能 Tab 到（tabIndex 0）、Enter 能开始/停止、灰卡要念原因。
      panelA11y = await panel.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        await sleep(350);
        // 上一次测试可能留下一个还在进行中的活动（状态会持久化）：先收掉，
        // 否则所有卡都是「她正在忙别的」，Tab/Enter 无从验证。
        const stopBtn = document.getElementById("stop");
        if (stopBtn && stopBtn.offsetParent !== null) {
          stopBtn.click();
          await sleep(500);
        }
        const cards = [...document.querySelectorAll(".act[data-id]")];
        const labels = cards.map((c) => c.getAttribute("aria-label") || "");
        const disabled = cards.filter((c) => c.getAttribute("aria-disabled") === "true");
        const enabled = cards.filter((c) => c.getAttribute("aria-disabled") !== "true" && c.dataset.id !== "__random");
        const focusables = [...document.querySelectorAll("button, [tabindex]:not([tabindex='-1'])")]
          .filter((e) => e.offsetParent !== null || e === document.activeElement);
        const focusOrder = focusables.map((e) => e.id || (e.className ? e.className.split(" ")[0] + (e.dataset.id || e.dataset.i || "") : "?")).slice(0, 40);
        const card = enabled[0];
        let started = false, stopped = false, saidStart = "", saidStop = "";
        if (card) {
          card.focus();
          card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          await sleep(700);
          started = !!document.querySelector(".act.active") && card.classList.contains("active");
          saidStart = (document.getElementById("say") || {}).textContent || "";
          card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          await sleep(700);
          stopped = !document.querySelector(".act.active");
          saidStop = (document.getElementById("say") || {}).textContent || "";
        }
        return {
          cardCount: cards.length,
          allLabelled: labels.every((s) => s.length > 1),
          allTabIndex: cards.every((c) => c.tabIndex === 0),
          focusables: focusables.length,
          focusOrder,
          disabledCount: disabled.length,
          disabledLabels: disabled.map((c) => c.getAttribute("aria-label")),
          started, stopped, saidStart, saidStop,
          cardId: card ? card.dataset.id : "",
        };
      })()`);
      // 真按 Tab（sendInputEvent）看焦点有没有动、焦点环有没有出来。
      // 只查 DOM 属性证明不了「键盘走得到」，这一条必须真的按键。
      try {
        panel.show();
        panel.focus();
        panel.webContents.focus();
        const readFocus = () => panel.webContents.executeJavaScript(
          "(()=>{const a=document.activeElement;if(!a)return null;const s=getComputedStyle(a);return {id:a.id||a.dataset.id||a.className,tag:a.tagName,outline:s.outlineStyle+' '+s.outlineWidth+' '+s.outlineColor};})()"
        );
        const step = async () => {
          panel.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
          panel.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
          await sleep(260);
          return readFocus();
        };
        const before = await readFocus();
        const after1 = await step();
        const after2 = await step();
        tabFocus = {
          before, after1, after2,
          moved: !!(before && after1 && before.id !== after1.id) || !!(after1 && after2 && after1.id !== after2.id),
          ring: !!(after1 && /solid/.test(after1.outline) && !/ 0px /.test(after1.outline)),
        };
      } catch (e) {
        tabFocus = { error: String((e && e.message) || e) };
      }
      // 面板里没有输入框，这里临时插一个，验证 keydown 处理器真的会让开。
      await panel.webContents.executeJavaScript(
        "(()=>{const i=document.createElement('input');i.id='__probe_input';document.body.appendChild(i);i.focus();return document.activeElement && document.activeElement.id;})()"
      );
      await panel.webContents.executeJavaScript(
        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
      );
      await sleep(500);
      escWhileTypingKeptOpen = !panel.isDestroyed();
      if (!panel.isDestroyed()) {
        await panel.webContents.executeJavaScript(
          "(()=>{const i=document.getElementById('__probe_input');if(i){i.blur();i.remove();}document.body.focus();})()"
        );
        await panel.webContents.executeJavaScript(
          "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
        );
        await sleep(700);
        escAfterBlurClosed = !BrowserWindow.getAllWindows().some(
          (w) => !w.isDestroyed() && /petpanel\.html/i.test(w.webContents.getURL())
        );
      }
    }
  } catch (e) {
    panelOpened = "error: " + String((e && e.message) || e);
  }

  // ---- 设置 → 关于：许可弹层读的是新条款，且不会把窗口撑出屏幕 ----
  let licenseModal = null;
  let formLabels = null;
  let searchFocus = null;
  let seeHint = null;
  let licenseEscClosed = null;
  let settingsClosed = null;
  try {
    await main.webContents.executeJavaScript("window.deskfish.openSettings()");
    let settings = null;
    for (let i = 0; i < 30 && !settings; i++) {
      await sleep(100);
      settings = BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed() && /settings\.html/i.test(w.webContents.getURL())
      );
    }
    if (settings) {
      // ---- 「测试连接」地址行：起一个假桥接，验证地址行能 Tab 到、Enter 切换 ----
      try {
        const http = req("node:http");
        const PORT_FAKE = 47123;
        const srv = http.createServer((rq, rs) => {
          if (String(rq.url || "").startsWith("/api/health")) {
            rs.writeHead(200, { "content-type": "application/json" });
            rs.end(JSON.stringify({
              app: "dsh-phone-bridge", model: "probe-model", cwd: "C:\\probe", busy: false,
              addresses: [
                { label: "本机", url: "http://127.0.0.1:" + PORT_FAKE, nic: "lo" },
                { label: "备用", url: "http://127.0.0.1:47124", nic: "alt" },
              ],
            }));
          } else {
            rs.writeHead(404); rs.end();
          }
        });
        await new Promise((r) => srv.listen(PORT_FAKE, "127.0.0.1", r));
        bridgeTest = await settings.webContents.executeJavaScript(`(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const tab = document.querySelector('.tab[data-page="connect"]');
          if (tab) tab.click();
          await sleep(250);
          const inp = document.getElementById("bridgeUrl");
          const old = inp ? inp.value : "";
          if (inp) inp.value = "http://127.0.0.1:${PORT_FAKE}";
          document.getElementById("bridgeTest").click();
          await sleep(1100);
          const rows = [...document.querySelectorAll("#bridgeAddrs .a")];
          let picked = "";
          if (rows[1]) {
            rows[1].focus();
            rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await sleep(400);
            picked = inp.value;
          }
          const out = {
            ok: !!document.querySelector("#bridgeResult .ok"),
            rows: rows.length,
            roles: rows.map((r) => r.getAttribute("role")),
            tabIndexes: rows.map((r) => r.tabIndex),
            titles: rows.map((r) => r.title),
            picked,
            old,
          };
          if (inp) inp.value = old;
          return out;
        })()`);
        // 恢复用户原来的地址，别让测试把设置改脏
        if (bridgeTest && bridgeTest.old !== undefined) {
          await settings.webContents.executeJavaScript(
            "window.deskfish.settingsPatch({ bridgeUrl: " + JSON.stringify(bridgeTest.old) + " })"
          );
        }
        srv.close();
      } catch (e) {
        bridgeTest = { error: String((e && e.message) || e) };
      }

      licenseModal = await settings.webContents.executeJavaScript(`(async () => {
        const btn = document.getElementById("aboutLicense");
        if (!btn) return { open: false, why: "no aboutLicense" };
        btn.click();
        await new Promise((r) => setTimeout(r, 800));
        const m = document.querySelector(".modal");
        if (!m) return { open: false, why: "modal not shown" };
        const pre = m.querySelector("pre");
        const box = m.querySelector(".box").getBoundingClientRect();
        return {
          open: true,
          textLen: pre ? pre.textContent.length : 0,
          hasModelPolicy: pre ? pre.textContent.includes("程序与模型分离") : false,
          scrolls: pre ? pre.scrollHeight > pre.clientHeight : false,
          boxBottom: Math.round(box.bottom),
          winH: innerHeight,
        };
      })()`);
      await settings.webContents.executeJavaScript(
        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
      );
      await sleep(500);
      licenseEscClosed = await settings.webContents.executeJavaScript(
        "!document.querySelector('.modal') && !!document.getElementById('aboutLicense')"
      );
      // 设置页每个表单控件都应有可读名称：读屏用户不靠旁边的说明文字认字段。
      formLabels = await settings.webContents.executeJavaScript(`(() => {
        const els = [...document.querySelectorAll("input,select,textarea")];
        const bad = els.filter((e) => !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby"))
          .map((e) => e.id || e.type || e.tagName);
        return { count: els.length, bad };
      })()`);
      // 搜索：Ctrl+F 聚焦、结果数会被读屏念、回车把焦点送到第一个命中控件、Esc 清空。
      // 分三段执行：等待放在主进程，避免窗口在后台时渲染进程的 setTimeout 被节流。
      const sfFirst = await settings.webContents.executeJavaScript(`(() => {
        const q = document.getElementById("q");
        document.body.focus();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
        const afterCtrlF = document.activeElement === q;
        q.value = "音量";
        q.dispatchEvent(new Event("input", { bubbles: true }));
        return { afterCtrlF };
      })()`);
      await sleep(420);
      const sfMid = await settings.webContents.executeJavaScript(`(() => {
        const q = document.getElementById("q");
        const info = document.getElementById("qInfo");
        const live = info ? {
          role: info.getAttribute("role"),
          live: info.getAttribute("aria-live"),
          text: info.textContent,
          shown: !info.classList.contains("hidden"),
        } : null;
        q.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return { live };
      })()`);
      await sleep(320);
      const sfEnd = await settings.webContents.executeJavaScript(`(() => {
        const q = document.getElementById("q");
        const focused = document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null;
        q.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return { focused, cleared: q.value === "" };
      })()`);
      searchFocus = { afterCtrlF: sfFirst.afterCtrlF, live: sfMid.live, focused: sfEnd.focused, cleared: sfEnd.cleared };
      // ---- 看屏幕说明：没桥接时要直接说「没在跑」，切外部接口时换文案并露出输入框 ----
      // 同样把等待放在主进程，避免后台窗口的 setTimeout 被节流拖成整分钟。
      const seeOwn = await settings.webContents.executeJavaScript(`(() => {
        const tab = document.querySelector('.tab[data-page="see"]');
        if (tab) tab.click();
        return true;
      })()`);
      await seeOwn;
      await sleep(1500);
      const seePart1 = await settings.webContents.executeJavaScript(`(() => {
        const hint = document.getElementById("seeModeHint");
        const own = hint ? hint.textContent.replace(/\\s+/g, " ").trim() : "";
        const btns = [...document.querySelectorAll("#seeModeSeg button")];
        const apiBtn = btns.find((b) => b.dataset.v === "api");
        if (apiBtn) apiBtn.click();
        const base = document.getElementById("seeBase");
        const oldBase = base ? base.value : "";
        if (base) {
          base.value = "http://127.0.0.1:9/v1";
          base.dispatchEvent(new Event("input", { bubbles: true }));
          base.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { own, oldBase };
      })()`);
      await sleep(1600);
      const seePart2 = await settings.webContents.executeJavaScript(`(() => {
        const hint = document.getElementById("seeModeHint");
        const box = document.getElementById("seeApiBox");
        const api = hint ? hint.textContent.replace(/\\s+/g, " ").trim() : "";
        const inputsVisible = ["seeBase", "seeModel"].every((id) => {
          const e = document.getElementById(id);
          return !!e && getComputedStyle(e).display !== "none";
        });
        const shown = !!box && getComputedStyle(box).display !== "none";
        const base = document.getElementById("seeBase");
        if (base) {
          base.value = ${JSON.stringify(seePart1.oldBase)};
          base.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const btns = [...document.querySelectorAll("#seeModeSeg button")];
        const ownBtn = btns.find((b) => b.dataset.v === "own");
        if (ownBtn) ownBtn.click();
        return { api, boxVisible: shown, inputsVisible,
          dbg: { box: !!box, cls: box ? box.className : null,
            disp: box ? getComputedStyle(box).display : null,
            page: document.querySelector('.page[data-page="see"]').className } };
      })()`);
      await sleep(360);
      seeHint = { own: seePart1.own, api: seePart2.api, boxVisible: seePart2.boxVisible, inputsVisible: seePart2.inputsVisible, dbg: seePart2.dbg };
      settingsClosed = await settings.webContents.executeJavaScript("window.deskfish.closeSettings(), true");
      await sleep(500);
    }
  } catch (e) {
    licenseModal = { open: false, why: String((e && e.message) || e) };
  }

  // ---- 最小化 / 还原：渲染应停、再恢复（锁屏走的是同一套 pauseReason）----
  const debugState = () => main.webContents.executeJavaScript(
    "window.__fishDebug ? window.__fishDebug() : null"
  );
  const beforeMin = await debugState();
  main.minimize();
  await sleep(800);
  const minimized = await debugState();
  main.restore();
  await sleep(1000);
  const restored = await debugState();

  // ---- 锁屏：Windows 的 Win+L 最终就是 powerMonitor 的 lock-screen 事件。
  // 真去锁一次会打断主人用机，这里手动 emit 同一事件，验证的是产品自己的处理链路。
  let lockPaused = null, lockResumed = null, lockError = null;
  try {
    const { powerMonitor } = req("electron");
    powerMonitor.emit("lock-screen");
    await sleep(1000);
    lockPaused = await debugState();
    powerMonitor.emit("unlock-screen");
    await sleep(1400);
    lockResumed = await debugState();
  } catch (e) {
    lockError = String((e && e.message) || e);
  }

  // ---- 看屏幕 / 对话记录 / 首次引导：真按 Tab，焦点要动、焦点环要看得见 ----
  const aux = [];
  const auxTargets = [
    { name: "seewatch", api: "openSeeWatch", url: "seewatch.html" },
    { name: "chatlog", api: "openChatLog", url: "chatlog.html" },
    { name: "welcome", api: "openWelcome", url: "welcome.html" },
  ];
  const readFocus = (w) => w.webContents.executeJavaScript(
    "(()=>{const a=document.activeElement;if(!a)return null;const s=getComputedStyle(a);" +
    "return {id:a.id||a.dataset.id||a.className||a.tagName,tag:a.tagName," +
    "outline:s.outlineStyle+' '+s.outlineWidth+' '+s.outlineColor};})()"
  );
  for (const t of auxTargets) {
    try {
      await main.webContents.executeJavaScript("window.deskfish." + t.api + "()");
      await sleep(900);
      // 窗口是异步建的：磁盘忙的时候（比如同时跑安装回归）900ms 可能还不够，
      // 一次没找到就再等两轮 —— 否则会报「打不开」，看上去像产品坏了。
      let w = null;
      for (let i = 0; i < 3 && !w; i++) {
        if (i) { await sleep(700); }
        w = BrowserWindow.getAllWindows().find(
          (x) => !x.isDestroyed() && new RegExp(t.url, "i").test(x.webContents.getURL())
        );
      }
      if (!w) { aux.push({ name: t.name, open: false, error: "等了 2.3 秒窗口没出来" }); continue; }
      w.show(); w.focus(); w.webContents.focus();
      await sleep(350);
      const tabOnce = async () => {
        w.focus(); w.webContents.focus();
        w.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
        w.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
        await sleep(250);
        return readFocus(w);
      };
      const seq = [];
      for (let i = 0; i < 4; i++) seq.push(await tabOnce());
      const ids = seq.map((f) => (f ? f.id : ""));
      const ring = seq.some((f) => !!(f && f.outline && !/none/.test(f.outline) && !/(^|\s)0px/.test(f.outline)));
      aux.push({ name: t.name, open: true, f1: seq[0], f2: seq[1], seq, moved: new Set(ids).size > 1, ring });
      w.close();
      await sleep(300);
    } catch (e) {
      aux.push({ name: t.name, open: false, error: String((e && e.message) || e) });
    }
  }

  // ---- 右键原生菜单：真弹一次，确认窗口能把它调出来（内容逐项由 test-menu.js 断言）----
  let menuPopup = null;
  try {
    const ret = await main.webContents.executeJavaScript("window.deskfish.windowMenu()");
    await sleep(400);
    menuPopup = { ret };
    // 弹出来就收掉，别把菜单留在屏幕上
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  } catch (e) {
    menuPopup = { error: String((e && e.message) || e) };
  }

  // ---- 窗口反复开关：每次都应该复用同一扇窗，关完只剩主窗 ----
  // 注意：close() 是异步的（有淡出/销毁时间），固定 sleep 在机器忙的时候会误判成
  // 「关完还剩 4 个窗」。这里改成轮询等真的没了再往下走，并把 endCount 取成「稳定值」。
  const churn = { opened: 0, endCount: null, leaks: [] };
  const churnKinds = [
    { api: "openProfile", url: "profile.html" },
    { api: "openPetPanel", url: "petpanel.html" },
    { api: "openChatLog", url: "chatlog.html" },
    { api: "openSettings", url: "settings.html" },
  ];
  const alive = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const waitClosed = async (ws, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (ws.every((w) => w.isDestroyed() || !alive().includes(w))) return true;
      await sleep(60);
    }
    return false;
  };
  for (let round = 0; round < 3; round++) {
    for (const k of churnKinds) {
      try {
        await main.webContents.executeJavaScript("window.deskfish." + k.api + "()");
        churn.opened++;
        await sleep(450);
        const ws = BrowserWindow.getAllWindows().filter(
          (x) => !x.isDestroyed() && new RegExp(k.url, "i").test(x.webContents.getURL())
        );
        if (ws.length > 1) churn.leaks.push(k.url + " x" + ws.length);
        for (const w of ws) {
          try { w.close(); } catch (e) { }
        }
        // 给足 3 秒：首次打开要加载页面，忙的时候关闭会慢一些。
        if (ws.length && !(await waitClosed(ws, 3000))) churn.leaks.push(k.url + ":关不掉");
      } catch (e) {
        churn.leaks.push(k.url + ":" + String((e && e.message) || e));
      }
    }
  }
  // endCount 取「连续 3 次采样都相同」的值，避免把正在销毁的窗口算进去。
  let last = -1;
  let stableTicks = 0;
  for (let i = 0; i < 60 && stableTicks < 3; i++) {
    const n = alive().length;
    if (n === last) stableTicks++;
    else { stableTicks = 0; last = n; }
    if (stableTicks < 3) await sleep(100);
  }
  churn.endCount = alive().length;

  return JSON.stringify({
    ok: true,
    winCount: wins.length,
    before,
    a11y,
    afterFeed,
    afterCooldown,
    afterPet,
    escClosed,
    panelOpened,
    panelA11y,
    tabFocus,
    bridgeTest,
    escWhileTypingKeptOpen,
    escAfterBlurClosed,
    licenseModal,
    formLabels,
    searchFocus,
    licenseEscClosed,
    seeHint,
    settingsClosed,
    beforeMin,
    minimized,
    restored,
    lockPaused,
    lockResumed,
    lockError,
    aux,
    menuPopup,
    churn,
    shot,
  });
})()
