// 冒烟探针：在「相处档案」窗口里量一遍布局。
// 检查的是验收清单里那三条人类能看见的事：窗口尺寸、标题栏可拖动、内容不溢出。
(() => {
  const body = document.querySelector(".body");
  const head = document.querySelector(".head");
  const foot = document.querySelector(".foot");
  const cs = body ? getComputedStyle(body) : null;
  const bodyRect = body ? body.getBoundingClientRect() : null;
  const footRect = foot ? foot.getBoundingClientRect() : null;
  const last = body && body.lastElementChild;
  const lastRect = last ? last.getBoundingClientRect() : null;
  return {
    url: location.href,
    w: innerWidth,
    h: innerHeight,
    dpr: devicePixelRatio,
    headDrag: head ? getComputedStyle(head).webkitAppRegion : null,
    bodyClientH: body ? body.clientHeight : null,
    bodyScrollH: body ? body.scrollHeight : null,
    bodyBottom: bodyRect ? Math.round(bodyRect.bottom) : null,
    overflowY: cs ? cs.overflowY : null,
    docScrollW: document.documentElement.scrollWidth,
    footTop: footRect ? Math.round(footRect.top) : null,
    footBottom: footRect ? Math.round(footRect.bottom) : null,
    lastBottom: lastRect ? Math.round(lastRect.bottom) : null,
    scrollable: body ? body.scrollHeight > body.clientHeight + 1 : null,
  };
})()
