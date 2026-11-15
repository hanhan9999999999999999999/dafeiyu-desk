/**
 * 说话失败的原因分类。
 *
 * 为什么需要它：`voice.js` 的 `speak()` 有一条五级降级链 —
 * 飞鱼流式 → 分段流式 → RVC → 内置引擎 → DSH 桥接。每一级失败都只是
 * `log(...)` 一句然后往下试，整条链都不行时 `return false`。调用方
 * （`finishReply` / `speakAndShow`）以前不检查返回值，于是 — 她一声不吭，
 * 用户完全不知道是「引擎没起来」「RVC 崩了」还是「桥接断了」。
 *
 * 所以这里把各条链路的原始报错翻成两句：
 *   - `short`：她说的那句（进气泡），短、说人话；
 *   - `detail`：设置页 / 诊断包读的那句，说清下一步动哪里。
 *
 * 和 `lib/micerr.js` 同一个写法（UMD，浏览器挂 `window.__fishVoiceErr`，
 * Node 里能直接 require），因为两边是同一类问题：技术错误 → 人话。
 *
 * 归类原则：**按最具体的先匹配**。同一个失败在不同机器上措辞不一样
 * （引擎没起可能是 `Failed to fetch`，也可能是 `合成 HTTP 502`），
 * 所以列表要覆盖得住，最后一定要有兜底 —— 不许出现空文案。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.__fishVoiceErr = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TABLE = [
    {
      code: "bridge",
      re: /拿不到 token|拿不到 bridge|send 没成功|连不上 DSH/i,
      short: "连不上 DSH，我说不出话",
      detail:
        "回复是从 DSH 那边拿的，桥接断了就既听不到也说不出来。看看 DSH 是不是还开着、" +
        "设置里的桥接地址填对没有。",
    },
    {
      code: "rvc",
      re: /RVC HTTP|换音色/i,
      short: "换音色那一步坏了",
      detail:
        "语音已经合成出来了，但过 RVC 换音色时失败。先到设置里把「语音输出」切回普通 TTS 试试 —— " +
        "能出声就说明是 RVC 那边的问题（模型没装好、显卡被别的程序占着、或者后端进程没起来）。",
    },
    {
      code: "missing",
      re: /取音频 HTTP 40|HTTP 404|找不到音频文件/i,
      short: "音频文件找不到了",
      detail:
        "引擎说合成好了，但取文件时 404。多半是临时目录被清理软件的清掉了，" +
        "重装一次程序或者重启一下就能好。",
    },
    {
      code: "engine",
      re: /合成 HTTP|流式 HTTP|流式没有 body|引擎|engine/i,
      short: "本地语音引擎没起来，我说不出话",
      detail:
        "带在程序里的 TTS 引擎没响应。多数是它启动失败或被杀软拦了 —— " +
        "打开「设置 → 打开日志文件」看最后几行有没有 engine 的报错，还不行就重装一次。",
    },
    {
      code: "noaudio",
      re: /没有音频|没有拿到音频|没给音频/i,
      short: "引擎说合成完了，可我没听到声音",
      detail:
        "引擎返回成功但没给音频文件。换个音色试试；如果只有某个音色不行，那个音色可能没装完整。",
    },
    {
      code: "timeout",
      re: /首段超时|timed out|timeout|aborted due to timeout|AbortError/i,
      short: "等太久了，声音没出来",
      detail:
        "合成超时。飞鱼和 RVC 都吃显卡，显卡被别的程序占着时会拖很久 —— " +
        "先关掉游戏/录屏，或者把「语音输出」换成占用小的普通 TTS。",
    },
    {
      code: "offline",
      re: /Failed to fetch|NetworkError|ERR_CONNECTION|ERR_NAME/i,
      short: "连不上语音服务",
      detail:
        "请求根本没发出去。如果是刚开机，等几秒再试；一直这样就看看是不是被防火墙拦了。",
    },
  ];

  const OTHER = {
    code: "other",
    short: "说话出了点问题",
    detail: "这次的错误我没有现成的解释。打开「设置 → 导出诊断包」发给开发者，里面有完整日志。",
  };

  /**
   * @param {any} e 原始错误（Error / DOMException / 字符串 / null）
   * @returns {{code: string, short: string, detail: string, raw: string}}
   */
  function voiceErrText(e) {
    const raw = String((e && e.message) || e || "").trim();
    for (let i = 0; i < TABLE.length; i += 1) {
      if (TABLE[i].re.test(raw)) {
        const t = TABLE[i];
        return { code: t.code, short: t.short, detail: t.detail, raw: raw };
      }
    }
    return { code: OTHER.code, short: OTHER.short, detail: OTHER.detail, raw: raw };
  }

  return { voiceErrText: voiceErrText, TABLE: TABLE, OTHER: OTHER };
});
