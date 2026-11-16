// 自愈回归：这两条是用户真碰到的
//  ① 桥接「进程在、端口不答话」时以前只记一句话，永远不自愈 → 发出去的话没回复；
//  ② 外面手动起的引擎明明在跑，界面写「未启动」，可「首声」指标却有数；
//     点「一键启动」什么也不发生（只 ensure 进程、不预热模型）。
// 这里把两边的关键实现钉住，改坏了立刻红。
const fs = require("fs");
const path = require("path");

const APP = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(APP, p), "utf8");

let pass = 0;
let fail = 0;
function ok(name) { pass += 1; console.log("  ✓ " + name); }
function bad(name, why) { fail += 1; console.log("  ✗ " + name + (why ? " —— " + why : "")); }
function has(src, needle, name) {
  if (src.includes(needle)) ok(name || needle);
  else bad(name || needle, "没找到：" + String(needle).slice(0, 60));
}

const main = read("src/main.js");
const feiyu = read("engine/feiyu.mjs");
const server = read("src/server.js");
const renderer = read("src/settings-renderer.js");

console.log("桥接自愈");
has(main, "async function waitMiniListening(", "有 waitMiniListening()：等端口真的应答");
has(main, "const up = await waitMiniListening(12000);", "启动后最多等 12 秒再报结果");
has(main, "miniAnswering", "状态里区分「进程在」和「端口在答话」");
has(main, "自带桥接起了进程，但", "起不来时有明确原因，不是一句「还没答话」");
has(main, "自带桥接进程在但不应答，收掉重起", "miniStart 遇到卡死的先收掉再起");
has(main, "没应答，重启自带桥接", "bridgeEnsure 遇到没应答会重启一次");
has(main, "重起后仍然没应答", "重起后仍不通要如实说，不对用户报喜");
has(main, "}, 45 * 1000);", "巡检间隔 45 秒（以前 90 秒，卡住要等太久）");

console.log("引擎状态");
has(feiyu, "let external = false;", "记录「外面启动的引擎」");
has(feiyu, "running: !!(child || external),", "running 表示「有引擎在应答」，不只管子进程");
has(feiyu, "external: !!external,", "状态里带 external，界面才能说清谁在跑");
has(feiyu, "export async function snapshot()", "有 snapshot()：先真探一次再报状态");
has(server, "await f.snapshot()", "feiyu_status 走 snapshot，不用旧快照");
has(feiyu, "if (!ready) {", "一键启动在未就绪时真的预热");
has(feiyu, "const w = await warm(", "启动路径里调 warm()");
has(feiyu, "只卸载模型，不结束那个进程", "关引擎遇到别人的进程只卸载模型");
has(renderer, "j.external ?", "设置页会标出「这个进程不是本程序启动的」");

console.log("设置页与主窗口不再互相拉锯");
has(main, "function broadcastSettings()", "有 broadcastSettings()：两个窗口一起通知");
has(main, "for (const w of [win, settingsWin])", "广播覆盖主窗口和设置页");
has(main, "let miniStopping = false;", "自己收掉的桥接不再记成崩溃");
has(renderer, "api.onSettingsChanged", "设置页会跟着主进程改 bridgeUrl");
const voice = read("src/voice.js");
has(voice, "window.deskfish.bridgeEnsure({})", "连不上时先问主进程要一个可用地址再试");
has(voice, "没应答），设置里点", "报错带上端口，主人一眼看出是哪一步错");

console.log("说的是人话，不是「连不上 DSH」");
const rnd = read("src/renderer.js");
has(rnd, "原来那个地址（", "原地址不通时先说清是哪个端口");
has(rnd, "我改走随身桥接了", "能改走随身桥接就如实说改走了");
has(rnd, "随身桥接也没起来", "真没救了才说没救，并给出下一步");
has(rnd, "const healBridge = () =>", "renderer 也有自愈入口");
has(rnd, "dshFail % 3 === 0", "已经报过「断了」之后仍然定期再试");
has(voice, "async function healBridgeBase(", "语音层有同一个自愈入口");
has(voice, "return postJson(path, body, _retried, true);", "换到可用地址后把这句话重发一遍");
has(main, "out.answered = true;", "bridgeEnsure 分开记「有没有桥答话」");
has(main, "out.mine = true;", "bridgeEnsure 分开记「答话的是不是自带桥」");
has(renderer, "这个地址是通的", "只有真的探到你填的地址才这么说");
has(renderer, "你填的地址没应答，地址栏已经指过来了。", "指过去了就明说指过去了");

console.log("藏起来又拿回来，还能拖、按钮还能点");
has(main, "function rearmInput(", "有 rearmInput()：show 之后重立输入区");
has(main, "win.setIgnoreMouseEvents(!!st.clickThrough, { forward: true });", "按设置重设穿透，清掉卡住的状态");
has(main, "rearmInput(\"退出游戏模式\");", "退出游戏模式后重立");
has(main, "rearmInput(\"窗口重新显示\");", "hide→show 后重立");
has(main, "rearmInput(\"托盘 / 热键显示\");", "托盘/热键叫回来也重立");
has(main, "let cursorIgnoring = null;", "穿透状态提到模块作用域，能在重立时清掉");
has(main, 'win.webContents.send("window:shown"', "会通知渲染层「我刚被拿回来」");
const pre = read("src/preload.js");
has(pre, "onWindowShown:", "preload 暴露 onWindowShown");
const rnd2 = read("src/renderer.js");
has(rnd2, "window.deskfish.onWindowShown(", "渲染层订阅了这条通知");
has(rnd2, "拖拽状态已复位", "收到通知就把拖拽状态复位");

console.log("");
console.log(`结果：${pass} 通过 ${fail} 失败`);
process.exit(fail ? 1 : 0);
