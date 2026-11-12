// 日志：console + 文件双写。
//
// 为什么一定要写文件：打包版从开始菜单双击启动，没有控制台，stdout 直接消失。
// 用户说「她不会说话了」，如果没有日志，我唯一能做的只有猜。
//
// 为什么自己写而不是用 electron-log 之类：只需要「上次为什么挂」这一件事，
// 不需要分级、轮转保留、异步队列。两个函数够了。
//
// 注意：不要把这里改成异步写（appendFile）。Node 写文件是块缓冲的，
// 异步写会让「刚刚发生的事」在崩溃时读不到 —— 测试脚本还会读到空日志误判功能失败。

const path = require("node:path");
const fs = require("node:fs");
const { app } = require("electron");

// userData 在 app ready 之前也能拿到；拿不到就把日志功能整体降级掉，不影响主流程。
const LOG_FILE = (() => {
  try {
    return path.join(app.getPath("userData"), "run.log");
  } catch (e) {
    return null;
  }
})();

let ready = false;

function write(prefix, args) {
  if (!LOG_FILE) return;
  try {
    if (!ready) {
      ready = true;
      // 超过 2MB 就轮转一次，留一份 .1 就行 —— 不需要历史归档，只需要「上次为什么挂」。
      try {
        const st = fs.statSync(LOG_FILE);
        if (st.size > 2 * 1024 * 1024) {
          fs.renameSync(LOG_FILE, LOG_FILE + ".1");
        }
      } catch (e) {
        /* 文件不存在是常态 */
      }
    }
    // 本地时间，不是 UTC —— toISOString 给的是格林威治时间，对着屏幕看日志会差 8 小时。
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    const line =
      "[" + hh + ":" + mi + ":" + ss + "." + ms + "] " + prefix +
      args
        .map((a) =>
          typeof a === "string"
            ? a
            : (() => {
                try {
                  return JSON.stringify(a);
                } catch (e) {
                  return String(a);
                }
              })()
        )
        .join(" ") + "\n";
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (e) {
    /* 写日志失败绝不冒泡 */
  }
}

function log() {
  try {
    console.log.apply(console, arguments);
  } catch (e) {
    /* 没有控制台（打包版）会抛 EPIPE，吞掉 */
  }
  write("", Array.prototype.slice.call(arguments));
}

function logErr() {
  try {
    console.error.apply(console, arguments);
  } catch (e) { }
  write("ERR ", Array.prototype.slice.call(arguments));
}

module.exports = { log, logErr, LOG_FILE };
