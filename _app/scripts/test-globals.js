// 守护测试：同一个 HTML 里用 <script src> 加载的经典脚本共用**一个顶层作用域**，
// 两个文件各自写 `const API = ...` 会在浏览器里抛
// "Identifier 'API' has already been declared"，而且后加载的那个文件整段不执行
// （不报错到界面上，只是安静地失效）。require() 跑测试看不出来，所以必须单独盯着。
//
// 真机事故：src/lines.js 与 src/motion-pick.js 都叫 const API，
// 导致 motion-pick.js 完全没加载、表情与动作的衔接退回旧逻辑。
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (extra ? "  → " + extra : ""));
  }
}

// 取 <script src="...">；跳过 vendor / node_modules / CDN。
function scriptsOf(htmlFile) {
  const html = fs.readFileSync(htmlFile, "utf8");
  const out = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1].trim();
    if (/^(https?:)?\/\//.test(src)) continue;
    const abs = path.resolve(path.dirname(htmlFile), src);
    if (!fs.existsSync(abs)) continue;
    if (abs.includes(path.sep + "vendor" + path.sep)) continue;
    out.push(abs);
  }
  return out;
}

// 顶层声明：行首（允许缩进 0~2 个空格）的 const/let/var/class/function。
// 只认「一行的开头就是声明」这种，避免把函数体里的同名变量当冲突。
const DECL = /^(?: {0,2})(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

function topLevelNames(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const names = [];
  let depth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      // 也要照常更新花括号深度（注释里一般不配对，跳过即可）
      continue;
    }
    if (depth === 0) {
      const m = DECL.exec(line);
      if (m) names.push({ name: m[1], line: line.trim().slice(0, 90) });
    }
    // 粗算深度：字符串里的花括号会算错，但这里只用来判断「是不是顶层」，
    // 误差方向是「把顶层的当里面」，会漏报而不是误报，可以接受。
    for (const ch of trimmed) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  return names;
}

function checkPage(htmlName) {
  const htmlFile = path.join(ROOT, "src", htmlName);
  if (!fs.existsSync(htmlFile)) {
    ok(htmlName + " 存在", false);
    return;
  }
  const files = scriptsOf(htmlFile);
  ok(htmlName + " 解析到脚本（" + files.length + " 个）", files.length > 0);

  const owner = new Map();
  const clashes = [];
  for (const f of files) {
    for (const d of topLevelNames(f)) {
      const rel = path.relative(ROOT, f).replace(/\\/g, "/");
      if (owner.has(d.name)) {
        const prev = owner.get(d.name);
        if (prev.file !== rel) clashes.push({ name: d.name, a: prev.file, b: rel, line: d.line });
      } else {
        owner.set(d.name, { file: rel, line: d.line });
      }
    }
  }
  ok(
    htmlName + " 里没有被两个文件重复声明的顶层名字",
    clashes.length === 0,
    clashes
      .slice(0, 6)
      .map((c) => c.name + "：" + c.a + " ↔ " + c.b)
      .join("；")
  );
  return clashes;
}

console.log("[globals] 检查经典脚本的顶层声明是否撞名\n");
const c1 = checkPage("index.html");
const c2 = checkPage("settings.html");
const c3 = checkPage("adapter.html");

// 具体到这次事故的两个名字：未来谁再取这个名会立刻红。
const allFiles = [...scriptsOf(path.join(ROOT, "src", "index.html")), ...scriptsOf(path.join(ROOT, "src", "settings.html"))];
const generic = ["API", "Root", "Main", "Lib", "Utils", "Cfg", "Opts"];
const badGeneric = [];
for (const f of allFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  for (const d of topLevelNames(f)) {
    if (generic.includes(d.name)) badGeneric.push(rel + " → " + d.name);
  }
}
ok("没有脚本再用 API/Root/Lib 这类泛名当顶层变量", badGeneric.length === 0, badGeneric.join("；"));

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
if (fail) {
  console.log("撞名清单：", JSON.stringify([...(c1 || []), ...(c2 || []), ...(c3 || [])], null, 2));
  process.exitCode = 1;
}
