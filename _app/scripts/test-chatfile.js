"use strict";
/* 对话记录文件格式的单测：纯函数，不启动 Electron、不碰磁盘。
 *
 * 这些用例里最重要的是"读不懂"那几条——以前 chatLoad() 一条 catch 全吃掉，
 * 程序当空数组继续跑，下一次写盘就把用户几千条记录覆盖成空。
 */
const path = require("path");
const APP = path.resolve(__dirname, "..");
const lib = require(path.join(APP, "src", "lib", "chatfile.js"));

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log("✅ " + name + (detail ? "  " + detail : "")); }
  else { fails.push(name); console.log("❌ " + name + (detail ? "  " + detail : "")); }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), "实际 " + JSON.stringify(got));
}

// ---------- 1. 读得懂 ----------
{
  const raw = JSON.stringify({
    version: 1,
    items: [
      { id: "a1", role: "user", text: "你好", at: 1763000000000 },
      { id: "a2", role: "assistant", text: "在的", at: 1763000001000, streaming: false },
    ],
  });
  const r = lib.parseChat(raw);
  ok("标准格式能读出来", r.error === "" && r.items.length === 2, JSON.stringify({ error: r.error, n: r.items.length }));
  eq("第一条正文", r.items[0].text, "你好");
  eq("角色保持", r.items.map((x) => x.role), ["user", "assistant"]);
  eq("时间保持", r.items[0].at, 1763000000000);
  eq("id 保持", r.items[0].id, "a1");
}

// ---------- 2. 兼容旧格式（纯数组） ----------
{
  const r = lib.parseChat(JSON.stringify([{ role: "user", text: "旧的", at: 1 }]));
  ok("纯数组（旧格式）也读得出来", r.error === "" && r.items.length === 1);
}

// ---------- 3. 读不懂的三种 ----------
{
  const e1 = lib.parseChat("");
  eq("空文件报 empty", e1.error, "empty");
  ok("空文件当没有记录，不当损坏", e1.items.length === 0);

  const e2 = lib.parseChat('{"version":1,"items":[{"text":"半截');
  eq("半截 JSON 报 json", e2.error, "json");
  ok("半截 JSON 不许静默当空数组（调用方要看 error）", e2.error !== "");

  const e3 = lib.parseChat("{}");
  eq("没有 items 数组报 shape", e3.error, "shape");

  const e4 = lib.parseChat('{"items":"x"}');
  eq("items 不是数组也报 shape", e4.error, "shape");

  const e5 = lib.parseChat("null");
  eq("文件内容是 null 报 shape", e5.error, "shape");
}

// ---------- 4. 脏数据如实报数 ----------
{
  const r = lib.parseChat(JSON.stringify({
    items: [
      { role: "user", text: "好" },
      { role: "user", text: "   " },
      { role: "user" },
      null,
      { role: "user", text: 42 },
    ],
  }));
  eq("没有正文的被丢掉", r.items.length, 1);
  eq("丢掉几条也报出来", r.dropped, 4);
  ok("丢掉了但不算损坏", r.error === "");
}

// ---------- 5. 超上限截断最早 ----------
{
  const many = [];
  for (let i = 0; i < lib.MAX + 50; i += 1) many.push({ role: "user", text: "m" + i, at: i + 1 });
  const r = lib.parseChat(JSON.stringify({ items: many }));
  eq("只留 MAX 条", r.items.length, lib.MAX);
  eq("丢掉最早的 50 条", r.cut, 50);
  eq("留下的是最新的那条", r.items[r.items.length - 1].text, "m" + (lib.MAX + 49));
  eq("丢掉的是最早的那条", r.items[0].text, "m50");
}

// ---------- 6. 字段规范化 ----------
{
  const r = lib.parseChat(JSON.stringify({
    items: [
      { role: "system", text: "怪角色", at: "123" },
      { role: "assistant", text: "她", at: null, streaming: "yes" },
      { id: 12345, role: "user", text: "数字 id" },
    ],
  }));
  eq("不认识的角归一成 user", r.items[0].role, "user");
  eq("时间字符串转数字", r.items[0].at, 123);
  ok("时间缺失时兜底成数字", typeof r.items[1].at === "number" && r.items[1].at > 0);
  eq("streaming 归成布尔", r.items[1].streaming, true);
  eq("id 数字转字符串", r.items[2].id, "12345");
  ok("没有 id 的留空串", r.items[1].id === "");
}

// ---------- 7. 序列化往返 ----------
{
  const src = [
    { id: "x1", role: "user", text: "第一句", at: 1000 },
    { id: "x2", role: "assistant", text: "第二句", at: 2000, streaming: true },
  ];
  const s = lib.serializeChat(src);
  ok("序列化出来是合法 JSON", (() => { try { JSON.parse(s); return true; } catch (e) { return false; } })());
  const back = lib.parseChat(s);
  eq("往返之后条数一样", back.items.length, 2);
  ok("往返之后每条的关键字段一样", back.items.every((m, i) => (
    m.id === src[i].id && m.role === src[i].role && m.text === src[i].text && m.at === src[i].at
  )));
  ok("往返之后 streaming 被补成布尔（原来没写的成 false）", back.items[0].streaming === false && back.items[1].streaming === true);
  ok("序列化带了 version", JSON.parse(s).version === lib.VERSION);
}

// ---------- 8. 序列化也会清脏 ----------
{
  const s = lib.serializeChat([{ role: "user", text: "留" }, { role: "user", text: "  " }, null]);
  eq("写盘前把空正文丢掉", JSON.parse(s).items.length, 1);
}

// ---------- 9. 坏文件改名 ----------
{
  const n = lib.badName("C:\\x\\chatlog.json", "2026-11-15T05:30:00.000Z");
  ok("坏文件名带 .bad-", n.indexOf(".bad-") > 0, n);
  const base = n.split(/[\\/]/).pop();
  ok("文件名部分不许有冒号（Windows 不允许）", base.indexOf(":") < 0, base);
  ok("坏文件名里不许有点号时间部分", !/\.000Z$/.test(n), n);
  ok("保留原文件名", n.indexOf("chatlog.json") > 0, n);
}

// ---------- 10. normalizeItem ----------
{
  eq("null 归一为 null", lib.normalizeItem(null), null);
  eq("非对象归一为 null", lib.normalizeItem("x"), null);
  const it = lib.normalizeItem({ text: "a", at: 5 }, 999);
  eq("有 at 用自己的", it.at, 5);
  const it2 = lib.normalizeItem({ text: "a" }, 888);
  eq("没 at 用兜底", it2.at, 888);
}

console.log("");
console.log("结果：" + pass + " 通过，" + fails.length + " 失败");
if (fails.length) { console.log("失败项：" + fails.join(" / ")); process.exit(1); }
