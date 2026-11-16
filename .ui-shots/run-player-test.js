// 打开 player-test.html，等它跑完，把 document.title 里的 JSON 读回来。
// 用 CDP 而不是 --dump-dom：AudioContext 在 --virtual-time-budget 下不走，
// 那样会永远读到 "pending"。
const { spawn } = require("child_process");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "file:///" + process.cwd().replace(/\\/g, "/") + "/player-test.html";
const PORT = 9224;
const PROFILE = process.cwd() + "\\.edge-profile";

const child = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  "--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, URL,
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let k = 0; k < 40; k += 1) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const t = list.find((x) => x.type === "page" && /player-test/.test(x.url || ""));
      if (t) return t;
    } catch (e) { }
    await sleep(300);
  }
  return null;
}

(async () => {
  const target = await findTarget();
  if (!target) { console.log("找不到 target"); child.kill(); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const waiters = new Map();
  ws.addEventListener("message", (ev) => {
    let m = null;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  });
  const evaluate = (expr) => new Promise((res) => {
    const my = ++id;
    waiters.set(my, (m) => res(m.result && m.result.result ? m.result.result.value : undefined));
    ws.send(JSON.stringify({ id: my, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
  });
  await new Promise((r) => ws.addEventListener("open", r));

  let title = "";
  for (let k = 0; k < 60; k += 1) {
    title = await evaluate("document.title");
    if (title && title !== "pending") break;
    await sleep(500);
  }
  console.log(title);
  ws.close();
  child.kill();
  process.exit(0);
})();
