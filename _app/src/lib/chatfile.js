/* 对话记录的"文件格式"层：只做解析与序列化，不碰磁盘、不碰 Electron。
 *
 * 为什么单独抽出来：这段逻辑以前埋在 main.js 的 chatLoad() 里，一条 catch 全吃掉。
 * 结果是——chatlog.json 一旦读不懂（半截写、磁盘满、用户手改坏），
 * 程序当它是空数组继续跑，下一次 chatSaveSoon() 就把空列表写回去，
 * 用户攒了几千条记录就这么没了，而且没有任何痕迹。
 *
 * 现在"读不懂"是一个能被上层看见的返回值（error），由上层决定：
 * 先把原文件留一份，再当空处理。
 *
 * 浏览器里挂 window.__fishChatFile，Node 里直接 require。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.__fishChatFile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX = 3000;
  const VERSION = 1;

  // 一条记录长成什么样才算数：有正文、角色只有两种、时间是个数。
  // id 允许是空串——新建的那条本来就没有 id，由调用方按时间生成。
  function normalizeItem(m, fallbackAt) {
    if (!m || typeof m !== "object") return null;
    const text = typeof m.text === "string" ? m.text : "";
    if (!text.trim()) return null;
    return {
      id: String(m.id || ""),
      role: m.role === "assistant" ? "assistant" : "user",
      text: text,
      at: Number(m.at) || Number(fallbackAt) || Date.now(),
      streaming: !!m.streaming,
    };
  }

  /* parseChat(raw) -> { items, count, dropped, cut, error }
   *
   * error 的取值：
   *   ""      读得懂
   *   "empty" 文件是空的（可能是刚建、也可能是被清空）——不算损坏，但也不当有内容
   *   "json"  不是合法 JSON
   *   "shape" 是 JSON 但既不是数组、也没有 items 数组
   *
   * dropped 是"有字段但不合格"的条数（没有正文的），cut 是超过上限被丢掉的条数。
   * 两个都如实报出来，上层写日志——不要默默改用户的记录。
   */
  function parseChat(raw) {
    const src = typeof raw === "string" ? raw : "";
    if (!src.trim()) return { items: [], count: 0, dropped: 0, cut: 0, error: "empty" };

    let j = null;
    try {
      j = JSON.parse(src);
    } catch (e) {
      return { items: [], count: 0, dropped: 0, cut: 0, error: "json" };
    }

    const arr = Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : null);
    if (!arr) return { items: [], count: 0, dropped: 0, cut: 0, error: "shape" };

    const items = [];
    for (const m of arr) {
      const it = normalizeItem(m, 0);
      if (it) items.push(it);
    }
    const dropped = arr.length - items.length;
    const cut = items.length > MAX ? items.length - MAX : 0;
    const kept = cut ? items.slice(cut) : items;

    return { items: kept, count: kept.length, dropped: dropped, cut: cut, error: "" };
  }

  // 写盘之前统一过一遍：脏字段清掉、超上限砍掉最早的。
  // 和 parseChat 走同一个 normalizeItem，保证写出去的东西下次一定读得回来。
  function serializeChat(items) {
    const arr = [];
    for (const m of Array.isArray(items) ? items : []) {
      const it = normalizeItem(m, 0);
      if (it) arr.push(it);
    }
    const cut = arr.length > MAX ? arr.length - MAX : 0;
    const kept = cut ? arr.slice(cut) : arr;
    return JSON.stringify({ version: VERSION, items: kept });
  }

  // 坏文件改名用：chatlog.json -> chatlog.json.bad-2026-11-15T05-30-00-000Z
  // 时间戳里的冒号和点必须换掉，Windows 文件名不允许。
  function badName(file, stamp) {
    const d = String(stamp || new Date().toISOString()).replace(/[:.]/g, "-");
    return String(file || "chatlog.json") + ".bad-" + d;
  }

  return {
    parseChat: parseChat,
    serializeChat: serializeChat,
    normalizeItem: normalizeItem,
    badName: badName,
    MAX: MAX,
    VERSION: VERSION,
  };
});
