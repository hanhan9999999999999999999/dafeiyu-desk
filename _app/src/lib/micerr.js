// 麦克风错误翻译：把 DOMException 的 name 翻成「用户能照着做」的一句话。
// 实测的坑：这些 name 在 Electron / Windows 上并不总是同一个，
// 同一个原因可能报 NotAllowedError、PermissionDeniedError 或 SecurityError，
// 所以按「最具体的先匹配」写成表，最后一定有一句兜底，不许出现空文案。
//
// 两句话分开：
//   short  —— 给她说的一句（气泡，短，带情绪）
//   detail —— 给设置页/日志的一句（说清下一步动哪里）
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.__fishMicErr = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TABLE = [
    {
      code: "denied",
      re: /^(NotAllowedError|PermissionDeniedError|PermissionDismissedError)$/,
      short: "系统不让我听声音…",
      detail: "麦克风权限没给。Windows 设置 → 隐私和安全性 → 麦克风 → 打开「允许桌面应用访问麦克风」，然后回来再点一次。",
    },
    {
      code: "nodevice",
      re: /^(NotFoundError|DevicesNotFoundError)$/,
      short: "我听不到你，好像没有麦克风…",
      detail: "电脑上找不到可用的麦克风。插一个，或者到「设置 → 系统 → 声音 → 输入」看看设备在不在、有没有被禁用。",
    },
    {
      code: "busy",
      re: /^(NotReadableError|TrackStartError)$/,
      short: "麦克风被别人占着呢",
      detail: "设备被别的程序独占了（会议、录音、直播软件最常见）。关掉那个程序，或者换一个麦克风再试。",
    },
    {
      code: "unsupported",
      re: /^(OverconstrainedError|ConstraintNotSatisfiedError)$/,
      short: "这个麦克风我调不动…",
      detail: "设备不支持当前要求的参数。到设置里把麦克风换成「系统默认」，或者换一个设备。",
    },
    {
      code: "insecure",
      re: /^(SecurityError|TypeError)$/,
      short: "这里不让我听声音…",
      detail: "当前页面环境不允许使用麦克风（不是安全上下文，或者被策略拦了）。重启程序再试。",
    },
    {
      code: "aborted",
      re: /^(AbortError)$/,
      short: "刚打开就被打断了",
      detail: "设备初始化被中断（通常是插拔设备或系统正在切换默认设备）。再点一次就好。",
    },
    {
      code: "lost",
      re: /^(Lost|MicLost)$/,
      short: "麦克风掉线了…",
      detail: "麦克风在说话中途断开了（拔出、蓝牙断开、设备被禁用）。插回去之后重新点一次开麦。",
    },
  ];

  const OTHER = {
    code: "other",
    short: "麦克风打不开…",
    detail: "没能打开麦克风。换一个输入设备试试；还不行就把程序重启一次。",
  };

  // e 可以是 DOMException、{ name } 或字符串；认不出来就归 other。
  function micErrText(e) {
    const name = String((e && e.name) || "").trim();
    const msg = String((e && e.message) || (typeof e === "string" ? e : "") || "").trim();
    for (const row of TABLE) {
      if (row.re.test(name)) {
        return { code: row.code, short: row.short, detail: row.detail, name: name, message: msg };
      }
    }
    return { code: OTHER.code, short: OTHER.short, detail: OTHER.detail, name: name, message: msg };
  }

  return { micErrText, TABLE, OTHER };
});
