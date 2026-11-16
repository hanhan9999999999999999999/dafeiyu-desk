// sign-check：看一眼打出来的 exe 到底签没签、签给谁、版本资源写没写。
//
// 为什么单独做这个：`electron-builder` 在没有证书时不会报错，它只是跳过签名，
// 产物照样生成 —— 于是「构建成功」这句话什么也没证明。发行前必须有一个
// 会明确说「这个 exe 没有 Authenticode 签名」的检查，否则只能靠 SmartScreen
// 弹窗来发现问题（那时已经到用户手里了）。
//
// 用法：
//   node scripts/sign-check.js            看现状（未签名只提示，不判失败）
//   node scripts/sign-check.js --strict   发行门：未签名 → exit 1
//   node scripts/sign-check.js --file X   指定 exe
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STRICT = process.argv.includes("--strict");
const fileArg = (() => {
  const i = process.argv.indexOf("--file");
  return i >= 0 ? process.argv[i + 1] : "";
})();

function findTarget() {
  if (fileArg) {
    const p = path.resolve(fileArg);
    return fs.existsSync(p) ? p : "";
  }
  // 先看解包目录里的主程序（这才是真正会被安装、被双击的那个），再看安装包。
  const unpacked = path.join(ROOT, "dist", "win-unpacked");
  try {
    const exe = fs.readdirSync(unpacked).find((n) => /\.exe$/i.test(n));
    if (exe) return path.join(unpacked, exe);
  } catch (e) { }
  try {
    const setup = fs.readdirSync(path.join(ROOT, "dist")).find((n) => /setup.*\.exe$|安装包\.exe$/i.test(n));
    if (setup) return path.join(ROOT, "dist", setup);
  } catch (e) { }
  return "";
}

function ps(command) {
  const exe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // 子进程默认按系统代码页（这台机器是 936）输出，中文证书名/路径会变乱码；
  // 强制它用 UTF-8 写 stdout，Node 端按 utf8 读才对得上。
  const utf8 = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;";
  return execFileSync(exe, ["-NoProfile", "-NonInteractive", "-Command", utf8 + command], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

const target = findTarget();
if (!target) {
  console.log("没有可检查的产物：dist 下找不到 exe。先跑 npm run build。");
  process.exit(0);
}

console.log("检查：" + path.relative(ROOT, target));
console.log("大小：" + (fs.statSync(target).size / 1024 / 1024).toFixed(1) + " MB");

let info = null;
let sig = null;

if (process.platform !== "win32") {
  console.log("");
  console.log("当前不是 Windows，读不了 Authenticode 签名。");
  process.exit(0);
}

try {
  const out = ps(
    "$f=" + JSON.stringify(target) + ";" +
    "Get-AuthenticodeSignature -LiteralPath $f | " +
    "Select-Object Status,StatusMessage,@{n='Subject';e={$_.SignerCertificate.Subject}}," +
    "@{n='NotAfter';e={$_.SignerCertificate.NotAfter}},@{n='Thumbprint';e={$_.SignerCertificate.Thumbprint}} | " +
    "ConvertTo-Json -Compress"
  );
  sig = out ? JSON.parse(out) : null;
} catch (e) {
  console.log("读签名失败：" + String((e && e.message) || e).slice(0, 300));
}

try {
  const out = ps(
    "$f=" + JSON.stringify(target) + ";" +
    "(Get-Item -LiteralPath $f).VersionInfo | " +
    "Select-Object FileVersion,ProductVersion,CompanyName,ProductName,FileDescription,OriginalFilename,LegalCopyright | " +
    "ConvertTo-Json -Compress"
  );
  info = out ? JSON.parse(out) : null;
} catch (e) {
  console.log("读版本资源失败：" + String((e && e.message) || e).slice(0, 300));
}

console.log("");
console.log("版本资源：");
const nice = (v) => (v === undefined || v === null || v === "" ? "（空）" : v);
if (info) {
  for (const [k, v] of Object.entries(info)) console.log("  " + k.padEnd(18) + nice(v));
} else {
  console.log("  （读不到）");
}

console.log("");
console.log("数字签名：");
const status = String((sig && sig.Status) || "Unknown");
const subject = String((sig && sig.Subject) || "");
const signed = status === "Valid" && !!subject;
if (signed) {
  console.log("  ✅ 已签名 · 证书主体：" + subject);
  if (sig.NotAfter) console.log("     有效期至 " + sig.NotAfter);
  if (sig.Thumbprint) console.log("     指纹 " + sig.Thumbprint);
} else {
  console.log("  ⚠ 未签名或签名无效（Status=" + status + "）");
  console.log("     影响：SmartScreen 会拦一次「Windows 已保护你的电脑」，");
  console.log("           企业环境按策略可能直接不让装。");
  console.log("     修法：把代码签名证书（.pfx）配进构建机，见 docs/发行-签名与密钥.md。");
}

const hasVersion = !!(info && info.FileVersion && info.FileVersion !== "" );
console.log("");
console.log("exe 资源写入：" + (hasVersion ? "✅ 有版本信息（signAndEditExecutable 生效）" : "⚠ 没有版本信息，检查 build.win.signAndEditExecutable"));

if (STRICT && !signed) {
  console.log("");
  console.log("❌ --strict：产物没有有效签名，按发行门判失败");
  process.exit(1);
}
