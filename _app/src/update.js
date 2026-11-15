// 版本比较 + 检查更新（GitHub Releases 的 latest）。
//
// 抽成独立模块的原因：这段逻辑以前埋在 main.js 里，只能靠真联网才走到，
// 断网/限流/404/预发布这些分支从来没被跑过。现在 fetch 由调用方注入：
// 生产用 Electron 的 net.fetch（走系统代理），测试用假响应把每个分支都点一遍。

// 只解析到主.次.修 + 后缀；预发布版本按「后缀非空 = 更旧」处理。
function verParts(v) {
  const m = String(v || "").trim().replace(/^v/i, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return { n: [+m[1] || 0, +m[2] || 0, +m[3] || 0], pre: m[4] || "" };
}

// 返回 > 0 表示 a 比 b 新。
function verCmp(a, b) {
  const x = verParts(a);
  const y = verParts(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  }
  // 1.2.0 比 1.2.0-beta 新
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/**
 * 查最新版本。
 * @param {object} o
 * @param {string} o.current   本地版本（app.getVersion()）
 * @param {string} o.api       latest release 的 API 地址
 * @param {string} o.page      下载页地址（没有 Release 时也让用户有地方去）
 * @param {Function} o.fetchImpl   fetch 实现；生产传 net.fetch.bind(net)
 * @param {number} [o.timeoutMs]   超时，默认 9 秒
 */
async function checkUpdate(o) {
  const current = String((o && o.current) || "");
  const api = String((o && o.api) || "");
  const page = String((o && o.page) || "");
  const fetchImpl = o && o.fetchImpl;
  const timeoutMs = Number(o && o.timeoutMs) || 9000;
  if (typeof fetchImpl !== "function") {
    return { ok: false, current, page, error: "缺少 fetch 实现" };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let r;
    try {
      r = await fetchImpl(api, {
        signal: ctl.signal,
        headers: {
          // GitHub API 不带 User-Agent 会直接 403
          "user-agent": "dafeiyu-desk/" + current,
          accept: "application/vnd.github+json",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    // 404 = 仓库还没有发布过 Release（或者仓库改名了）。不是错误，是「没有版本」。
    if (r.status === 404) {
      return { ok: true, current, latest: "", newer: false, empty: true, page };
    }
    if (r.status === 403 || r.status === 429) {
      return { ok: false, current, page, error: "查询太频繁了（GitHub 限流），过一会儿再试" };
    }
    if (!r.ok) {
      return { ok: false, current, page, error: "更新服务返回 HTTP " + r.status };
    }
    const j = await r.json().catch(() => null);
    if (!j || (!j.tag_name && !j.name)) {
      return { ok: false, current, page, error: "更新信息格式不对" };
    }
    const latest = String(j.tag_name || j.name).replace(/^v/i, "");
    const notes = String(j.body || "").trim();
    return {
      ok: true,
      current,
      latest,
      newer: verCmp(latest, current) > 0,
      // 本地这版比 GitHub 上发的还新（内测/自己编译的），前端据此换套说法，
      // 不然「已是最新版本」配「GitHub 上最新是旧版」看着像自相矛盾。
      ahead: verCmp(current, latest) > 0,
      page: j.html_url || page,
      publishedAt: j.published_at || "",
      prerelease: !!j.prerelease,
      notes: notes.length > 1400 ? notes.slice(0, 1400) + "\n…（完整说明见下载页）" : notes,
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return {
      ok: false,
      current,
      page,
      error: /abort/i.test(msg)
        ? "连不上 GitHub（" + Math.round(timeoutMs / 1000) + " 秒超时），可能是网络或代理问题"
        : msg,
    };
  }
}

module.exports = { verParts, verCmp, checkUpdate };
