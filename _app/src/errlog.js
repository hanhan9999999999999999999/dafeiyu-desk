// 所有窗口共用的未捕获错误上报。
// preload 暴露的 window.deskfish.reportError 会把它写进主进程的 run.log ——
// 打包版没有 DevTools，用户看不到红字，客服只能靠这条日志判断「哪个窗口、哪一行」。
// index.html 的引擎窗口自己带了一份（要在模型脚本之前挂上），这里只服务辅助窗口。
(() => {
  if (window.__errlog) return;
  window.__errlog = true;
  const send = (info) => {
    try {
      if (window.deskfish && window.deskfish.reportError) window.deskfish.reportError(info);
    } catch (e) { /* 上报本身绝不能变成第二个错误 */ }
  };
  window.addEventListener("error", (ev) => {
    send({
      msg: ev.message || "脚本错误",
      file: ev.filename || "",
      line: ev.lineno || 0,
      col: ev.colno || 0,
      stack: (ev.error && ev.error.stack) || "",
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    send({ msg: (r && r.message) || String(r), stack: (r && r.stack) || "" });
  });
})();
