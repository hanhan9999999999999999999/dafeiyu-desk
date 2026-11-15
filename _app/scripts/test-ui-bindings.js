"use strict";
/**
 * audit-ui-bindings.js 的自测：它得真能抓到「控件是死的」，而不是永远报 0。
 *
 * 这脚本的价值全在「判据准不准」——判太松永远绿（等于没有），判太严满屏假阳性
 * （没人看第二次）。所以这里造一间假 src，四种真实写法各来一个，两个死键各来一个，
 * 看它认不认得出来。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const APP = path.resolve(__dirname, "..");
const AUDIT = path.join(__dirname, "audit-ui-bindings.js");

let pass = 0;
let fail = 0;
function ok(name, extra) {
  pass++;
  console.log("  ✅ " + name + (extra ? " → " + extra : ""));
}
function bad(name, extra) {
  fail++;
  console.log("  ❌ " + name + (extra ? " → " + extra : ""));
}
function t(name, cond, extra) { if (cond) ok(name, extra); else bad(name, extra); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dfy-bind-"));

try {
  const html = [
    "<!doctype html><html><body>",
    '<button id="a1">直绑</button>',
    '<button id="a2">短名对象</button>',
    '<button id="a3">长名对象</button>',
    '<button id="dead1">只有注释提到</button>',
    '<button id="dead2">谁都没提</button>',
    '<script src="page.js"></script>',
    "</body></html>",
  ].join("\n");
  fs.writeFileSync(path.join(tmp, "page.html"), html);

  const js = [
    'const $ = (id) => document.getElementById(id);',
    'const el = { a2: $("a2") };',
    'const E = { a3: document.getElementById("a3") };',
    'document.getElementById("a1").addEventListener("click", () => {});',
    'el.a2.addEventListener("click", () => {});',
    'E.a3.addEventListener("click", () => {});',
    '// dead1 这里提到了，但只是提，没有绑',
    "",
  ].join("\n");
  fs.writeFileSync(path.join(tmp, "page.js"), js);

  const r = spawnSync(process.execPath, [AUDIT, "--src", tmp], { encoding: "utf8" });
  const out = String(r.stdout || "") + String(r.stderr || "");

  t("审计脚本能跑起来", r.status === 0, "exit=" + r.status);
  t("直接 $(\"id\").addEventListener 不算死键", !/可疑：[^\n]*\ba1\b/.test(out));
  t("短名对象 { a2: $(\"a2\") } 不算死键", !/可疑：[^\n]*\ba2\b/.test(out));
  t("对象字面量 { a3: document.getElementById } 不算死键", !/可疑：[^\n]*\ba3\b/.test(out));
  t("只在注释里提到的是死键", /可疑：[^\n]*\bdead1\b/.test(out), "dead1");
  t("谁都没提的是死键", /可疑：[^\n]*\bdead2\b/.test(out), "dead2");
  t("加起来正好 5 个控件 2 个死键", /5 个可交互元素，2 个找不到绑定/.test(out),
    (out.match(/结果：.*/) || [""])[0]);
  t("--src 生效（没去读真的 src）", /page\.html/.test(out));

  // 回归：真实的 src 现在是 0 个 —— 本轮的修复不许退化
  const real = spawnSync(process.execPath, [AUDIT], { encoding: "utf8" });
  const realOut = String(real.stdout || "");
  const m = /结果：(\d+) 个可交互元素，(\d+) 个找不到绑定/.exec(realOut);
  t("真实 src 能跑出汇总", !!m, m ? m[0] : "没拿到汇总");
  if (m) {
    t("真实 src 的可交互元素不少于 100 个", Number(m[1]) >= 100, m[1]);
    t("真实 src 里没有被落下的控件", Number(m[2]) === 0, m[2]);
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
}

console.log("");
console.log("结果：" + pass + " 通过 " + fail + " 失败");
process.exit(fail ? 1 : 0);
