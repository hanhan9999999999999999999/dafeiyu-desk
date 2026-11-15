"use strict";
/**
 * lib/voiceerr.js 的单元测试（纯函数，不启动 Electron）。
 *
 * 这套表的价值全在「覆盖得住」和「兜得住」两件事上：
 *   - 覆盖得住：五级降级链上每一级真实会抛的措辞都在表里；
 *   - 兜得住：表里没写的新错误也一定有一句人话，绝不留空文案。
 * 所以下面既测分类，也测「任何输入都返回完整的 {code, short, detail}」。
 */
const path = require("path");
const lib = require(path.join(__dirname, "..", "src", "lib", "voiceerr.js"));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ✅ " + name + (extra ? "  " + extra : "")); }
  else { fail += 1; console.log("  ❌ " + name + (extra ? "  " + extra : "")); }
}
const codeOf = (s) => lib.voiceErrText(s).code;

console.log("[1] 五级降级链上真实会出现的措辞");

ok("桥接没给凭证 → bridge", codeOf("拿不到 bridge 地址") === "bridge");
ok("桥接没给 token → bridge", codeOf("拿不到 token") === "bridge");
ok("消息没送出去 → bridge", codeOf("send 没成功") === "bridge");

ok("合成时 5xx → engine", codeOf("合成 HTTP 502") === "engine");
ok("流式接口 5xx → engine", codeOf("流式 HTTP 503 引擎没起来") === "engine");
ok("流式没有 body → engine", codeOf("流式没有 body") === "engine");

ok("引擎说成功但没给音频 → noaudio", codeOf("没有音频") === "noaudio");
ok("飞鱼一句都没拿到 → noaudio", codeOf("没有拿到音频") === "noaudio");

ok("RVC 后端 500 → rvc", codeOf("RVC HTTP 500 模型没加载") === "rvc");

ok("取音频 404 → missing", codeOf("取音频 HTTP 404") === "missing");

ok("首段超时 → timeout", codeOf("首段超时") === "timeout");
ok("AbortSignal.timeout → timeout", codeOf("signal timed out") === "timeout");
ok("AbortError → timeout", codeOf("The operation was aborted due to timeout") === "timeout");

ok("fetch 根本没发出去 → offline", codeOf("Failed to fetch") === "offline");
ok("连接被拒 → offline", codeOf("net::ERR_CONNECTION_REFUSED") === "offline");

console.log("[2] 谁优先：最具体的先匹配");

// 「RVC HTTP 500 合成失败」里同时有 RVC 和「合成」两个词，
// 必须归到 rvc —— 否则用户会去重装引擎，而真正坏的是换音色那步。
ok("RVC 500 不被误判成 engine", codeOf("RVC HTTP 500 合成失败") === "rvc");
// 取音频 404 里也有 HTTP，但必须归到 missing（文件没了 ≠ 引擎坏了）
ok("取音频 404 不被误判成 engine", codeOf("取音频 HTTP 404") === "missing");

console.log("[3] 兜得住：表里没有的也必须是人话");

const weird = [
  null, undefined, "", "   ", "完全没见过的新错误",
  new Error("Something exploded"), { message: "中文报错" }, 12345,
];
let allOk = true;
for (const w of weird) {
  const r = lib.voiceErrText(w);
  if (!r || !r.code || !r.short || !r.detail) { allOk = false; console.log("    ⚠ 漏了：" + String(w)); }
}
ok("任何输入都返回完整的 code/short/detail", allOk);
ok("没见过的错误归到 other", lib.voiceErrText("完全没见过的新错误").code === "other");
ok("other 也让人知道下一步（导出诊断包）", /诊断包/.test(lib.voiceErrText("x").detail));
ok("raw 保留了原始报错（排障要用）", lib.voiceErrText("合成 HTTP 500").raw === "合成 HTTP 500");

console.log("[4] 表本身");

ok("七类都定义了 short 与 detail", lib.TABLE.length === 7 &&
  lib.TABLE.every((t) => t.code && t.short && t.detail && t.re));
ok("每句 short 都不长（气泡放得下）", lib.TABLE.every((t) => t.short.length <= 20));
ok("每句 detail 都说了下一步（含动作词）",
  lib.TABLE.every((t) => /设置|重装|重启|关掉|换|打开|看看|切回|等几秒/.test(t.detail)));
const codes = lib.TABLE.map((t) => t.code);
ok("code 不重复", new Set(codes).size === codes.length, codes.join("/"));

console.log("");
console.log("结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
