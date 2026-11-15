// 主窗口（index.html）离屏预览：把 Live2D 与业务脚本摘掉，只留气泡 + 输入条，
// 用一份静态假内容把「看得见的界面」画出来，供人工核对排版。
// 纯静态注入，不依赖 DOMContentLoaded —— headless 截图发生在定时器之前。
// 用法：node build-main.js；再用 Edge headless 截 page-main.html。
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "_app", "src", "index.html");
let html = fs.readFileSync(SRC, "utf8");

// 1) 去掉所有脚本（vendor/live2d/renderer 都依赖真 Electron 环境，离屏跑不通）
html = html.replace(/<script\b[\s\S]*?<\/script>\s*/gi, "");

// 2) 把相对资源改成绝对 file://，否则副本在 .ui-shots/ 里会 404
const dir = SRC.slice(0, SRC.lastIndexOf("\\")).replace(/\\/g, "/");
html = html.replace(/(src|href)="(?!https?:|file:|#|data:)/g, `$1="file:///${dir}/`);

// 3) 气泡里塞一句真实长度的回复，输入框塞一句真实长度的话（看换行与胶囊宽度）
html = html.replace(/(<div id="bubble"[^>]*>)(<\/div>)/,
  `$1<div class="ln">咕噜咕噜……我把语音那条路又量了一遍，</div>` +
  `<div class="ln">首声从 2.6 秒压到 <strong>1.9 秒</strong>，中段那几秒空白也补上了。</div>` +
  `<div class="ln"><code>firstMs 1942 · rtf 0.98 × 实时</code></div>$2`);
html = html.replace(/(<input id="dockInput"[^>]*?)(\s*\/?>)/,
  `$1 value="再说一句试试，这次是不是立刻开口了"$2`);
html = html.replace('<div class="log" id="dockLog"></div>',
  '<div class="log" id="dockLog">首句出声 1.94s（首字之后 1.21s）</div>');

// 4) 垫深色底、强制显示气泡与输入条（真机上这两块的显隐由 JS 控）
const stub = `<style>
  html, body { height: 100% !important; min-height: 100% !important;
    background: #141a26 !important; }
  #stage, #noModel { display: none !important; }
  #bubble { opacity: 1 !important; pointer-events: auto !important;
    transform: translateX(-50%) !important; }
  #dock { opacity: 1 !important; pointer-events: auto !important;
    transform: none !important; }
</style>`;
html = html.replace("</head>", stub + "\n</head>");

// 5) 可选：把发送键画成「她正在说话」时的那一态（带 .stop），用来核对对比度
if (process.argv.includes("--stop")) {
  html = html.replace('<button class="send" id="dockSend"', '<button class="send stop" id="dockSend"');
  html = html.replace(/(<button class="send stop" id="dockSend"[^>]*>)发送/, "$1停止");
}

fs.writeFileSync(path.join(__dirname, "page-main.html"), html);
console.log("wrote page-main.html");
