// 离屏看设置页：把 settings.html 复制一份，注入 window.api 的桩（任何方法都返回
// 空 Promise），再按 data-page 点对应的标签，最后交给 Edge headless 截图。
// 只用于「肉眼看 UI」，不参与打包。
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "_app", "src", "settings.html");
const OUT = __dirname;
const pages = ["overview", "appearance", "behavior", "hotkeys", "see", "connect", "usage", "about"];

const stub = `<script>
(function(){
  var ret = function(){ return Promise.resolve({}); };
  window.api = new Proxy({}, { get: function(t, k){
    if (k === "then") return undefined;
    if (!(k in t)) t[k] = ret;
    return t[k];
  }});
  window.FishSay = function(){};
})();
<\/script>`;

const html0 = fs.readFileSync(SRC, "utf8");
// 页面自带 CSP（script-src 'self'），离屏副本里内联桩会被整段拦掉 ——
// 只在这份副本里摘掉它，真程序那份不动。
const htmlRaw = html0.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/i, "");
// 副本放在 .ui-shots/，相对路径会 404（渲染脚本加载不到 → 标签点不动），所以把
// 所有本地 src/href 改成绝对 file:// 地址，等价于在原目录打开。
const SRCURL = "file:///" + path.dirname(SRC).replace(/\\/g, "/") + "/";
const html = htmlRaw.replace(/(src|href)="(?!https?:|file:|#|data:)([^"]+)"/g, (m, k, v) => k + '="' + SRCURL + v + '"');
for (const p of pages) {
  // 不用 JS 切页（headless 的截图时机在定时器之前，点了也白点）：
  // 直接用一层样式把其它页压掉，效果等价于选中该标签。
  const click = `<style>
    .page{display:none !important;}
    .page[data-page="${p}"]{display:block !important;}
    ${p === "behavior" ? `.subpage{display:none !important;}
      .subpage[data-sub="${process.env.SUB || "voice"}"]{display:block !important;}` : ""}
    .tab.on{background:rgba(90,120,255,.16) !important;}
  </style>`;

  // 「用量」页的数据走 fetch('/usage/summary')，离屏打不开真接口：这里垫一份
  // 形状完全一致的样本，用来看排版（数字是编的，别当成真账本）。
  const usageStub = p === "usage" ? `<script>
    window.confirm = () => true;
    const sample = {
      ok: true,
      file: "C:\\\\Users\\\\Administrator\\\\AppData\\\\Roaming\\\\dafeiyu-desk\\\\usage.json",
      today: { turns: 18, tokens: 128400, prompt: 96400, completion: 32000 },
      week: { turns: 96, tokens: 742100, prompt: 552000, completion: 190100 },
      total: { turns: 431, tokens: 3182400, prompt: 2380100, completion: 802300 },
      bySrc: [
        { src: "dsh", label: "DSH 对话", turns: 352, tokens: 2764300, prompt: 2070000, completion: 694300, share: 86.9 },
        { src: "api", label: "自定义 API", turns: 79, tokens: 418100, prompt: 310100, completion: 108000, share: 13.1 }
      ],
      series: [0,1,2,3,4,5,6,7,8,9,10,11,12,13].map((i) => ({
        day: 0, label: "11-" + String(i + 1).padStart(2, "0"),
        tokens: [38000, 0, 92000, 61000, 128000, 54000, 0, 210000, 155000, 74000, 118000, 96000, 164000, 128400][i],
        turns: [4, 0, 9, 6, 12, 5, 0, 21, 15, 7, 11, 9, 16, 18][i]
      })),
      recent: [
        { at: Date.now() - 60e3, src: "dsh", label: "DSH 对话", model: "deepseek-flash", prompt: 6120, completion: 980, total: 7100 },
        { at: Date.now() - 8 * 60e3, src: "api", label: "自定义 API", model: "deepseek-chat", prompt: 2480, completion: 640, total: 3120 },
        { at: Date.now() - 26 * 60e3, src: "dsh", label: "DSH 对话", model: "deepseek-flash", prompt: 12900, completion: 1740, total: 14640 },
        { at: Date.now() - 55 * 60e3, src: "dsh", label: "DSH 对话", model: "deepseek-flash · 看屏幕", prompt: 41200, completion: 320, total: 41520 },
        { at: Date.now() - 96 * 60e3, src: "api", label: "自定义 API", model: "gpt-4o-mini", prompt: 1860, completion: 410, total: 2270 }
      ],
      ctx: { used: 12900, max: 65536, at: Date.now() - 26 * 60e3 },
      lastAt: Date.now()
    };
    Object.defineProperty(window, "fetch", {
      configurable: true, writable: true,
      value: (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(sample) })
    });
    window.__usageSample = sample;
  </script>` : "";
  // 桩必须排在 usage-page.js 前面执行（它是立刻自举的 IIFE）。
  const out = html
    .replace("<head>", "<head>\n" + stub)
    .replace('<script src="' + SRCURL + 'usage-page.js"></script>',
      usageStub + '\n<script src="' + SRCURL + 'usage-page.js"></script>')
    .replace("</body>", click + "\n</body>");
  fs.writeFileSync(path.join(OUT, "page-" + p + ".html"), out, "utf8");
}
console.log("wrote " + pages.length + " pages");
