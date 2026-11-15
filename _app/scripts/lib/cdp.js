"use strict";
/**
 * 迷你 CDP 客户端（不装 devDependencies 用完就扔的那种）。
 *
 * soak.js / churn.js 都用它：起一个真 Electron，靠 --remote-debugging-port 与
 * --inspect 拿到两个调试口，然后读内存、句柄、窗口数，或者点按钮。
 *
 * 一条铁律（2026-11-14 用一次假红灯换来的）：
 *   **不要复用长连接做采样。**
 * 主进程 inspector 那条 WebSocket 空闲约一分钟就不再回应请求，复用它的结果是
 * 第 61 秒起每次 `Runtime.evaluate` 都超时，整轮采样空白，判定 FAIL ——
 * 看着像产品在泄漏，其实是探针坏了。采样请走 sampleFrom()：现查目标、现连、
 * 求值、立刻关。长连接只用来听事件（console / 异常），断了由
 * reconnectPageEvents() 重开。
 */

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  let closed = false;
  const pending = new Map();
  const events = [];

  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      const slot = pending.get(msg.id);
      pending.delete(msg.id);
      slot.resolve(msg);
      return;
    }
    if (msg.method) events.push(msg);
  });

  // 对端断了就把挂着的请求立刻失败，不要让自己那 15 秒超时再兜一层，
  // 否则一次断连会伪装成「15 秒卡顿」。
  const onGone = (why) => {
    closed = true;
    for (const [id, slot] of pending) {
      pending.delete(id);
      slot.reject(new Error("连接已断开（" + why + "）"));
    }
  };
  ws.addEventListener("close", () => onGone("close"));
  ws.addEventListener("error", () => onGone("error"));

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP 握手超时")), 8000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP 连接失败")); });
  });

  function send(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (closed) { reject(new Error("连接已断开")); return; }
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(method + " 超时"));
      }, timeoutMs || 10000);
      try {
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(e);
      }
    });
  }

  return {
    ready,
    send,
    events,
    isClosed: () => closed,
    close() { try { ws.close(); } catch (e) { } },
  };
}

async function listTargets(port) {
  try {
    const r = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

// 求值并尽量把结果当 JSON 解出来（探针都返回 JSON.stringify 的字符串）
async function evalOn(client, expr, timeoutMs) {
  const r = await client.send(
    "Runtime.evaluate",
    { expression: expr, returnByValue: true, awaitPromise: true },
    timeoutMs || 15000
  );
  const v = r && r.result && r.result.result;
  if (!v) return null;
  const raw = v.value !== undefined ? v.value : v.description;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (e) { return { raw: raw }; }
  }
  return raw || null;
}

// 一次一条连接：连上、求值、立刻关
async function evalOnce(wsUrl, expr, timeoutMs) {
  const c = connect(wsUrl);
  try {
    await c.ready;
    return await evalOn(c, expr, timeoutMs || 20000);
  } finally {
    c.close();
  }
}

async function findTarget(port, pick) {
  const ts = await listTargets(port);
  return ts.find(pick) || null;
}

// 每次采样现找目标地址（页面重载/换窗口后 wsUrl 会变），失败重试一次
async function sampleFrom(port, pick, expr, timeoutMs) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await findTarget(port, pick);
    if (!t || !t.webSocketDebuggerUrl) {
      lastErr = new Error("找不到调试目标（" + port + "）");
    } else {
      try {
        return await evalOnce(t.webSocketDebuggerUrl, expr, timeoutMs);
      } catch (e) {
        lastErr = e;
      }
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  throw lastErr || new Error("采样失败");
}

// 只用来听页面 console 的连接。断了就重开，别让后面的采样假装在听。
async function reconnectPageEvents(port, pick) {
  const t = await findTarget(port, pick || ((x) => x && x.type === "page" && x.webSocketDebuggerUrl));
  if (!t) throw new Error("找不到页面目标");
  const c = connect(t.webSocketDebuggerUrl);
  try {
    await c.ready;
    await c.send("Runtime.enable").catch(() => { });
    await c.send("Log.enable").catch(() => { });
    return c;
  } catch (e) {
    c.close();
    throw e;
  }
}

module.exports = { connect, listTargets, evalOn, evalOnce, findTarget, sampleFrom, reconnectPageEvents };
