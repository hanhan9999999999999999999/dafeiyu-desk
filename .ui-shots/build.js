// 离屏看设置页：把 settings.html 复制一份，注入 window.api 的桩（任何方法都返回
// 空 Promise），再按 data-page 点对应的标签，最后交给 Edge headless 截图。
// 只用于「肉眼看 UI」，不参与打包。
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "_app", "src", "settings.html");
const OUT = __dirname;
const pages = ["overview", "appearance", "behavior", "hotkeys", "see", "connect", "about"];

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
// 副本放在 .ui-shots/，相对路径会 404（渲染脚本加载不到 → 标签点不动），所以把
// 所有本地 src/href 改成绝对 file:// 地址，等价于在原目录打开。
const SRCURL = "file:///" + path.dirname(SRC).replace(/\\/g, "/") + "/";
const html = html0.replace(/(src|href)="(?!https?:|file:|#|data:)([^"]+)"/g, (m, k, v) => k + '="' + SRCURL + v + '"');
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
  const out = html
    .replace("<head>", "<head>\n" + stub)
    .replace("</body>", click + "\n</body>");
  fs.writeFileSync(path.join(OUT, "page-" + p + ".html"), out, "utf8");
}
console.log("wrote " + pages.length + " pages");
