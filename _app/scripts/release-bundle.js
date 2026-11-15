#!/usr/bin/env node
/**
 * 发版打包：把「要上传的东西」收进 dist/release-<版本>/，并逐项核对。
 *
 * 用法：
 *   node scripts/release-bundle.js
 *
 * 它做四件事：
 *   1. 校验 latest.yml 的 version / path / size / sha512 与磁盘上的 ASCII 安装包一致；
 *   2. 校验 docs/RELEASE-<版本>.md 存在，且里面的体积与 SHA-256 和安装包一致；
 *   3. 在 dist/release-<版本>/ 里放好 ASCII 安装包、blockmap、latest.yml、发布说明；
 *   4. 打印 SHA-256 与 gh release create 命令。
 *
 * 安装包用硬链接，不额外占 900 MB；说明与 latest.yml 复制，避免后续重建改到同一 inode。
 * 退出码：0 全部对上；1 有任何一项对不上（不要上传）。
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const pkg = require("../package.json");
const v = pkg.version;

function die(msg) {
  console.error("[release] ✗ " + msg);
  process.exit(1);
}
function hashFile(file, algo) {
  const h = crypto.createHash(algo);
  const fd = fs.openSync(file, "r");
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest();
}
function linkOrCopy(from, to) {
  try {
    if (fs.existsSync(to)) fs.unlinkSync(to);
    fs.linkSync(from, to);
  } catch (e) {
    fs.copyFileSync(from, to);
  }
}

const ymlPath = path.join(DIST, "latest.yml");
if (!fs.existsSync(ymlPath)) die("没有 dist/latest.yml，先跑 npm run build");
const yml = fs.readFileSync(ymlPath, "utf8");

const ymlVersion = (yml.match(/^version:\s*(\S+)/m) || [])[1];
const ymlPathName = (yml.match(/^path:\s*(\S+)/m) || [])[1];
const ymlSize = Number((yml.match(/^\s*size:\s*(\d+)/m) || [])[1]);
const ymlSha512 = (yml.match(/^\s*sha512:\s*(\S+)/m) || [])[1];
if (ymlVersion !== v) die("latest.yml 的 version=" + ymlVersion + "，package.json 是 " + v);
if (!ymlPathName || !/^[\x20-\x7e]+$/.test(ymlPathName)) die("latest.yml 的 path 不是纯 ASCII：" + ymlPathName);
if (!/^dafeiyu-desk-setup-/.test(ymlPathName)) die("latest.yml 的 path 不是预期别名：" + ymlPathName);

const asciiPath = path.join(DIST, ymlPathName);
const cnPath = path.join(DIST, "大肥鱼-" + v + "-安装包.exe");
for (const f of [asciiPath, cnPath]) if (!fs.existsSync(f)) die("缺少安装包：" + path.basename(f));

const size = fs.statSync(asciiPath).size;
if (size !== ymlSize) die("latest.yml 的 size=" + ymlSize + "，磁盘上是 " + size);
const sha512 = hashFile(asciiPath, "sha512").toString("base64");
if (sha512 !== ymlSha512) die("latest.yml 的 sha512 与安装包不一致（重新跑 fix-latest 或重建）");

const blockPath = asciiPath + ".blockmap";
if (!fs.existsSync(blockPath)) die("缺少 blockmap：" + path.basename(blockPath));

const notesPath = path.resolve(ROOT, "..", "docs", "RELEASE-" + v + ".md");
if (!fs.existsSync(notesPath)) die("缺少发布说明：docs/RELEASE-" + v + ".md");
const notes = fs.readFileSync(notesPath, "utf8");
const sizeText = size.toLocaleString("en-US");
if (!notes.includes(sizeText)) die("发布说明里的体积不是 " + sizeText);
const sha256 = hashFile(asciiPath, "sha256").toString("hex").toUpperCase();
if (!notes.toUpperCase().includes(sha256)) die("发布说明里的 SHA-256 与安装包不一致，应为 " + sha256);

const out = path.join(DIST, "release-" + v);
fs.mkdirSync(out, { recursive: true });
linkOrCopy(asciiPath, path.join(out, ymlPathName));
fs.copyFileSync(blockPath, path.join(out, path.basename(blockPath)));
fs.copyFileSync(ymlPath, path.join(out, "latest.yml"));
fs.copyFileSync(notesPath, path.join(out, "RELEASE-NOTES.md"));

const manifest = {
  version: v,
  builtAt: new Date().toISOString(),
  installer: ymlPathName,
  size,
  sha256,
  sha512,
  blockmap: path.basename(blockPath),
  notes: "RELEASE-NOTES.md",
  files: [ymlPathName, path.basename(blockPath), "latest.yml", "RELEASE-NOTES.md"].map((name) => {
    const p = path.join(out, name);
    const st = fs.statSync(p);
    return { name, size: st.size, sha256: hashFile(p, "sha256").toString("hex").toUpperCase() };
  }),
};
fs.writeFileSync(path.join(out, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log("[release] ✓ 版本 " + v + "，安装包 " + sizeText + " B");
console.log("[release]   SHA-256 " + sha256);
console.log("[release]   输出目录 " + out);
console.log("");
console.log("上传（GitHub Releases，需先 gh auth login）：");
const uploads = ["latest.yml", ymlPathName, path.basename(blockPath)]
  .map((n) => '"' + path.join(out, n) + '"')
  .join(" ");
console.log('  gh release create v' + v + " " + uploads + ' --title "大肥鱼 ' + v + '" --notes-file "' + path.join(out, "RELEASE-NOTES.md") + '"');
console.log("");
console.log("只上传 latest.yml、ASCII 安装包与 .blockmap 即可支持自动更新；RELEASE-NOTES.md 给 Release 正文用。");
