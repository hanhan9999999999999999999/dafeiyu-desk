"use strict";
// 真机 UI 验收：启动打包前的源码版，打开「相处档案」量布局、
// 从主进程走一遍托盘快捷互动、最后按 Esc 关窗。
// 用法：node scripts/test-ui.js        全部通过退出 0，否则 1。
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = [
  "scripts/smoke-electron.js",
  "--wait", "9000",
  "--eval-file", "scripts/ui/open-profile.js",
  "--eval-wins", "profile=@scripts/ui/inspect-profile.js",
  "--main-eval-file", "scripts/ui/quick-pet-esc.js",
];

const child = spawn(process.execPath, ARGS, { cwd: ROOT, env: process.env });
let out = "";
child.stdout.on("data", (d) => { out += d.toString(); process.stdout.write(d); });
child.stderr.on("data", (d) => { out += d.toString(); process.stderr.write(d); });

child.on("exit", (code) => {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  add("冒烟进程有输出", out.includes("[smoke] 启动"), out.split("\n")[0] || "(empty)");
  add("页面无 console 错误", /错误\s*:\s*无/.test(out), (out.match(/错误\s*:\s*(.+)/) || [])[1] || "未找到汇总行");

  const open = parseLine(out, "[smoke] eval → ");
  add("openProfile() 调用成功", open && open.ok === true, json(open));

  const layout = parseLine(out, "[smoke] 窗口 eval(profile) → ");
  add("档案窗口已打开", layout && /\/src\/profile\.html$/.test(layout.url || ""), json(layout));
  if (layout) {
    add("窗口尺寸 480×706（小屏夹紧到 ≥360×520）",
      layout.w >= 360 && layout.h >= 520 && layout.h <= 706, `${layout.w}×${layout.h}`);
    add("标题栏可拖动", layout.headDrag === "drag", String(layout.headDrag));
    add("正文不溢出", layout.scrollable === false && layout.bodyScrollH === layout.bodyClientH,
      `${layout.bodyScrollH}/${layout.bodyClientH} scrollable=${layout.scrollable}`);
    add("底部按钮在窗内", layout.footBottom <= layout.h + 1,
      `footBottom=${layout.footBottom} h=${layout.h}`);
    add("正文最后一行没被底栏盖住", layout.lastBottom <= layout.footTop,
      `last=${layout.lastBottom} footTop=${layout.footTop}`);
    add("没有横向滚动", layout.docScrollW <= layout.w, `docScrollW=${layout.docScrollW}`);
  } else {
    add("档案布局数据", false, "解析失败");
  }

  const main = parseLine(out, "[smoke] 主进程 eval → ");
  // 主进程探针超时的时候，out 里只有一行「[smoke] 主进程 eval 失败：Runtime.evaluate 超时」，
  // 直接 add(... , null) 会变成一条看不出原因的「解析失败」。把那一行带进 detail。
  const mainFail = (out.match(/\[smoke\] 主进程 eval 失败：(.+)/) || [])[1];
  add("快捷互动探针返回", main && main.ok === true,
    main ? json(main) : (mainFail ? "主进程 eval 失败：" + mainFail.trim() : json(main)));
  if (main) {
    add("喂食有气泡回应", /谢谢主人/.test((main.afterFeed && main.afterFeed.text) || ""), json(main.afterFeed));
    add("冷却时说明原因", !!(main.afterCooldown && main.afterCooldown.text) &&
      main.afterCooldown.text !== (main.afterFeed && main.afterFeed.text), json(main.afterCooldown));
    add("摸头有气泡回应", /再摸一下|也蹭一下|睡着/.test((main.afterPet && main.afterPet.text) || ""), json(main.afterPet));
    const al = main.a11y || {};
    add("气泡是 live region（读屏会念）",
      al.bubbleRole === "status" && al.bubbleLive === "polite" && main.afterFeed.role === "status",
      json(al));
    add("错误条可被读屏打断", al.errRole === "alert" && al.errLive === "assertive", json(al));
    add("输入框有可读名称", !!al.inputLabel, String(al.inputLabel));
    add("Esc 关闭档案窗口", main.escClosed === true, String(main.escClosed));
    add("留下档案窗口实拍图", typeof main.shot === "string" && fs.existsSync(main.shot), String(main.shot));
    add("养成面板能打开", main.panelOpened === true, String(main.panelOpened));
    add("正在输入时 Esc 不抢", main.escWhileTypingKeptOpen === true, String(main.escWhileTypingKeptOpen));
    const a = main.panelA11y || {};
    add("活动卡片可 Tab 到达且都是 tabIndex 0", a.cardCount >= 13 && a.allTabIndex === true,
      `cards=${a.cardCount} allTab=${a.allTabIndex} focusables=${a.focusables}`);
    add("活动卡片都带读屏标签", a.allLabelled === true, JSON.stringify((a.focusOrder || []).slice(0, 6)));
    add("Enter 开始活动、再按一次停止", a.started === true && a.stopped === true,
      `${a.cardId}: ${a.saidStart} → ${a.saidStop}`);
    add("灰掉的活动卡读屏会念原因",
      a.disabledCount === 0 || (a.disabledLabels || []).every((s) => /冷却|体力|忙|不够|没/.test(s)),
      `disabled=${a.disabledCount} ${JSON.stringify((a.disabledLabels || []).slice(0, 3))}`);
    add("Tab 顺序覆盖活动卡、食盆、摸头",
      (a.focusOrder || []).includes("touch") && (a.focusOrder || []).some((s) => /^food/.test(s)),
      (a.focusOrder || []).slice(0, 12).join(" → "));
    add("真按 Tab 焦点会移动", !!(main.tabFocus && main.tabFocus.moved), json(main.tabFocus));
    add("焦点落在控件上有可见焦点环", !!(main.tabFocus && main.tabFocus.ring),
      main.tabFocus && main.tabFocus.after1 && main.tabFocus.after1.outline);
    add("失焦后 Esc 关闭养成面板", main.escAfterBlurClosed === true, String(main.escAfterBlurClosed));
    add("测试连接能连上并列出地址行",
      !!(main.bridgeTest && main.bridgeTest.ok && main.bridgeTest.rows === 2), json(main.bridgeTest));
    add("地址行是可聚焦的按钮（role/tabIndex）",
      !!(main.bridgeTest && (main.bridgeTest.roles || []).every((r) => r === "button") &&
        (main.bridgeTest.tabIndexes || []).every((t) => t === 0)),
      json(main.bridgeTest && { roles: main.bridgeTest.roles, tabIndexes: main.bridgeTest.tabIndexes }));
    add("地址行按 Enter 会切换地址",
      !!(main.bridgeTest && main.bridgeTest.picked === "http://127.0.0.1:47124"),
      main.bridgeTest && main.bridgeTest.picked);
    add("许可弹层能打开且是新条款",
      !!(main.licenseModal && main.licenseModal.open && main.licenseModal.hasModelPolicy &&
        main.licenseModal.textLen > 800), json(main.licenseModal));
    add("许可弹层不越出窗口",
      !!(main.licenseModal && main.licenseModal.boxBottom <= main.licenseModal.winH + 1),
      json(main.licenseModal && { boxBottom: main.licenseModal.boxBottom, winH: main.licenseModal.winH }));
    add("Esc 只关许可弹层、不关设置窗",
      main.licenseEscClosed === true && main.settingsClosed === true,
      `modalClosed=${main.licenseEscClosed} settingsClosed=${main.settingsClosed}`);
    add("设置页每个控件都有可读名称",
      !!(main.formLabels && main.formLabels.count >= 20 && (main.formLabels.bad || []).length === 0),
      json(main.formLabels));
    const sf = main.searchFocus || {};
    add("Ctrl+F 聚焦设置搜索框", sf.afterCtrlF === true, String(sf.afterCtrlF));
    add("搜索结果会被读屏念出数量",
      !!(sf.live && sf.live.role === "status" && sf.live.live === "polite" &&
        sf.live.shown === true && /找到 \d+ 项/.test(sf.live.text || "")), json(sf.live));
    add("回车把焦点送到第一个命中控件", !!sf.focused && sf.focused !== "q", String(sf.focused));
    add("Esc 清空搜索", sf.cleared === true, json(sf));
    add("最小化停渲染",
      !!(main.minimized && main.minimized.paused === true && main.minimized.ticking === false),
      json(main.minimized && { paused: main.minimized.paused, ticking: main.minimized.ticking }));
    add("还原后恢复渲染",
      !!(main.restored && main.restored.paused === false && main.restored.ticking === true),
      json(main.restored && { paused: main.restored.paused, ticking: main.restored.ticking }));
    add("锁屏事件停渲染",
      !!(main.lockPaused && main.lockPaused.paused === true && main.lockPaused.ticking === false),
      main.lockError || json(main.lockPaused && { paused: main.lockPaused.paused, ticking: main.lockPaused.ticking }));
    add("解锁后恢复渲染",
      !!(main.lockResumed && main.lockResumed.paused === false && main.lockResumed.ticking === true),
      main.lockError || json(main.lockResumed && { paused: main.lockResumed.paused, ticking: main.lockResumed.ticking }));
    add("右键菜单能在窗口里弹出",
      !!(main.menuPopup && main.menuPopup.ret === true), json(main.menuPopup));
    const ch = main.churn || {};
    add("反复开关 12 次窗口不重复创建", ch.opened === 12 && (ch.leaks || []).length === 0,
      json({ opened: ch.opened, leaks: ch.leaks }));
    add("关完只剩主窗", ch.endCount === 1, json({ endCount: ch.endCount }));
    add("看屏幕说清「本机桥接没在跑」",
      !!(main.seeHint && /没在跑/.test(main.seeHint.own)), json(main.seeHint && { own: main.seeHint.own }));
    add("切外部接口后换文案并露出地址/模型输入框",
      !!(main.seeHint && /外部视觉接口/.test(main.seeHint.api) &&
        main.seeHint.boxVisible && main.seeHint.inputsVisible),
      json(main.seeHint && { api: main.seeHint.api, box: main.seeHint.boxVisible, inputs: main.seeHint.inputsVisible }));
    for (const [name, label] of [["seewatch", "看屏幕"], ["chatlog", "对话记录"], ["welcome", "首次引导"]]) {
      const it = (main.aux || []).find((x) => x.name === name);
      // 焦点环按「这一轮里至少有一次键盘焦点带环」判定，避免窗口刚失焦那一下的假阴性。
      const moved = !!(it && it.open && (name === "welcome" ? it.f1 && it.f1.id === "ok" : it.moved));
      add(`${label}窗口真按 Tab 焦点${name === "welcome" ? "落在主按钮上" : "会移动"}`, moved,
        json(it && { f1: it.f1, f2: it.f2, open: it.open, error: it.error }));
      add(`${label}窗口焦点环可见`, !!(it && it.open && it.ring),
        json(it && (it.open ? (it.seq || []).map((f) => f && f.outline) : it.error)));
    }
  } else {
    add("快捷互动探针数据", false, "解析失败");
  }

  const failed = checks.filter((c) => !c.ok);
  console.log("\n========== UI 验收 ==========");
  for (const c of checks) console.log(`${c.ok ? "✅" : "❌"} ${c.name}  ${c.ok ? "" : "→ " + c.detail}`);
  console.log(`结果：${checks.length - failed.length} 通过，${failed.length} 失败`);
  console.log("=============================");
  process.exit(failed.length ? 1 : 0);
});

function parseLine(text, prefix) {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(prefix));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(prefix.length).trim());
  } catch {
    return null;
  }
}

function json(v) {
  if (v === null || v === undefined) return "null";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 220 ? s.slice(0, 217) + "..." : s;
}
