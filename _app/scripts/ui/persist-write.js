// 改一批「跨重启必须活着」的设置，然后让 test-persist 用同一个 userData 再起一次读回来。
// 覆盖的字段挑选原则：用户改过就会记住行为差异的那些（音量/缩放/帧率上限/超采样/静音/
// 置顶/穿透/跟随鼠标/空闲小动作/闪烁/锐化/输入条自动隐藏/看屏幕间隔与点评间隔/快捷键/取景矩形），
// 而不是挑「默认值本来就一样」的字段——那样测了等于没测。
const want = {
  volume: 0.37,
  scale: 1.15,
  resolution: 1,
  fpsCap: 15,
  mute: true,
  alwaysOnTop: false,
  clickThrough: false,
  followCursor: false,
  autoIdle: false,
  blinkEnabled: false,
  sharpen: false,
  dockAutoHide: false,
  seeInterval: 3.2,
  seeGap: 21,
  hotkeyMic: "",
  hotkeySummon: "CommandOrControl+Alt+K",
  viewBox: { y: 0.11, h: 0.28, pack: "dafeiyu" },
};
window.deskfish.settingsPatch(want).then((s) =>
  "settings:saved:" + JSON.stringify({
    volume: s.volume, scale: s.scale, resolution: s.resolution, fpsCap: s.fpsCap,
    mute: s.mute, alwaysOnTop: s.alwaysOnTop,
  })
);
