// 冒烟探针：在桌宠主窗里打开「相处档案」，供 smoke-electron 的 --eval-file 使用。
// 返回 JSON 字符串，test-ui.js 会解析它确认调用成功。
(async () => {
  if (!(window.deskfish && window.deskfish.openProfile)) {
    return JSON.stringify({ ok: false, why: "no openProfile api" });
  }
  try {
    const ret = await window.deskfish.openProfile();
    return JSON.stringify({ ok: true, ret: ret === undefined ? null : ret });
  } catch (e) {
    return JSON.stringify({ ok: false, why: String((e && e.message) || e) });
  }
})()
