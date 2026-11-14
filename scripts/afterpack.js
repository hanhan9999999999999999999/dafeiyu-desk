// electron-builder afterPack 钩子：给打出来的 exe 盖图标和版本信息。
//
// 为什么不用 electron-builder 自带的 rcedit：
// 它需要先从 github 下载 winCodeSign-2.6.0.7z，国内网络拉不下来，
// 整条构建会卡在 rcedit 那一步重试三次然后失败。
// 所以 win.signAndEditExecutable 保持 false，这里用项目内 tools/rcedit.exe 补。
//
// 钩子失败不阻断构建：没盖章的 exe 也能跑，只是任务管理器里看不出是谁。

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const appDir = path.join(__dirname, "..");
  const pkg = require(path.join(appDir, "package.json"));
  const rcedit = path.join(appDir, "tools", "rcedit.exe");
  const icon = path.join(appDir, "assets", "icon.ico");
  const productName = (pkg.build && pkg.build.productName) || pkg.name;
  const exe = path.join(context.appOutDir, productName + ".exe");

  if (!fs.existsSync(rcedit)) {
    console.log("  • [stamp] 跳过：tools/rcedit.exe 不存在");
    return;
  }
  if (!fs.existsSync(exe)) {
    console.log("  • [stamp] 跳过：找不到 " + exe);
    return;
  }

  const args = [
    exe,
    "--set-icon", icon,
    "--set-file-version", pkg.version,
    "--set-product-version", pkg.version,
    "--set-version-string", "ProductName", productName,
    "--set-version-string", "FileDescription", pkg.description || productName,
    "--set-version-string", "CompanyName", pkg.author || "",
    "--set-version-string", "LegalCopyright", (pkg.build && pkg.build.copyright) || "",
    "--set-version-string", "OriginalFilename", path.basename(exe),
    "--set-version-string", "InternalName", pkg.name,
  ];

  try {
    execFileSync(rcedit, args, { stdio: "inherit" });
    console.log("  • [stamp] exe 图标与版本信息已写入");
  } catch (e) {
    console.log("  • [stamp] 失败（不影响安装包生成）：" + e.message);
  }
};
