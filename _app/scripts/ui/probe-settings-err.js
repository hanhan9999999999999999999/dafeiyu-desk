// 触发一次辅助窗口的未捕获错误，用来验证 errlog.js → 主进程 run.log 这条链。
// 不真的 throw（CDP 会把异常算进 smoke 的错误数），改成派发一个 ErrorEvent：
// 走的是同一个 window error 监听器，但不污染控制台。
window.dispatchEvent(new ErrorEvent("error", {
  message: "probe-settings-synthetic",
  error: new Error("probe-settings-synthetic"),
  filename: "probe.js",
  lineno: 12,
}));
"sent";
