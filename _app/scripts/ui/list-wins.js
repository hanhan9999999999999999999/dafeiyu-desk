// 主进程探针：列出当前所有窗口的 URL / 标题 / 尺寸 / 可见性。
// 首启验收用：干净 user-data 下应该只有主窗，并在 4.2s 后多出一张 welcome.html。
const { BrowserWindow } = require("electron");
(async () => {
  await new Promise((r) => setTimeout(r, 600));
  const wins = BrowserWindow.getAllWindows().map((w) => {
    let url = "";
    try { url = w.webContents.getURL(); } catch (e) { url = "?"; }
    const [width, height] = w.getSize();
    return { url, title: w.getTitle(), width, height, visible: w.isVisible() };
  });
  return JSON.stringify({ count: wins.length, wins });
})();
