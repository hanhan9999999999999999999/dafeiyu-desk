// 恢复默认：把「恢复」之后的关键几项带回来，由 test-persist.js 比对出厂值。
// 只带 volume/scale 的话，任何一个「reset 没覆盖到」的字段都查不出来。
window.deskfish.settingsReset().then((s) =>
  JSON.stringify({
    volume: s.volume,
    scale: s.scale,
    resolution: s.resolution,
    fpsCap: s.fpsCap,
    mute: s.mute,
    alwaysOnTop: s.alwaysOnTop,
    viewBox: s.viewBox,
    hotkeySummon: s.hotkeySummon,
  })
);
