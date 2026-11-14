// electron-builder 在 win.artifactName 带中文时，会把 latest.yml 里的
// url/path 写成默认的 dafeiyu-desk-setup-<version>.exe，而磁盘上的安装包
// 实际叫「大肥鱼-<version>-安装包.exe」。直接让 latest.yml 指向中文名，
// 自动更新请求里的非 ASCII 文件名容易在不同 HTTP 服务上出问题。
//
// 这里保留给用户看的中文安装包，同时在同一目录建一个 ASCII 硬链接，
// 让 latest.yml 指向它。硬链接不额外占空间，sha512/size 完全一致。
const fs = require("node:fs");
const path = require("node:path");

const dist = path.join(__dirname, "..", "dist");
const pkg = require("../package.json");
const ymlPath = path.join(dist, "latest.yml");
const cnName = `大肥鱼-${pkg.version}-安装包.exe`;
const asciiName = `dafeiyu-desk-setup-${pkg.version}.exe`;
const cnPath = path.join(dist, cnName);
const asciiPath = path.join(dist, asciiName);

if (!fs.existsSync(ymlPath)) {
  console.log("[fix-latest] 没有 latest.yml，跳过");
  process.exit(0);
}
if (!fs.existsSync(cnPath)) {
  console.log("[fix-latest] 没有 " + cnName + "，跳过");
  process.exit(0);
}

const size = fs.statSync(cnPath).size;
function ensureLink(from, to, label) {
  try {
    if (fs.existsSync(to)) fs.unlinkSync(to);
    fs.linkSync(from, to);
  } catch (e) {
    // 跨卷/权限不允许硬链接时退回复制；失败就保持中文名，不让构建挂掉。
    try {
      if (fs.existsSync(to)) fs.unlinkSync(to);
      fs.copyFileSync(from, to);
    } catch (err) {
      console.log("[fix-latest] " + label + " 别名失败：" + err.message);
    }
  }
}
ensureLink(cnPath, asciiPath, "安装包");
const cnBlock = cnPath + ".blockmap";
if (fs.existsSync(cnBlock)) ensureLink(cnBlock, asciiPath + ".blockmap", "blockmap");

let yml = fs.readFileSync(ymlPath, "utf8");
const before = yml;
yml = yml.replace(/^(\s*-\s*url:\s*).*$/m, "$1" + asciiName);
yml = yml.replace(/^path:\s*.*$/m, "path: " + asciiName);
if (yml !== before) fs.writeFileSync(ymlPath, yml, "utf8");
console.log("[fix-latest] latest.yml -> " + asciiName + " (" + size + " bytes，硬链接到 " + cnName + ")");
