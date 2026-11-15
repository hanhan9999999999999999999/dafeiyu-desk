/* 检查更新的离线断言。
 *
 * 这段逻辑以前埋在 main.js 里，只有真联网才能走到；断网、限流、404、
 * 仓库还没发 Release、版本比线上还新这些分支等于从没跑过。
 * 现在 fetch 由调用方注入，这里用假响应把每条分支点一遍。
 */
"use strict";

const { verParts, verCmp, checkUpdate } = require("../src/update");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name + (extra ? "  → " + extra : "")); }
}

// ---- 版本比较 ----
ok("v 前缀与分段缺省视为相同（1.2 vs 1.2.0）", verCmp("1.2", "1.2.0") === 0);
ok("补丁位比较（1.3.1 > 1.3.0）", verCmp("1.3.1", "1.3.0") > 0);
ok("两位进位（1.10.0 > 1.9.9）", verCmp("1.10.0", "1.9.9") > 0);
ok("预发布比正式版旧（1.2.0-beta < 1.2.0）", verCmp("1.2.0-beta", "1.2.0") < 0);
ok("带 v 前缀也能比（v1.4.0 > 1.3.0）", verCmp("v1.4.0", "1.3.0") > 0);
ok("无法解析时按相等处理", verCmp("abc", "1.3.0") === 0);
ok("verParts 解析主次修与后缀", JSON.stringify(verParts("v1.3.0-rc.2")) === JSON.stringify({ n: [1, 3, 0], pre: "rc.2" }));

// ---- 假响应 ----
const seen = [];
function fakeFetch(res) {
  return async (url, opts) => {
    seen.push({ url, opts });
    if (res instanceof Error) throw res;
    return typeof res === "function" ? res() : res;
  };
}
const body = (obj) => ({ status: 200, ok: true, json: async () => obj });
const status = (code, obj) => ({ status: code, ok: code >= 200 && code < 300, json: async () => obj });
const base = { current: "1.3.0", api: "https://api.github.com/repos/x/y/releases/latest", page: "https://github.com/x/y/releases/latest" };

(async () => {
  // 线上更新
  let r = await checkUpdate({ ...base, fetchImpl: fakeFetch(body({
    tag_name: "v1.4.0", html_url: "https://github.com/x/y/releases/tag/v1.4.0",
    body: " 修了几处小问题 ", published_at: "2026-11-01T00:00:00Z", prerelease: false,
  })) });
  ok("有更新：ok/newer/latest/ahead 正确", r.ok && r.newer && r.latest === "1.4.0" && r.ahead === false, JSON.stringify(r));
  ok("有更新：下载页用 Release 的 html_url", r.page === "https://github.com/x/y/releases/tag/v1.4.0", r.page);
  ok("有更新：说明去掉首尾空白", r.notes === "修了几处小问题", JSON.stringify(r.notes));
  ok("请求带 User-Agent 与 GitHub 的 Accept 头", /dafeiyu-desk\/1\.3\.0/.test(seen[0].opts.headers["user-agent"]) && seen[0].opts.headers.accept === "application/vnd.github+json");
  ok("请求地址就是传入的 API", seen[0].url === base.api, seen[0].url);

  // 同版本 / 本地更新
  r = await checkUpdate({ ...base, fetchImpl: fakeFetch(body({ tag_name: "v1.3.0" })) });
  ok("同版本：newer=false ahead=false", r.ok && !r.newer && !r.ahead, JSON.stringify(r));
  r = await checkUpdate({ ...base, fetchImpl: fakeFetch(body({ tag_name: "v1.2.9" })) });
  ok("本地比线上新：ahead=true newer=false", r.ok && r.ahead && !r.newer, JSON.stringify(r));
  ok("没有 html_url 时回落到传入的下载页", r.page === base.page, r.page);

  // 仓库还没发 Release
  r = await checkUpdate({ ...base, fetchImpl: fakeFetch(status(404, {})) });
  ok("404 当作「还没有版本」而不是错误", r.ok && r.empty === true && r.latest === "" && r.newer === false, JSON.stringify(r));

  // 限流
  for (const code of [403, 429]) {
    r = await checkUpdate({ ...base, fetchImpl: fakeFetch(status(code, {})) });
    ok("HTTP " + code + " 给限流文案", !r.ok && /限流/.test(r.error), r.error);
  }

  // 其它失败
  r = await checkUpdate({ ...base, fetchImpl: fakeFetch(status(500, {})) });
  ok("HTTP 500 带上状态码", !r.ok && /HTTP 500/.test(r.error), r.error);
  r = await checkUpdate({ ...base, fetchImpl: fakeFetch({ status: 200, ok: true, json: async () => { throw new Error("bad json"); } }) });
  ok("JSON 解析失败给格式文案", !r.ok && /格式/.test(r.error), r.error);
  r = await checkUpdate({ ...base, fetchImpl: fakeFetch(body({ body: "没有版本字段" })) });
  ok("缺少 tag_name/name 给格式文案", !r.ok && /格式/.test(r.error), r.error);

  // 超时与网络异常
  const abortErr = new Error("The operation was aborted");
  abortErr.name = "AbortError";
  r = await checkUpdate({ ...base, fetchImpl: fakeFetch(abortErr) });
  ok("中断归为超时文案（默认 9 秒）", !r.ok && /9 秒超时/.test(r.error), r.error);
  r = await checkUpdate({ ...base, timeoutMs: 1500, fetchImpl: fakeFetch(abortErr) });
  ok("超时时长按传入值显示", !r.ok && /2 秒超时/.test(r.error), r.error);
  r = await checkUpdate({ ...base, fetchImpl: fakeFetch(new Error("getaddrinfo ENOTFOUND")) });
  ok("网络错误原样带出，不吞", !r.ok && /ENOTFOUND/.test(r.error), r.error);

  // 长说明
  const long = "字".repeat(2000);
  r = await checkUpdate({ ...base, fetchImpl: fakeFetch(body({ tag_name: "v1.5.0", body: long })) });
  ok("超长说明截断并提示去下载页", r.notes.length < 1500 && /完整说明见下载页/.test(r.notes), String(r.notes.length));

  // 参数缺失
  r = await checkUpdate({ ...base });
  ok("没有 fetch 实现时明确报错而不是抛异常", !r.ok && /fetch/.test(r.error), r.error);

  console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("测试自身崩了：" + (e && e.stack || e));
  process.exit(1);
});
