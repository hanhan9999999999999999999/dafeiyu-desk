// 只读：把「应该活着」的那批设置原样带回来，由 test-persist.js 逐项比对。
window.deskfish.settingsGet().then((s) =>
  JSON.stringify({
    volume: s.volume,
    scale: s.scale,
    resolution: s.resolution,
    fpsCap: s.fpsCap,
    mute: s.mute,
    alwaysOnTop: s.alwaysOnTop,
    clickThrough: s.clickThrough,
    followCursor: s.followCursor,
    autoIdle: s.autoIdle,
    blinkEnabled: s.blinkEnabled,
    sharpen: s.sharpen,
    dockAutoHide: s.dockAutoHide,
    seeInterval: s.seeInterval,
    seeGap: s.seeGap,
    hotkeyMic: s.hotkeyMic,
    hotkeySummon: s.hotkeySummon,
    viewBox: s.viewBox,
  })
);
