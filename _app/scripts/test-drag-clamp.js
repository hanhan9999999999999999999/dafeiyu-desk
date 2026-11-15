// 守护：拖窗口必须被夹在屏幕可视区内。
// 事故背景：拖拽时直接把光标位移加到窗口坐标上，能把窗口拖出屏幕；
// 底边一出去，「发送 / 看屏幕 / 对话 / 档案」那排按钮整条落在屏幕外——
// 看着像在，点哪都没反应。用户只会说「按钮点不开东西」，很难联想到是窗口位置。
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(ROOT, "src", "main.js"), "utf8");

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

function block(startMarker, endMarker) {
  const a = main.indexOf(startMarker);
  if (a < 0) return "";
  const b = main.indexOf(endMarker, a + startMarker.length);
  return main.slice(a, b < 0 ? a + 1200 : b);
}

const move = block('ipcMain.on("win:dragMove"', 'ipcMain.on("win:dragEnd"');
const end = block('ipcMain.on("win:dragEnd"', 'ipcMain.on("win:moveBy"');

ok("dragMove 处理器存在", move.length > 0);
ok("dragMove 用「所有屏幕并集」夹取（允许跨屏、不在单屏边缘卡死）", /clampToAllDisplays\(/.test(move));
ok("dragMove 不会在单屏 workArea 上硬夹", !/ensureStartPos\(/.test(move));
ok("dragMove 直接落夹取结果", /win\.setPosition\(c\.x, c\.y\)/.test(move));
ok("dragMove 不再直接 setPosition(nx, ny)", !/setPosition\(nx,\s*ny\)/.test(move));

ok("dragEnd 处理器存在", end.length > 0);
ok("dragEnd 保存的是夹取后的坐标", /S\.patch\(\{\s*x:\s*c\.x,\s*y:\s*c\.y\s*\}\)/.test(end));
ok("dragEnd 不再保存原始 getPosition", !/const \[x, y\] = win\.getPosition\(\);\s*S\.patch\(\{ x, y \}\)/.test(end));

// ensureStartPos 本身的语义：夹到 workArea 之内，且不会因为窗口比屏幕大而算出反向区间
const fn = block("function ensureStartPos", "// 拔掉外接屏");
ok("ensureStartPos 用 workArea 而不是 bounds", /workArea/.test(fn));
ok("ensureStartPos 对超大窗口做了兜底（maxX/maxY 不小于屏幕原点）", /Math\.max\(a\.x,\s*a\.x \+ a\.width - w\)/.test(fn) && /Math\.max\(a\.y,\s*a\.y \+ a\.height - h\)/.test(fn));

// 模拟这段数学：窗口 322x444，屏幕 1920x1080，往右下拖到 (1900, 1200)
function clamp(x, y, w, h, a) {
  const maxX = Math.max(a.x, a.x + a.width - w);
  const maxY = Math.max(a.y, a.y + a.height - h);
  return { x: Math.round(Math.min(Math.max(x, a.x), maxX)), y: Math.round(Math.min(Math.max(y, a.y), maxY)) };
}
const area = { x: 0, y: 0, width: 1920, height: 1080 };
const c1 = clamp(1900, 1200, 322, 444, area);
ok("右下越界被夹回 (1598,636)", c1.x === 1598 && c1.y === 636, JSON.stringify(c1));
const c2 = clamp(-500, -300, 322, 444, area);
ok("左上越界被夹回 (0,0)", c2.x === 0 && c2.y === 0, JSON.stringify(c2));
ok("屏幕内位置不动", clamp(800, 400, 322, 444, area).x === 800);
const big = { x: 0, y: 0, width: 200, height: 200 };
const c3 = clamp(50, 50, 400, 400, big);
ok("窗口比屏幕大时退回屏幕原点，不产生负数", c3.x === 0 && c3.y === 0, JSON.stringify(c3));

// 并集夹取：两块屏（主屏 1920x1080 + 下方第二屏 y=1080..2160）时，窗口能一路拖到下屏
function clampUnion(x, y, w, h, ds) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of ds) {
    minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x + a.width); maxY = Math.max(maxY, a.y + a.height);
  }
  return { x: Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX - w))), y: Math.round(Math.min(Math.max(y, minY), Math.max(minY, maxY - h))) };
}
const two = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -954, y: 1080, width: 1920, height: 1080 }];
const u1 = clampUnion(666, 1080, 322, 444, two);
ok("跨屏位置不被单屏夹住（下屏 y=1080 保留）", u1.y === 1080, JSON.stringify(u1));
const u2 = clampUnion(666, -900, 322, 444, two);
ok("往屏幕上方拖出去会被拉回最上面那块屏的顶边", u2.y === 0, JSON.stringify(u2));
ok("并集夹取不限制横向跨屏", clampUnion(-900, 1200, 322, 444, two).x === -900);

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
if (fail) process.exitCode = 1;
