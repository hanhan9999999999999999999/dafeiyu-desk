// 模型适配器 —— 前端
//
// 职责只有三件：
//   ① 把「模型库里有什么」画出来（左边）
//   ② 把「这份模型的规则配置」按 schema 画成表单（右边），改一下即时预览（中间）
//   ③ 保存时把整份 cfg 交回服务端，由规则自己去写清单
//
// 这里刻意不写任何「哪个字段是什么意思」——那是规则的事。
// 以后新增一条规则（比如「语音口型灵敏度」），只要后端多一个 rules/*.js，
// 这个文件一行都不用改，表单会自己长出来。
//
// 唯一的例外是预览：它必须知道 viewY/viewH 是「取景框」，否则画不出那个框。

(() => {
  const $ = (id) => document.getElementById(id);
  const previewEl = $("preview");
  const listEl = $("packList");
  const stepsEl = $("steps");
  const libdock = $("libdock");
  const diagEl = $("diag");
  const stageBar = $("stageBar");
  const badgeEl = $("badge");
  const toastEl = $("toast");
  const vfReadEl = $("vfRead");
  const vfCropBtn = $("vfCrop");
  const vfResetBtn = $("vfReset");
  const vfMaskL = $("vfMaskL");
  const vfMaskR = $("vfMaskR");
  // 主窗口宽高比：取景框、裁剪预览、实际桌宠窗口必须是同一个比例，否则「所见非所得」
  const WIN_AR = 460 / 560;

  const vendor = window.__dshPetLive2d;

  const S = {
    packs: [],
    curId: "",
    doc: null,        // /api/packs/:id 的返回
    cfgs: {},         // {ruleId: {key: value}}
    sliders: {},      // key -> {inp, valEl, unit}：拖动取景框时要同步滑杆
    dirty: false,
    model: null,
    app: null,
    boxEl: null,
    crop: false,       // 主窗口视图：只按 460:560 的口子显示取景框里的部分
    busy: false,
  };

  // ── 小工具 ────────────────────────────────────────────────
  let toastTimer = 0;
  function toast(text, kind) {
    toastEl.textContent = text;
    toastEl.className = "toast on" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = "toast"; }, 2400);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  async function api(path, opts) {
    let r;
    try {
      r = await fetch(path, Object.assign({ cache: "no-store" }, opts || {}));
    } catch (e) {
      // 本地服务没起来 / 端口被占，fetch 只会给一句 "Failed to fetch"。
      // 直接 toast 出去等于把黑话丢给用户，这里翻译成人话。
      const m = String((e && e.message) || e);
      if (/Failed to fetch|NetworkError|ERR_CONNECTION/i.test(m)) {
        throw new Error("连不上本地后台服务（端口可能被别的程序占了），关掉重开一次试试");
      }
      throw e;
    }
    let j = null;
    try { j = await r.json(); } catch (e) { }
    if (!j) throw new Error("接口没有返回 JSON：" + path);
    if (!j.ok) {
      // 404「没有这个接口」是「界面比后台新」的典型征兆（缓存了旧页面、或者连到了
      // 另一个还在跑的老实例）。后台现在会把 url / method / hint 一起给出来，
      // 用户看到的就是一句能照做的话，而不是一个干巴巴的接口名。
      let msg = j.error || ("请求失败 " + r.status);
      if (j.hint && /没有这个接口/.test(msg)) msg += "\n" + j.hint;
      throw new Error(msg);
    }
    return j;
  }

  // ── 模型库 ────────────────────────────────────────────────
  async function loadList() {
    try {
      const r = await api("/api/packs");
      S.packs = (r.packs || []).filter((p) => p.ok !== false);
      $("packCount").textContent = String(S.packs.length);
      const act = S.packs.find((x) => x.id === r.active);
      $("hdrSub").textContent = act ? "当前 · " + (act.displayName || act.id) : "";
      renderList(r.active);
      const want = new URLSearchParams(location.search).get("id");
      let first = want || r.active || (S.packs[0] && S.packs[0].id);
      // 兜一层：万一 active 或列表项给的是对象，别让它拼成 [object Object] 打出去
      if (first && typeof first === "object") first = first.id || first.pack || "";
      if (first && typeof first !== "string") first = String(first);
      if (first) select(first, { silent: true });
      else showEmpty();
    } catch (e) {
      listEl.innerHTML = "";
      listEl.appendChild(el("div", "empty", "模型库读不出来\n" + e.message));
    }
  }

  function renderList(active) {
    listEl.innerHTML = "";
    if (!S.packs.length) {
      listEl.appendChild(el("div", "empty", "还没有模型\n点下面导入一个"));
      return;
    }
    for (const p of S.packs) {
      const row = el("div", "pack" + (p.id === S.curId ? " on" : ""));
      const thumb = el("div", "thumb", "🐟");
      if (p.icon) thumb.style.backgroundImage = "url('" + p.icon + "')";
      const meta = el("div", "meta");
      const nm = el("div", "nm");
      // 名字单独一层：名字要能省略号截断，标签不能 —— 混在一个盒子里标签会被裁掉。
      nm.appendChild(el("span", "txt", p.displayName || p.id));
      if (p.id === active) nm.appendChild(el("span", "tag", "当前"));
      if (p.origin === "user") nm.appendChild(el("span", "tag user", "自建"));
      // 内置模型被改过（用户在本机存了一份覆盖配置），要说清楚它和内带的那个是同一只。
      if (p.origin === "override") nm.appendChild(el("span", "tag override", "本机配置"));
      if (p.missingModel) nm.appendChild(el("span", "tag bad", "缺模型文件"));
      const idl = el("div", "id", p.id + (p.missingModel ? " · 需要重新导入" : (p.ok === false ? " · 打不开" : "")));
      meta.appendChild(nm);
      meta.appendChild(idl);
      row.appendChild(thumb);
      row.appendChild(meta);
      // 包管理放在行尾，hover 才出现 —— 平时不抢视线，要动的时候一眼能找到。
      const acts = el("div", "acts");
      const cp = el("button", "act", "复制");
      cp.title = "复制一份（改坏了不影响原包）";
      cp.addEventListener("click", (e) => { e.stopPropagation(); duplicatePack(p.id); });
      const rm = el("button", "act", "删除");
      rm.title = p.origin === "builtin" ? "内置模型不能删除" : "删除这个模型包";
      if (p.origin === "builtin") rm.disabled = true;
      rm.addEventListener("click", (e) => { e.stopPropagation(); removePack(p.id, p.displayName || p.id); });
      const ex = el("button", "act", "导出");
      ex.title = "导出清单（只有配置，不含模型文件）";
      ex.addEventListener("click", (e) => { e.stopPropagation(); exportPack(p.id); });
      acts.appendChild(cp);
      acts.appendChild(ex);
      acts.appendChild(rm);
      row.appendChild(acts);
      row.addEventListener("click", () => select(p.id));
      listEl.appendChild(row);
    }
  }

  async function duplicatePack(id) {
    const nid = id + "-copy";
    try {
      toast("正在复制……");
      const r = await api("/api/packs/" + encodeURIComponent(id) + "/duplicate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ newId: nid }),
      });
      await loadList();
      await select(r.id);
      toast("已复制为 " + r.id + "，改坏了不影响原包", "ok");
    } catch (e) {
      toast("复制失败：" + e.message, "bad");
    }
  }

  async function exportPack(id) {
    try {
      const j = await api("/api/packs/" + encodeURIComponent(id) + "/export");
      const m = Object.assign({}, j);
      delete m.ok;
      const blob = new Blob([JSON.stringify(m, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = id + ".pet.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("清单已导出 —— 只有 pet.json，模型文件不在里面", "ok");
    } catch (e) {
      toast("导出失败：" + e.message, "bad");
    }
  }

  async function removePack(id, name) {
    // 删包会真的从用户目录删文件，必须问一次。内置包在按钮上就禁用了，走不到这里。
    if (!window.confirm("删除「" + name + "」？模型文件会从用户目录移除，你导入时的源文件夹不受影响。")) return;
    try {
      const wasCur = S.curId === id;
      await api("/api/packs/" + encodeURIComponent(id) + "/remove", {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      await loadList();
      if (wasCur) {
        const f = S.packs[0];
        if (f) select(f.id); else showEmpty();
      }
      toast("已删除 " + name, "ok");
    } catch (e) {
      toast("删除失败：" + e.message, "bad");
    }
  }

  // 没有选中模型时，取景工具条和底部三个按钮都没有意义：
  // 灰掉而不是留着能点，点了只会得到一句「先选模型」。
  function setChrome(on) {
    const bar = $("vfBar");
    if (bar) bar.style.display = on ? "" : "none";
    for (const id of ["btnSave", "btnApply", "btnReset"]) {
      const b = $(id);
      if (b) b.disabled = !on;
    }
  }

  function showEmpty() {
    stepsEl.innerHTML = "";
    setChrome(false);
    $("formState").textContent = "未选择";
    diagEl.style.display = "none";
    stageBar.innerHTML = "";
    badgeEl.innerHTML = "";
    const pv = $("preview");
    const oldWel = $("wel");
    if (oldWel) oldWel.remove();
    if (!S.packs.length) {
      // 安装包里没有模型：这里是第一屏，直接给导入入口，不要让人自己去猜按钮。
      $("hint").style.display = "none";
      const w = el("div", "wel");
      w.id = "wel";
      w.appendChild(el("div", "wel-ico", "🐟"));
      w.appendChild(el("h2", "", "模型库是空的"));
      w.appendChild(el("p", "", "安装包里不带模型（版权在原画师手上，不能随程序分发）。导入你自己的 Live2D 模型，程序只复制到本机用户目录，不动原文件。"));
      const row = el("div", "row2");
      const b1 = el("button", "btn primary", "导入压缩包（.zip）");
      const b2 = el("button", "btn", "选择文件夹");
      b1.addEventListener("click", () => importZip());
      b2.addEventListener("click", () => importDir());
      row.appendChild(b1);
      row.appendChild(b2);
      w.appendChild(row);
      w.appendChild(el("div", "tip", "支持 Cubism 3 / 4 · .model3.json + moc3 + 贴图 + 动作 + 表情"));
      pv.appendChild(w);
      return;
    }
    stepsEl.appendChild(el("div", "empty", "左边选一个模型\n这里会出现分步绑定"));
    $("hint").style.display = "";
    $("hint").textContent = "选一个模型开始适配";
  }

  // ── 选中一个模型 ──────────────────────────────────────────
  let selectSeq = 0;
  async function select(id, opts) {
    // id 只认字符串。曾经有一次拿到对象，拼出来是 /api/packs/[object Object]，
    // 后台回「没有这个接口」，界面上看起来像前后端版本对不上 —— 其实只是参数形状错了。
    if (id && typeof id === "object") id = id.id || id.pack || id.name || "";
    if (!id) return;
    if (S.dirty && !opts?.silent && !confirm("当前模型有没保存的改动，切走就丢了。继续？")) return;
    const seq = ++selectSeq;
    S.curId = id;
    S.dirty = false;
    const wel = $("wel");
    if (wel) wel.remove();
    $("formState").textContent = "读取中…";
    $("hint").style.display = "";
    $("hint").textContent = "载入模型…";
    renderList();
    try {
      const r = await api("/api/packs/" + encodeURIComponent(id));
      if (seq !== selectSeq) return;
      S.doc = r;
      S.cfgs = JSON.parse(JSON.stringify(r.cfgs || {}));
      markDirty(false);
      // 旧版本把取景存在设置里（settings.viewBox，按 pack id 标记）；现在取景归模型自己。
      // 第一次打开这个包时把属于它的那份搬过来，搬完清掉设置里的旧值 ——
      // 两套值同时存在的话，下次换模型很容易把上一个模型的框套上来。
      try {
        const st = await window.deskfish.settingsGet();
        const vb = st && st.viewBox;
        if (vb && vb.pack === id && typeof vb.h === "number" && r.writable) {
          const L = S.cfgs.layout || (S.cfgs.layout = {});
          L.viewH = Math.min(1.3, Math.max(0.1, vb.h));
          L.viewY = Math.min(0.95, Math.max(-0.2, Number(vb.y) || 0));
          markDirty(true);
          try { await window.deskfish.settingsPatch({ viewBox: {} }); } catch (e2) { }
          toast("这个模型原来的取景已搬进模型配置，确认后点保存", "warn");
        }
      } catch (e) { }
      // 运行时视图（paramMap / 场景路由）单独拿：它是渲染端真正吃的那张表，
      // 预览里的「动作能不能播」必须和主窗口判断一致。
      S.rt = null;
      paramMapCache = null;
      try { const rt = await api("/api/packs/" + encodeURIComponent(id) + "/manifest"); S.rt = rt; } catch (e) { }
      if (seq !== selectSeq) return;
      $("formState").textContent = r.origin === "builtin" ? "本机配置" : "可编辑";
      $("hdrSub").textContent = "当前：" + (r.manifest && r.manifest.id ? r.manifest.id : id);
      setChrome(true);
      renderForm(r);
      focusStep();
      renderDiag(r.diagnose);
      renderBar(r);
      renderBadge(r);
      if (r.missingModel) {
        // 只剩配置的包（升级后残留的覆盖层）：没有任何东西可预览，
        // 也不能保存/应用 —— 先把「为什么不行」写在预览区，别让用户对着黑屏猜。
        $("formState").textContent = "缺模型文件";
        setChrome(false);
        $("btnSave").disabled = true;
        $("btnApply").disabled = true;
        $("btnApply").textContent = "设为当前模型";
        renderBadge({});
        if (S.app) { try { S.app.canvas.style.display = "none"; } catch (e) { } }
        if (S.boxEl) S.boxEl.style.display = "none";
        if (S.model) { try { S.model.destroy({ texture: false, baseTexture: false }); } catch (e) { } S.model = null; }
        $("hint").style.display = "";
        $("hint").textContent = "这个包只剩配置，没有 .moc3 / 贴图 —— 重新导入完整模型后才能应用";
        return;
      }
      $("btnSave").disabled = false;
      $("btnApply").disabled = false;
      $("btnApply").textContent = "设为当前模型";
      await loadPreview(r);
    } catch (e) {
      if (seq !== selectSeq) return;
      stepsEl.innerHTML = "";
      stepsEl.appendChild(el("div", "empty", "打不开这个模型\n" + e.message));
      $("formState").textContent = "出错";
      toast(e.message, "bad");
    }
  }

  // ── 预览 ──────────────────────────────────────────────────
  function buildIdx(m) {
    const out = {};
    try {
      const cm = m.internalModel.coreModel;
      const n = typeof cm.getParameterCount === "function" ? cm.getParameterCount() : 0;
      for (let i = 0; i < n; i += 1) {
        // getParameterId 返回的是 CubismId 对象（{_id:{s:"ParamAngleX"}}），不是字符串。
        // 直接当 key 用会全部变成 "[object Object]"，索引表看着有一条、实际查不到任何参数。
        const o = cm.getParameterId(i);
        const id = o && o._id ? o._id.s : String(o);
        if (id) out[id] = i;
      }
    } catch (e) { }
    return out;
  }

  // 调试出口：动作「播不出来」时要能一眼看出是索引表空了，还是参数名对不上。
  // 主窗口 renderer.js 也有同类的 __fishDebugLayout，查构图问题时不靠猜。
  window.__A = () => ({
    ok: !!(S.model && S.idx),
    params: S.idx ? Object.keys(S.idx).length : -1,
    sample: S.idx ? Object.keys(S.idx).slice(0, 6) : [],
    map: paramMapNow(),
    play: PB ? PB.name : null,
  });

  // 贴图是 4096/8192 的大图，预览里只有几百像素高：线性过滤每帧只采 2×2 个像素，
  // 线条必然发糊。打开 mipmap（每级预先缩好），采样时按实际尺寸挑层级，缩略图才清晰。
  // 另外把 minFilter 保持 linear（不用 nearest）：二次元线稿用 nearest 会出锯齿和摩尔纹。
  function sharpenTextures(model) {
    const list = (model && model.textures) || [];
    const MAX = 2048;
    for (const tex of list) {
      const src = tex && (tex.source || tex.baseTexture);
      if (!src) continue;
      try {
        // 预览窗口只有 550 宽，8192 贴图纯浪费显存，顺手缩到 2048。
        // Cubism 用归一化 UV，换尺寸不影响贴图对应关系。
        const r = src.resource;
        const iw = (r && (r.naturalWidth || r.width)) || 0;
        const ih = (r && (r.naturalHeight || r.height)) || 0;
        if (Math.max(iw, ih) > MAX) {
          const k = MAX / Math.max(iw, ih);
          const tw = Math.max(1, Math.round(iw * k));
          const th = Math.max(1, Math.round(ih * k));
          const cv = document.createElement("canvas");
          cv.width = tw;
          cv.height = th;
          const cx = cv.getContext("2d");
          cx.imageSmoothingEnabled = true;
          cx.imageSmoothingQuality = "high";
          cx.drawImage(r, 0, 0, tw, th);
          if (typeof src.resize === "function") src.resize(tw, th);
          src.resource = cv;
        }
        src.autoGenerateMipmaps = true;
        if (src.style) src.style.scaleMode = "linear";
        if (typeof src.updateMipmaps === "function") src.updateMipmaps();
      } catch (e) { }
    }
  }

  async function loadPreview(doc) {
    if (!vendor) { $("hint").textContent = "Live2D 引擎没加载上"; return; }
    $("hint").style.display = "none";
    if (S.app) { try { S.app.canvas.style.display = ""; } catch (e) { } }
    if (S.boxEl) S.boxEl.style.display = "";
    const url = (doc.manifest && doc.manifest.live2d && doc.manifest.live2d.model)
      ? "/packs/" + doc.id + "/" + doc.manifest.live2d.model
      : "";
    if (!url) { $("hint").style.display = ""; $("hint").textContent = "这个包里找不到 model3.json"; return; }

    if (S.model) {
      try { S.app.stage.removeChild(S.model); S.model.destroy(); } catch (e) { }
      S.model = null;
    }
    if (!S.app) {
      vendor.extensions.add(vendor.Live2DPlugin);
      vendor.configureCubismSDK({ memorySizeMB: 128 });
      S.app = new vendor.Application();
      await S.app.init({
        width: Math.max(1, previewEl.clientWidth),
        height: Math.max(1, previewEl.clientHeight),
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        // 预览窗里模型只有几百像素高，而贴图动辄 8192：
        // 只按 dpr=1 渲染等于 1:1 缩小采样，线条会糊成一片。渲染 2 倍再让浏览器缩回来（SSAA）。
        resolution: Math.min(2.5, Math.max(2, window.devicePixelRatio || 1)),
        preference: "webgl",
        preserveDrawingBuffer: true,
      });
      previewEl.appendChild(S.app.canvas);
      S.app.canvas.style.width = "100%";
      S.app.canvas.style.height = "100%";
    }
    try {
      const m = await vendor.Live2DModel.from(url, {
        autoUpdate: true,
        autoHitTest: false,
        autoFocus: false,
        textureOptions: { lod: "single-auto" },
      });
      // 切换得太快时，旧的加载会晚到；丢掉它，别把新模型挤掉
      if (S.doc && S.doc.id !== doc.id) { try { m.destroy(); } catch (e) { } return; }
      // 换模型先把旧的拆掉：pixi-live2d 的 model.destroy() 会解绑内部模型和贴图引用，
      // 不拆的话每切一次就留一份完整模型在显存里。
      if (S.model) { try { S.model.destroy({ children: true, texture: false, baseTexture: false }); } catch (e) { } }
      S.model = m;
      sharpenTextures(m);
      // 调试出口：想知道「表情/动作到底有没有写进去」时，能在控制台直接看 coreModel 参数。
      // 只在适配器窗口有，不影响主窗口。
      window.__S = S;
      m.anchor.set(0.5);
      S.app.stage.addChild(m);
      // 参数名 → 索引：不能偷懒用 getParameterIndex()，那个返回的索引带偏移
      //（实测 Movement2 应该是 16，它给 510），写进去不报错、值全落到别的变形器上。
      S.idx = buildIdx(m);
      S.model.internalModel.on("beforeModelUpdate", applyPlayback);
      S.model.internalModel.on("beforeModelUpdate", applyExprPreview);
      try { m.motion("idle", 0, 3); } catch (e) { }
      layoutPreview();
      ensureBox();
    } catch (e) {
      $("hint").style.display = "";
      // Pixi / Cubism 抛的是英文技术错误，光甩原文用户没法判断方向。
      // 这类失败九成是文件不全（缺 moc3、贴图对不上、json 坏了），把话说明白。
      const raw = String((e && e.message) || e);
      $("hint").textContent = "模型加载失败\n" + raw +
        "\n\n多半是文件不完整（缺 .moc3、贴图对不上或 json 坏了）。重新导入一次完整模型试试。";
    }
  }

  // 预览区的「有效画布」：普通模式是整块，主窗口视图是中间那条 460:560 的竖口。
  function innerRect() {
    const W = Math.max(1, previewEl.clientWidth);
    const H = Math.max(1, previewEl.clientHeight);
    if (!S.crop) return { x: 0, y: 0, w: W, h: H };
    // 顶部给工具条留一条：不留的话，主窗口视图里她的角/头发正好被那条玻璃条压住
    const TI = 38;
    const A = Math.max(80, H - TI);
    // 竖口要严格保持主窗口的宽高比：宽度不够时缩高度，而不是把画面压扁
    let w = A * WIN_AR;
    let h = A;
    if (w > W) { w = W; h = W / WIN_AR; }
    return { x: (W - w) / 2, y: TI + (A - h) / 2, w, h };
  }

  // 预览里「整只装进去」，框则是主窗口会显示的那一段 —— 这样用户能一眼看出
  // 「我框的是头还是头+身体」，而不是面对一张已经被裁过的图猜。
  function layoutPreview() {
    if (!S.app || !S.model) return;
    const W = Math.max(1, previewEl.clientWidth);
    const H = Math.max(1, previewEl.clientHeight);
    S.app.renderer.resize(W, H);
    const R = innerRect();
    if (vfMaskL) vfMaskL.style.width = Math.round(R.x) + "px";
    if (vfMaskR) vfMaskR.style.width = Math.round(W - R.x - R.w) + "px";
    // 必须用「原始尺寸」算缩放：Pixi 的 width/height 是已经缩放过的显示尺寸，
    // 拿它算第二次会得到 fit≈1，用户一改窗口模型就炸成原大（只剩一角）。
    const im = S.model.internalModel;
    const mh = Math.max(1, (im && im.originalHeight) || S.model.height);
    const mw = Math.max(1, (im && im.originalWidth) || S.model.width);
    const lay = cfgOf("layout") || {};
    const vy = num(lay.viewY, 0.1);
    const vh = Math.max(0.06, num(lay.viewH, 0.5));
    if (S.crop) {
      // 主窗口视图：让「取景框那一段」正好铺满竖口 —— 这时看到的就是桌宠窗口的画面。
      const scale = (R.h * 0.995) / Math.max(1, mh * vh);
      S.model.scale.set(scale);
      S.model.position.set(R.x + R.w / 2, R.y + R.h / 2 - (vy + vh / 2 - 0.5) * mh * scale);
    } else {
      const fit = Math.min((H * 0.94) / mh, (W * 0.94) / mw);
      S.model.scale.set(fit);
      S.model.position.set(W / 2, H / 2);
    }
    drawBox();
  }

  function ensureBox() {
    if (S.boxEl) return;
    S.boxEl = el("div", "vf-box");
    const style = document.createElement("style");
    style.textContent = `
      /* 四条边：只有上下两条时看起来像「两根横线」，不像一个取景框 */
      .vf-box{position:absolute; left:0; right:0; pointer-events:none; border-radius:4px;
        border:1px solid rgba(91,140,255,.55);
        border-top-color:rgba(91,140,255,.92); border-bottom-color:rgba(91,140,255,.92);
        background:linear-gradient(180deg, rgba(91,140,255,.10), rgba(91,140,255,.03));
        box-shadow:0 0 0 1px rgba(91,140,255,.12) inset, 0 0 22px rgba(91,140,255,.06);}
      /* 标签放到框外面：放里面正好压在脸上，用户第一眼看到的是「一行字盖住眼睛」。 */
      .vf-box::before{content:"主窗口显示范围"; position:absolute; left:2px; top:-17px;
        font-size:10.5px; color:#b7c8ec; letter-spacing:.4px; white-space:nowrap;
        background:rgba(18,20,28,.86); padding:1px 6px; border-radius:5px;
        border:1px solid rgba(91,140,255,.22);}
      .vf-box .grip{position:absolute; left:0; right:0; height:10px; cursor:ns-resize; pointer-events:auto;}
      .vf-box .grip.t{top:-5px;} .vf-box .grip.b{bottom:-5px;}
      .vf-box{cursor:ns-resize; pointer-events:auto;}
    `;
    document.head.appendChild(style);
    previewEl.appendChild(S.boxEl);
    // 上下两条边可拖：拖的是「主窗口看到的范围」。不做整框拖动 —— 整框盖住模型，反而点不到人。
    for (const k of ["t", "b"]) {
      const g = el("div", "grip " + k);
      g.addEventListener("pointerdown", (e) => startBoxDrag(e, k));
      S.boxEl.appendChild(g);
    }
    // 框内上下拖动 = 整体平移取景（原取景窗的「拖方框」，这里直接用手抓）
    S.boxEl.addEventListener("pointerdown", (e) => startBoxDrag(e, "move"));
    // 首次绑定时 layoutPreview 已经跑过（那时还没有 box），这里补画一次
    drawBox();
  }

  function setBoxValue(key, v) {
    const lay = cfgOf("layout") || {};
    lay[key] = v;
    const s = S.sliders && S.sliders[key];
    if (s) { s.inp.value = String(v); s.valEl.textContent = v + s.unit; }
  }

  // 屏幕像素 → 模型高度比例：除的必须是「显示高度」（已缩放过的 S.model.height）。
  // d 是游标位移除以模型显示高度，就是 viewY/viewH 的增量。
  function startBoxDrag(e, kind) {
    if (!S.model) return;
    e.preventDefault();
    e.stopPropagation();
    const px = Math.max(1, S.model.height);
    const lay = cfgOf("layout") || {};
    const vy0 = num(lay.viewY, 0.1);
    const vh0 = Math.max(0.06, num(lay.viewH, 0.5));
    const y0 = e.clientY;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const onMove = (ev) => {
      const d = (ev.clientY - y0) / px;
      let vy = vy0;
      let vh = vh0;
      if (kind === "move") { vy = vy0 + d; }
      else if (kind === "t") { vy = vy0 + d; vh = vh0 - d; }
      else { vh = vh0 + d; }
      // 和规则里的滑杆范围保持一致；越界就停住，不要「拖得动但存的是别的值」
      vy = Math.min(0.95, Math.max(-0.2, vy));
      vh = Math.min(1.3, Math.max(0.06, vh));
      setBoxValue("viewY", r3(vy));
      setBoxValue("viewH", r3(vh));
      if (S.crop) layoutPreview(); else drawBox();
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      touch();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  // 框的位置：viewY/viewH 是「相对模型高度的比例」（0=模型顶部）。
  // 预览里模型是整只居中的，所以框 = 居中的模型矩形再按比例切。
  function drawBox() {
    if (!S.boxEl || !S.model) return;
    const W = Math.max(1, previewEl.clientWidth);
    const H = Math.max(1, previewEl.clientHeight);
    const itx = cfgOf("layout") || {};
    const vy = num(itx.viewY, 0.1);
    const vh = Math.max(0.04, num(itx.viewH, 0.5));
    if (vfReadEl) {
      vfReadEl.textContent = "看 " + Math.round(vh * 100) + "% 高度 · 顶 " + (vy * 100).toFixed(1) + "%";
    }
    if (S.crop) {
      // 主窗口视图里，取景框就是那条竖口本身；留 1px 内缩当作边框
      const R = innerRect();
      S.boxEl.style.top = Math.round(R.y) + "px";
      S.boxEl.style.height = Math.round(R.h) + "px";
      S.boxEl.style.width = Math.round(R.w) + "px";
      S.boxEl.style.left = Math.round(R.x) + "px";
      S.boxEl.style.right = "auto";
      return;
    }
    // S.model.height 已经是缩放后的显示高度，不能再乘 scale（会把框算成 1/12 大小）
    const dispH = Math.max(1, S.model.height);
    const modelTop = S.model.position.y - dispH / 2;
    // vy 是「框顶距离模型顶部」的比例，不是中心。早先写成 (vy+0.5) 把框整体推下去了半个模型，
    // 表现为「标签写着主窗口能看到，实际框在腰上」。
    let top = modelTop + dispH * vy;
    let h = dispH * vh;
    // 兜住：框跑出预览区就贴边，别让用户拖到看不见的地方还以为坏了
    if (top < 0) { h += top; top = 0; }
    if (top + h > H) h = H - top;
    if (h < 6) h = 6;
    // 框的宽度不是「整只模型宽」：主窗口是 460×560 的竖框，模型横向会被裁掉一截。
    // 按窗口宽高比反算「窗口实际看到的那一段有多宽」，框才不会骗人。
    const boxW = Math.max(24, Math.min(W, (dispH * vh) * WIN_AR));
    S.boxEl.style.top = Math.round(top) + "px";
    S.boxEl.style.height = Math.round(h) + "px";
    S.boxEl.style.width = Math.round(boxW) + "px";
    S.boxEl.style.left = Math.round((W - boxW) / 2) + "px";
    S.boxEl.style.right = "auto";
  }

  // ── 动作测试条 ────────────────────────────────────────────
  function renderBadge(doc) {
    // 每次都要先清空：换包时上一只模型的贴图/参数数不清掉，会让人以为这包真有那些文件。
    badgeEl.innerHTML = "";
    const rep = (doc && doc.report) || {};
    const bits = [
      ["贴图", (rep.textures || []).length],
      ["参数", (rep.params || []).length],
      ["动作组", Object.keys(rep.motions || {}).length],
      ["表情", (rep.expressions || []).length],
    ];
    for (const [k, v] of bits) {
      if (!v) continue;
      const b = el("span", "b", k + " ");
      const n = el("b", "", String(v));
      b.appendChild(n);
      badgeEl.appendChild(b);
    }
  }

  // 点一下 chip 只有 toast，眼睛还停留在原来的 chip 上，不知道刚才点的是哪个。
  // 给按下的那颗亮 0.9 秒，手和眼有同一个落点。
  function flash(btn, ms) {
    if (!btn) return;
    btn.classList.add("on");
    clearTimeout(btn.__ft);
    btn.__ft = setTimeout(() => btn.classList.remove("on"), ms || 900);
  }

  function renderBar(doc) {
    stageBar.innerHTML = "";
    stageBar.appendChild(el("span", "lbl", "试一下："));
    const acts = (doc.schema && doc.schema.rules || []).find((r) => r.id === "actions");
    const slots = (acts && acts.fields) || [];
    // 只放「能一眼看出效果」的几个：待机、想事情、完成、被摸头、伸懒腰、失败
    const want = ["idle", "thinking", "done", "failed", "petHead", "sleep"];
    const picks = slots.filter((f) => want.indexOf(f.key) >= 0);
    for (const f of picks) {
      const b = el("button", "chip", f.label.replace(/（.*?）/g, ""));
      b.addEventListener("click", () => { flash(b); testAction(f); });
      stageBar.appendChild(b);
    }
    stageBar.appendChild(el("div", "sep"));
    stageBar.appendChild(el("span", "lbl", "表情："));
    const expr = (doc.schema && doc.schema.rules || []).find((r) => r.id === "expressions");
    for (const f of (expr && expr.fields || []).filter((x) => x.type === "expression").slice(0, 4)) {
      const b = el("button", "chip", f.label.replace(/（.*?）/g, ""));
      b.addEventListener("click", () => { flash(b); testExpr(f); });
      stageBar.appendChild(b);
    }
    // 模型自带的动作组：直接播一个看看（很多模型只有 1~2 个）
    const groups = Object.keys((S.doc && S.doc.report && S.doc.report.motions) || {});
    if (groups.length) {
      stageBar.appendChild(el("div", "sep"));
      stageBar.appendChild(el("span", "lbl", "模型动作："));
      for (const g of groups) {
        const b = el("button", "chip", g);
        b.addEventListener("click", () => {
          flash(b);
          try { S.model.motion(g, 0, 3); toast("播放模型动作 " + g); }
          catch (e) { toast("这个动作播不了", "bad"); }
        });
        stageBar.appendChild(b);
      }
    }
  }

  function testAction(f) {
    const v = (S.cfgs["actions"] || {})[f.key] || "";
    if (v.startsWith("model:")) {
      try { S.model.motion(v.slice(6), 0, 3); toast("模型动作 " + v.slice(6)); } catch (e) { toast("播不了", "bad"); }
      return;
    }
    if (v === "none") { toast("这个槽设成了不动"); return; }
    const scene = v.startsWith("builtin:") ? v.slice(8) : (f.defaultScene || f.key);
    playBuiltinScene(scene);
  }

  // 内置动作库：和主程序用的是同一份 motions.js（这个页面自己就引了）。
  // 不会出现在这里的只有「模型专有参数」——比如 dafeiyu 的 Movement2，
  // 别的模型没有，曲线里那几条就跳过；用户可以靠「专有参数别名」把它们接过来。
  // 内置动作曲线里写的是 Cubism 的标准参数名。这里把「标准名 → 语义槽」抄一份，
  // 是为了用户在表单里改绑定/别名时，预览能**立刻**按新映射播，而不用先保存。
  // 这是整个前端唯一硬编码的东西，但它抄的是 Cubism 规范名，不会随版本变。
  const CANON = {
    ParamAngleX: "angleX", ParamAngleY: "angleY", ParamAngleZ: "angleZ",
    ParamBodyAngleX: "bodyAngleX", ParamBodyAngleZ: "bodyAngleZ",
    ParamEyeBallX: "eyeBallX", ParamEyeBallY: "eyeBallY",
    ParamEyeLOpen: "eyeLOpen", ParamEyeROpen: "eyeROpen",
    ParamMouthOpenY: "mouthOpen", ParamMouthForm: "mouthForm",
    ParamBreath: "breath",
    ParamEyeOpenL: "eyeLOpen", ParamEyeOpenR: "eyeROpen",
    ParamMouthOpen: "mouthOpen", ParamMouthFormY: "mouthForm",
    // ---- 表演曲线用的表情参数 ----
    // LumenAct 那 97 段曲线是按参数名写进动作库的，预览时要能一路映射到槽位，
    // 否则「试演」在适配器里播不动、只能存盘后回主程序看。这里补的就是这条通路。
    EyeSmile: "eyeSmile", ParamEyeSmile: "eyeSmile",
    ParamBrowLY: "browLY", ParamBrowRY: "browRY",
    ParamBrowLForm: "browLY", ParamBrowRForm: "browRY",
    ParamBrowLAngle: "browLAngle", ParamBrowRAngle: "browRAngle",
    BrowInnerUp: "browInnerUp",
    ShockL: "shockL", ShockR: "shockR",
    LCry: "cryL", RCry: "cryR",
    Angry: "angry", PupilX: "pupilX",
    Mouthpucker: "mouthPucker", CheeckPuff: "cheekPuff", ParamCheek: "cheekPuff",
  };

  let paramMapCache = null;
  function paramMapNow() {
    if (paramMapCache) return paramMapCache;
    const out = {};
    const cp = S.cfgs["core-params"] || {};
    for (const canon in CANON) {
      const slot = CANON[canon];
      if (cp[slot]) out[canon] = cp[slot];
    }
    // 专有参数别名：曲线里的 Movement2 = 本模型的 ParamArmLB
    const al = (cp.aliases && typeof cp.aliases === "object") ? cp.aliases : {};
    for (const k in al) if (al[k]) out[k] = al[k];
    // 服务端自己算过一份，兜底补上（比如规则里配的、别的前端没算到的）
    const rt = (S.rt && S.rt.paramMap) || {};
    for (const k in rt) if (!out[k]) out[k] = rt[k];
    paramMapCache = out;
    return out;
  }

  async function playBuiltinScene(scene) {
    const tbl = window.FishMotionScenes || {};
    const names = tbl[scene] || [];
    if (!names.length) { toast("场景 " + scene + " 没有动作"); return; }
    const name = names[Math.floor(Math.random() * names.length)];
    playBuiltinMotion(name);
  }

  let PB = null;   // 正在播的内置动作
  function playBuiltinMotion(name) {
    const lib = window.FishMotions || {};
    const curves = lib[name];
    if (!Array.isArray(curves) || !curves.length) { toast("找不到动作 " + name, "bad"); return; }
    if (!S.model || !S.idx) { toast("模型还没加载好", "bad"); return; }
    const pm = paramMapNow();
    const mapped = [];
    let dur = 0;
    for (const [pid, pts] of curves) {
      dur = Math.max(dur, pts[pts.length - 1][0]);
      const real = pm[pid] || pid;
      const i = S.idx[real];
      if (i === undefined) continue;
      mapped.push([i, pts]);
    }
    if (!mapped.length) {
      toast("这个模型没有「" + name + "」需要的参数（去第 1 步绑定或加别名）", "bad");
      return;
    }
    PB = { name, curves: mapped, t0: performance.now(), dur };
    toast("内置动作 " + name + " · " + mapped.length + "/" + curves.length + " 条曲线");
    // 播完自动收，别一直停在最后一帧
    setTimeout(() => { if (PB && PB.name === name) PB = null; }, dur * 1000 + 80);
  }

  // 表情试演：直接播 LumenAct 那套曲线。
  // 它和内置动作共用同一个播放器（PB），因为格式完全一样 —— 都是 [[参数索引, [[t,v]...]]]。
  // 唯一区别：曲线里的键是**槽位 id**（angleX、eyeSmile），不是参数名，
  // 所以要先按 S.cfgs["core-params"] 翻译成本模型真实的参数名。
  // 翻译不上就跳过那一条 —— 换模型之后同一个按钮照样能播，只是少几条曲线。
  function playExprStyleById(id) {
    const d = window.FishExprCurves;
    if (!d || !d.styles) { toast("表演库没加载（expr-curves.js）", "bad"); return; }
    const st = d.styles[String(id)];
    if (!st) { toast("没有 " + id + " 这一段", "bad"); return; }
    if (!S.model || !S.idx) { toast("模型还没加载好", "bad"); return; }
    if (!Array.isArray(st.curves) || !st.curves.length) { toast("这一段没有曲线", "bad"); return; }
    const cp = S.cfgs["core-params"] || {};
    const slotInfo = d.slots || {};
    const mapped = [];
    let skipped = 0;
    let dur = 0;
    for (const pair of st.curves) {
      const slotId = pair[0];
      const pts = pair[1];
      if (!Array.isArray(pts) || !pts.length) continue;
      dur = Math.max(dur, pts[pts.length - 1][0]);
      // 用户手绑优先；没绑就用槽位表里的 canon 猜；都没有才算缺
      const real = cp[slotId] || (slotInfo[slotId] && slotInfo[slotId].canon);
      if (!real) { skipped += 1; continue; }
      const i = S.idx[real];
      if (i === undefined) { skipped += 1; continue; }
      mapped.push([i, pts]);
    }
    if (!mapped.length) {
      toast("这个模型一个表情参数都没匹配上 —— 先去第 1 步绑定表情参数", "bad");
      return;
    }
    // neutral 段 52 秒，整段播完像卡住；截到 9 秒，短片反而更容易看清这一段的性格
    const cap = Math.min(dur, 9);
    PB = { name: "expr:" + id, curves: mapped, t0: performance.now(), dur: cap };
    toast("试演 " + (st.label || id) + (st.subcategory ? " · " + st.subcategory : "") +
      " · " + mapped.length + "/" + st.curves.length + " 条" + (skipped ? "（跳过 " + skipped + "）" : ""));
    setTimeout(() => { if (PB && PB.name === "expr:" + id) PB = null; }, cap * 1000 + 120);
  }

  // 表情试播：自己读 exp3 再写参数。
  // 不能只靠 model.expression(name)：引擎只认 model3.json 里声明过的表情，
  // 而素材库里的表情有一半是从目录里扫出来、没写进清单的（declared:false），
  // 那些调用一律返回 false，看起来就是「点了没反应」。
  let EX = null;
  async function playExprFile(file, label) {
    if (!S.model || !S.idx) { toast("模型还没加载好", "bad"); return; }
    try {
      const r = await fetch("/packs/" + S.doc.id + "/" + file, { cache: "no-store" });
      if (!r.ok) throw new Error("读不到文件（" + r.status + "）");
      const j = await r.json();
      const list = Array.isArray(j.Parameters) ? j.Parameters : [];
      const mapped = [];
      for (const p of list) {
        const id = p.Id || p.id;
        const i = S.idx[id];
        if (i === undefined) continue;
        mapped.push({ i, v: Number(p.Value != null ? p.Value : p.value) || 0,
          blend: Number(p.Blend != null ? p.Blend : p.blend) || 0 });
      }
      if (!mapped.length) {
        toast("这个表情驱动的参数模型里没有（" + list.length + " 条全部落空）", "bad");
        return;
      }
      // 先按名字试一次引擎路径（声明过的表情会走引擎的淡入），失败再用自绘
      if (S.model) { try { await S.model.expression(label); } catch (e) { } }
      EX = { label, params: mapped, t0: performance.now(), dur: 2.9 };
      window.__EX = EX;
      toast("表情 " + (label || file) + " · " + mapped.length + "/" + list.length + " 个参数");
    } catch (e) { toast(e.message, "bad"); }
  }

  // 表情每帧写参数：淡入 0.25s → 保持 2.2s → 淡出 0.35s，回到参数默认值。
  // 基线用 getParameterDefaultValueByIndex，不是 0——很多模型的嘴/眼默认值不是 0。
  function applyExprPreview() {
    if (!EX || !S.model) return;
    window.__EXN = (window.__EXN || 0) + 1;
    const t = (performance.now() - EX.t0) / 1000;
    const fi = 0.25, hold = 2.2, fo = 0.35;
    let w;
    if (t < fi) w = t / fi;
    else if (t < fi + hold) w = 1;
    else if (t < fi + hold + fo) w = 1 - (t - fi - hold) / fo;
    else { EX = null; return; }
    const cm = S.model.internalModel.coreModel;
    // Cubism Core 没有 getParameterDefaultValueByIndex（调了会直接抛），
    // 默认值挂在 coreModel._model.parameters.defaultValues 上。
    const params = cm._model && cm._model.parameters;
    const dv = params && params.defaultValues;
    const def = (i) => (dv && typeof dv[i] === "number" ? dv[i] : cm.getParameterValueByIndex(i));
    for (const p of EX.params) {
      const base = def(p.i);
      let target = p.v;
      if (p.blend === 1) target = base + p.v;
      else if (p.blend === 2) target = base * p.v;
      const cur = cm.getParameterValueByIndex(p.i);
      cm.setParameterValueByIndex(p.i, cur + (target - cur) * w, 1);
      window.__EXDBG = [p.i, base, target, cur, w, cm.getParameterValueByIndex(p.i)];
    }
  }

  // 每帧写参数：和主窗口同一个时机（beforeModelUpdate），
  // 这样既不会被 automator 覆盖，也赶得上 coreModel.update()。
  function applyPlayback() {
    if (!PB || !S.model) return;
    const t = (performance.now() - PB.t0) / 1000;
    if (t > PB.dur) { PB = null; return; }
    const cm = S.model.internalModel.coreModel;
    // 首尾各 0.12 秒淡入淡出，测试时不容易看出「啪一下跳过去」
    let w = 1;
    const fi = Math.min(0.12, PB.dur * 0.2);
    if (t < fi) w = t / fi;
    else if (t > PB.dur - fi) w = Math.max(0, (PB.dur - t) / fi);
    for (const [i, pts] of PB.curves) {
      const v = lerpPts(pts, t);
      if (w >= 1) cm.setParameterValueByIndex(i, v, 1);
      else {
        const base = cm.getParameterValueByIndex(i);
        cm.setParameterValueByIndex(i, base + (v - base) * w, 1);
      }
    }
  }

  function lerpPts(pts, t) {
    if (!pts || !pts.length) return 0;
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i += 1) {
      if (t <= pts[i][0]) {
        const [t0, v0] = pts[i - 1];
        const [t1, v1] = pts[i];
        const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
        return v0 + (v1 - v0) * u;
      }
    }
    return pts[pts.length - 1][1];
  }

  function testExpr(f) {
    const v = (S.cfgs["expressions"] || {})[f.key] || "";
    if (!v) { toast("这个表情还没绑"); return; }
    // exp3 叠参数在服务端能算，但预览只要「看起来变了」，
    // 直接让引擎播同名表情就够了（引擎里 exp3 是按名字注册的）
    try { S.model.expression(v); toast("表情 " + v); }
    catch (e) { toast("这个表情模型里没有", "bad"); }
  }


  // ── 素材库 ────────────────────────────────────────────────
  // 模型里到底有哪些动作、哪些表情，适配器扫到之后就应该是「可点、可听、可绑」的，
  // 而不是只在体检报告里报一个数字。这里的两条主线：
  //   ① 试播：直接读 motion3 / exp3 播一次，确认它是想要的那一支；
  //   ② 绑定：把这一支写成动作槽的值（file:路径），或者把表情写进表情槽。
  const SLOT_LABELS = {};
  function slotFields() {
    const acts = ((S.doc && S.doc.schema && S.doc.schema.rules) || []).find((r) => r.id === "actions");
    return (acts && acts.fields) || [];
  }
  function exprFields() {
    const ex = ((S.doc && S.doc.schema && S.doc.schema.rules) || []).find((r) => r.id === "expressions");
    return ((ex && ex.fields) || []).filter((f) => f.type === "expression");
  }

  async function playFileMotion(file, label) {
    if (!S.model || !S.idx) { toast("模型还没加载好", "bad"); return; }
    if (!window.FishMotion3) { toast("动作解析器没加载上", "bad"); return; }
    try {
      const r = await fetch("/packs/" + S.doc.id + "/" + file, { cache: "no-store" });
      if (!r.ok) throw new Error("读不到文件（" + r.status + "）");
      const parsed = window.FishMotion3.parse(await r.json());
      const pm = paramMapNow();
      const mapped = [];
      for (const [pid, pts] of parsed.curves) {
        const real = pm[pid] || pid;
        const i = S.idx[real];
        if (i === undefined) continue;
        mapped.push([i, pts]);
      }
      if (!mapped.length) {
        toast("这支动作驱动的参数这个模型没有（" + parsed.curves.length + " 条全部落空）", "bad");
        return;
      }
      PB = { name: label || file, curves: mapped, t0: performance.now(), dur: parsed.duration };
      toast("播放 " + (label || file) + " · " + mapped.length + "/" + parsed.curves.length + " 条曲线");
      setTimeout(() => { if (PB && PB.name === (label || file)) PB = null; }, parsed.duration * 1000 + 150);
    } catch (e) { toast(e.message, "bad"); }
  }

  function bindExpr(name) {
    const cfg = cfgOf("expressions");
    const fields = exprFields();
    const sel = document.querySelector('#steps select[data-rule="expressions"][data-key="default"]');
    const target = fields.find((f) => f.key === "default") || fields[0];
    if (!target) { toast("这个版本没有表情槽", "bad"); return; }
    cfg[target.key] = name;
    if (sel) sel.value = name;
    touch();
    toast("已把表情 " + name + " 写进「" + target.label + "」");
  }

  function renderLibrary(doc) {
    const rt = S.rt || {};
    const motions = Array.isArray(rt.motions) ? rt.motions : [];
    const exprs = Array.isArray(rt.expressionList) ? rt.expressionList : [];
    const box = el("div", "libstep" + (S.libOpen === true ? " open" : ""));
    const hd = el("div", "libhd");
    hd.appendChild(el("div", "tt", "素材库"));
    hd.appendChild(el("div", "hint", motions.length + " 支动作 · " + exprs.length + " 个表情"));
    hd.appendChild(el("div", "caret", "▶"));
    hd.addEventListener("click", () => {
      box.classList.toggle("open");
      S.libOpen = box.classList.contains("open");
    });
    box.appendChild(hd);
    const bd = el("div", "libbd");

    // 动作：一行一支，试播 / 绑定
    bd.appendChild(el("div", "libsub", "动作文件"));
    if (!motions.length) {
      bd.appendChild(el("div", "note", "这个模型没有动作文件。内置动作库仍然可用，不用管这里。"));
    } else {
      const bar = el("div", "bindbar");
      const msel = document.createElement("select");
      for (const m of motions) {
        const nm = m.file.split("/").pop().replace(/\.motion3\.json$/i, "");
        const o = document.createElement("option");
        o.value = m.file;
        o.textContent = m.group + " · " + nm + (m.declared === false ? "（未声明）" : "");
        msel.appendChild(o);
      }
      const ssel = document.createElement("select");
      for (const f of slotFields()) {
        const o = document.createElement("option");
        o.value = f.key;
        o.textContent = f.label;
        ssel.appendChild(o);
      }
      const bind = el("button", "lbtn", "绑到槽");
      bind.addEventListener("click", () => {
        const file = msel.value;
        const slot = ssel.value;
        if (!file || !slot) return;
        const cfg = cfgOf("actions");
        cfg[slot] = "file:" + file;
        const sel = document.querySelector('#steps select[data-rule="actions"][data-key="' + slot + '"]');
        if (sel) sel.value = cfg[slot];
        touch();
        toast("已绑定：" + slot + " → " + file.split("/").pop());
      });
      bar.appendChild(msel);
      bar.appendChild(ssel);
      bar.appendChild(bind);
      bd.appendChild(bar);

      for (const m of motions) {
        const row = el("div", "lrow");
        const nm = m.file.split("/").pop().replace(/\.motion3\.json$/i, "");
        row.appendChild(el("span", "nm", m.group + " #" + m.index + " · " + nm));
        const sec = m.duration ? m.duration.toFixed(1) + "s" : "";
        if (sec) row.appendChild(el("span", "tag", sec));
        row.appendChild(el("span", "tag" + (m.declared === false ? " und" : ""), m.declared === false ? "未声明" : "已声明"));
        const pb = el("button", "lbtn", "▶");
        pb.title = "在这只模型上试播";
        pb.addEventListener("click", () => { flash(pb); playFileMotion(m.file, nm); });
        row.appendChild(pb);
        bd.appendChild(row);
      }
    }

    // 表情：一行一个，试播 / 写进默认表情槽
    bd.appendChild(el("div", "libsub", "表情文件"));
    if (!exprs.length) {
      bd.appendChild(el("div", "note", "没有 exp3 表情文件；情绪会走参数偏移那一套。"));
    } else {
      for (const e of exprs) {
        const row = el("div", "lrow");
        row.appendChild(el("span", "nm", e.name));
        row.appendChild(el("span", "tag" + (e.declared === false ? " und" : ""), e.declared === false ? "未声明" : "已声明"));
        const pb = el("button", "lbtn", "▶");
        pb.addEventListener("click", () => {
          flash(pb);
          playExprFile(e.file, e.name);
        });
        row.appendChild(pb);
        const bd2 = el("button", "lbtn", "设为默认");
        bd2.title = "写进表情规则的「默认表情」槽";
        bd2.addEventListener("click", () => { flash(bd2); bindExpr(e.name); });
        row.appendChild(bd2);
        bd.appendChild(row);
      }
    }

    box.appendChild(bd);
    return box;
  }

  // ── 表单 ──────────────────────────────────────────────────
  function cfgOf(ruleId) { return S.cfgs[ruleId] || (S.cfgs[ruleId] = {}); }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

  // 从设置页「调整取景」进来时带 ?step=layout：直接摊开取景那一步，
  // 不用用户自己在一列手风琴里找。只认第一次载入，之后手点还是正常手风琴。
  let focusDone = false;
  function focusStep() {
    if (focusDone) return;
    const want = new URLSearchParams(location.search).get("step");
    if (!want) { focusDone = true; return; }
    const step = stepsEl.querySelector('.step[data-rule="' + want + '"]');
    if (!step) return;
    focusDone = true;
    for (const s2 of stepsEl.querySelectorAll(".step.open")) s2.classList.remove("open");
    step.classList.add("open");
    requestAnimationFrame(() => step.scrollIntoView({ block: "nearest" }));
    if (want === "layout") toast("拖动取景框或用滚轮缩放，满意后点右下角「保存并应用」", "ok");
  }

  function renderForm(doc) {
    stepsEl.innerHTML = "";
    libdock.innerHTML = "";
    S.sliders = {};
    const rules = (doc.schema && doc.schema.rules) || [];
    rules.forEach((rule, i) => {
      // tuning 有 16 个数值，单列要滚三屏；两列 + 分组标题才看得过来。
      const wide = rule.id === "tuning" ? " wide" : "";
      const step = el("div", "step" + wide + (i === 0 ? " open" : ""));
      step.dataset.rule = rule.id;
      const hd = el("div", "hd");
      hd.appendChild(el("div", "idx", String(i + 1)));
      hd.appendChild(el("div", "tt", rule.title));
      const hint = el("div", "hint", "");
      hd.appendChild(hint);
      hd.appendChild(el("div", "caret", "▶"));
      const bd = el("div", "bd");
      if (rule.description) {
        const d = el("div", "note");
        d.textContent = rule.description;
        d.style.marginTop = "8px";
        bd.appendChild(d);
      }
      const cfg = cfgOf(rule.id);
      let lastGroup = "";
      for (const f of rule.fields || []) {
        if (f.group && f.group !== lastGroup) {
          lastGroup = f.group;
          bd.appendChild(el("div", "fgrp", f.group));
        }
        bd.appendChild(field(f, cfg, rule, hint));
      }
      hd.addEventListener("click", () => {
        // 手风琴：一次只开一步。六个步骤全摊开要滚三屏，用户会不知道自己在哪。
        const was = step.classList.contains("open");
        for (const s2 of stepsEl.querySelectorAll(".step.open")) s2.classList.remove("open");
        if (!was) {
          step.classList.add("open");
          // 展开后把这一步的标题送到视野顶端，省得用户自己找刚才点的是哪一条。
          requestAnimationFrame(() => step.scrollIntoView({ block: "nearest" }));
        }
      });
      step.appendChild(hd);
      step.appendChild(bd);
      stepsEl.appendChild(step);
    });
    refreshStepMarks(doc);
    libdock.appendChild(renderLibrary(doc));
  }

  function refreshStepMarks(doc) {
    const issues = (doc.diagnose && doc.diagnose.issues) || [];
    for (const step of stepsEl.querySelectorAll(".step")) {
      const rid = step.dataset.rule;
      const mine = issues.filter((x) => x.ruleId === rid);
      step.classList.toggle("bad", mine.some((x) => x.level === "error" || x.level === "warn"));
      step.classList.toggle("ok", !mine.length && rid !== "interaction");
      const hint = step.querySelector(".hd .hint");
      if (hint) hint.textContent = mine.length ? mine.length + " 项待确认" : "";
    }
  }

  function field(f, cfg, rule, stepHint) {
    const wrap = el("div", "fld");
    if (f.type === "map") {
      // map 不放进 fld 的 label 流程，自己渲染
      const lb = el("label");
      lb.textContent = f.label;
      wrap.appendChild(lb);
      const ta = el("textarea");
      ta.value = mapToText(cfg[f.key]);
      ta.placeholder = f.from === "motionRefs" ? "Movement2 = ParamArmLB\nParam56 = ParamArmRB" : "键 = 值";
      ta.addEventListener("input", () => {
        cfg[f.key] = textToMap(ta.value);
        touch();
      });
      wrap.appendChild(ta);
      if (f.hint) { const n = el("div", "note", f.hint); wrap.appendChild(n); }
      return wrap;
    }

    const lb = el("label");
    lb.textContent = f.label;
    if (f.required) lb.appendChild(el("span", "req", "必填"));
    wrap.appendChild(lb);

    if (f.type === "toggle") {
      const sw = el("label", "sw");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!cfg[f.key];
      cb.addEventListener("change", () => { cfg[f.key] = cb.checked; touch(); });
      sw.appendChild(cb);
      sw.appendChild(el("i"));
      const row = el("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "9px";
      row.appendChild(sw);
      const st = el("span", "", f.hint || "");
      st.style.fontSize = "11px";
      st.style.color = "#6d7288";
      row.appendChild(st);
      wrap.appendChild(row);
      return wrap;
    }

    if (f.type === "slider" || f.type === "number") {
      const valEl = el("span", "v", "");
      lb.appendChild(valEl);
      if (f.type === "slider") {
        const rng = f.range || [num(f.min, 0), num(f.max, 1)];
        const inp = document.createElement("input");
        inp.type = "range";
        inp.min = String(rng[0]); inp.max = String(rng[1]);
        inp.step = String(f.step || ((rng[1] - rng[0]) / 100));
        inp.value = String(num(cfg[f.key], num(f.defaultValue != null ? f.defaultValue : f.default, rng[0])));
        const upd = () => {
          valEl.textContent = inp.value + (f.unit || "");
          cfg[f.key] = Number(inp.value);
          drawBox();
        };
        upd();
        S.sliders[f.key] = { inp, valEl, unit: f.unit || "" };
        inp.addEventListener("input", () => { upd(); touch(); });
        wrap.appendChild(inp);
      } else {
        const inp = document.createElement("input");
        inp.type = "number";
        if (f.step) inp.step = String(f.step);
        inp.value = String(num(cfg[f.key], num(f.defaultValue != null ? f.defaultValue : f.default, 0)));
        valEl.textContent = "";
        inp.addEventListener("input", () => { cfg[f.key] = Number(inp.value); touch(); });
        wrap.appendChild(inp);
      }
      if (f.hint) wrap.appendChild(el("div", "note", f.hint));
      return wrap;
    }

    if (f.type === "text" || f.type === "textarea") {
      const inp = document.createElement(f.type === "textarea" ? "textarea" : "input");
      if (f.type === "text") inp.type = "text";
      inp.value = cfg[f.key] == null ? "" : String(cfg[f.key]);
      inp.addEventListener("input", () => { cfg[f.key] = inp.value; touch(); });
      wrap.appendChild(inp);
      if (f.hint) wrap.appendChild(el("div", "note", f.hint));
      return wrap;
    }

    // select / param / motion / expression 都渲染成下拉
    const sel = document.createElement("select");
    // 记下身份：素材库里「绑到某槽」之后要能把这里的选择项同步过去，
    // 否则用户看到的是绑定成功、下拉还停在旧值。
    sel.dataset.rule = rule.id;
    sel.dataset.key = f.key;
    const opts = optionsFor(f);
    const cur = cfg[f.key] == null ? "" : String(cfg[f.key]);
    if (!f.required) {
      const o = document.createElement("option");
      o.value = ""; o.textContent = f.type === "select" ? "（默认）" : "（不绑定）";
      sel.appendChild(o);
    }
    for (const o of opts) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    if (cur && !opts.some((o) => o.value === cur)) {
      const o = document.createElement("option");
      o.value = cur; o.textContent = cur + "（清单里写的，模型里没有）";
      sel.appendChild(o);
    }
    sel.value = cur;
    sel.addEventListener("change", () => { cfg[f.key] = sel.value; touch(); });
    wrap.appendChild(sel);
    if (f.hint) wrap.appendChild(el("div", "note", f.hint));
    return wrap;
  }

  function optionsFor(f) {
    const rep = (S.doc && S.doc.report) || {};
    if (f.type === "param") {
      const list = (rep.params || []).map((p) => ({
        value: p.id,
        // 中文名放前面：用户认的是「左右转头」，不是 ParamAngleX。组名不进 label（装不下），
        // 需要的时候搜索框里还能按 id 找。
        label: (p.name ? p.name + "  ·  " : "") + p.id,
      }));
      // 标准名排前面：绝大多数模型用的就是这几个
      list.sort((a, b) => {
        const sa = /^Param/.test(a.value) && a.value === f.slot ? -1 : 0;
        const sb = /^Param/.test(b.value) && b.value === f.slot ? -1 : 0;
        return sa - sb || a.value.localeCompare(b.value);
      });
      return list;
    }
    if (f.type === "expression") {
      return (rep.expressions || []).map((e) => ({ value: e.name, label: e.name }));
    }
    if (f.type === "select" && f.optionsFrom === "action") {
      const out = [];
      out.push({ value: "builtin:" + (f.defaultScene || ""), label: "内置动作（推荐） · " + (f.defaultScene || "") });
      for (const g of Object.keys(rep.motions || {})) {
        out.push({ value: "model:" + g, label: "模型自带 · " + g });
      }
      // 未声明 / 精确到某一支的动作：值里带包内路径，播的就是这一支，
      // 不受「同组第几个」影响。适配器扫到的文件都会出现在这里。
      const rtm = (S.rt && S.rt.motions) || [];
      for (const m of rtm) {
        const nm = m.file.split("/").pop().replace(/\.motion3\.json$/i, "");
        out.push({ value: "file:" + m.file, label: "动作文件 · " + m.group + (m.declared === false ? " · 未声明 " : " · ") + nm });
      }
      out.push({ value: "none", label: "不做动作" });
      return out;
    }
    if (f.type === "select" && f.optionsFrom === "groups") {
      const out = [{ value: "", label: "（没有）" }];
      for (const g of (rep.groupList || [])) {
        out.push({ value: g.name, label: g.name + (g.ids && g.ids.length ? "  (" + g.ids.length + ")" : "  (空)") });
      }
      return out;
    }
    if (f.options && Array.isArray(f.options)) {
      return f.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    }
    return [];
  }

  function mapToText(m) {
    if (!m || typeof m !== "object") return "";
    return Object.keys(m).map((k) => k + " = " + m[k]).join("\n");
  }
  function textToMap(t) {
    const out = {};
    for (const line of String(t || "").split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const i = s.indexOf("=");
      if (i < 0) continue;
      const k = s.slice(0, i).trim();
      const v = s.slice(i + 1).trim();
      if (k && v) out[k] = v;
    }
    return out;
  }

  const FOOT0 = "导入的模型会复制到用户目录，不动原文件。";
  function markDirty(on) {
    const n = $("footNote");
    const b = $("btnSave");
    if (n) {
      n.textContent = on ? "有改动还没保存 —— 点右边「保存并应用」才会写进本机配置" : FOOT0;
      n.classList.toggle("warn", !!on);
    }
    if (b) b.classList.toggle("dirty", !!on);
  }

  function touch() {
    S.dirty = true;
    $("formState").textContent = "未保存";
    markDirty(true);
    // 参数绑定改了，动作要按新映射播；布局改了，取景框要跟着动
    paramMapCache = null;
    drawBox();
  }

  // ── 体检 ──────────────────────────────────────────────────
  function renderDiag(d) {
    if (!d) { diagEl.style.display = "none"; return; }
    diagEl.style.display = "";
    diagEl.innerHTML = "";
    const sum = el("div", "sum");
    const sc = el("div", "score " + (d.score >= 85 ? "g" : d.score >= 60 ? "y" : "r"), String(d.score));
    sum.appendChild(sc);
    const txt = el("div", "txt");
    txt.appendChild(el("div", "verdict", d.verdictText || d.verdict || ""));
    txt.appendChild(el("div", "head", d.headline || ""));
    sum.appendChild(txt);
    diagEl.appendChild(sum);

    // ---------- 表情能力 ----------
    // 换模型的用户进来第一句问的就是「我这个模型能演多少」，所以放在问题列表之前。
    // 分数是加权算的（眼睑/嘴型/歪头权重最高），不是简单数参数个数 ——
    // 只有眼睑和嘴的模型照样能演害羞生气，报个 40% 只会吓到人。
    const st = d.stats || {};
    if (typeof st.exprScore === "number" && st.exprTotal) {
      const box = el("div", "exprbar");
      box.style.cssText = "margin:8px 0 10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04)";
      const head = el("div");
      head.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:6px";
      const t = el("span", "", "表情能力");
      t.style.opacity = ".75";
      const v = el("span", "", st.exprScore + "%");
      v.style.cssText = "font-weight:700;color:" +
        (st.exprScore >= 85 ? "#7ee0a8" : st.exprScore >= 60 ? "#f0c95a" : "#f08a8a");
      const det = el("span", "", "直连 " + st.exprDirect + " · 降级 " + st.exprDegraded + " · 缺 " + (st.exprMissing || []).length);
      det.style.cssText = "margin-left:auto;opacity:.55;font-size:11px";
      head.appendChild(t); head.appendChild(v);
      // 试演：挑「害羞」——眯眼 + 笑 + 低头 + 视线躲，几乎把所有表情参数都用上了，
      // 一段就能看出这台模型的表演骨架齐不齐。
      const demo = el("button", "mini", "试演");
      demo.style.cssText = "margin-left:2px;font-size:11px;padding:1px 7px;line-height:1.6";
      demo.title = "在这个模型上播一段「害羞」，看看表情参数接得对不对";
      demo.addEventListener("click", (e) => {
        e.stopPropagation();
        const d2 = window.FishExprCurves;
        if (!d2) { toast("表演库没加载（expr-curves.js）", "bad"); return; }
        const by = (d2.byLabel && (d2.byLabel["害羞"] || d2.byLabel.happy)) || [];
        playExprStyleById(by.length ? by[0] : "54");
      });
      head.appendChild(demo);
      head.appendChild(det);
      box.appendChild(head);

      const track = el("div");
      track.style.cssText = "height:5px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden";
      const fill = el("div");
      fill.style.cssText = "height:100%;width:" + st.exprScore + "%;border-radius:3px;background:linear-gradient(90deg,#5ac8fa,#7ee0a8)";
      track.appendChild(fill);
      box.appendChild(track);

      const miss = st.exprMissing || [];
      if (miss.length) {
        const ml = el("div", "", "缺：" + miss.slice(0, 6).map((x) => x.label).join("、") + (miss.length > 6 ? " 等" : ""));
        ml.style.cssText = "margin-top:5px;font-size:11px;opacity:.5;line-height:1.5";
        box.appendChild(ml);
      }
      diagEl.appendChild(box);
    }

    for (const it of (d.issues || []).slice(0, 14)) {
      const row = el("div", "issue " + (it.level || "info"));
      row.appendChild(el("div", "lv", it.level === "error" ? "✕" : it.level === "warn" ? "!" : "·"));
      row.appendChild(el("div", "ms", it.message || it.text || ""));
      if (it.ruleId) {
        const fx = el("button", "fx", "去改");
        fx.style.background = "none";
        fx.style.border = "none";
        fx.addEventListener("click", () => {
          const step = stepsEl.querySelector('.step[data-rule="' + it.ruleId + '"]');
          if (step) {
            for (const s3 of stepsEl.querySelectorAll(".step.open")) s3.classList.remove("open");
            step.classList.add("open");
            step.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        });
        row.appendChild(fx);
      }
      diagEl.appendChild(row);
    }
  }

  // ── 保存 / 应用 ───────────────────────────────────────────
  async function save() {
    if (!S.doc) return false;
    $("btnSave").disabled = true;
    $("formState").textContent = "保存中…";
    try {
      const m = S.doc.manifest || {};
      await api("/api/packs/" + encodeURIComponent(S.doc.id) + "/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: m.displayName,
          description: m.description,
          author: m.author,
          license: m.license,
          cfgs: S.cfgs,
        }),
      });
      S.dirty = false;
      markDirty(false);
      toast("已保存", "ok");
      // 重新拉一遍：体检分、步骤标记、动作选项都会变
      const r = await api("/api/packs/" + encodeURIComponent(S.doc.id));
      S.doc = r;
      S.cfgs = JSON.parse(JSON.stringify(r.cfgs || {}));
      renderForm(r);
      renderDiag(r.diagnose);
      renderBar(r);
      $("formState").textContent = r.origin === "builtin" ? "本机配置" : "可编辑";
      // 让主窗口重读配置（不重载模型）
      try { await window.deskfish.adapterReload(); } catch (e) { }
      return true;
    } catch (e) {
      toast("保存失败：" + e.message, "bad");
      $("formState").textContent = "保存失败";
      return false;
    } finally {
      $("btnSave").disabled = false;
    }
  }

  // 恢复默认：把绑定/动作/表情/取景/手感全部退回探测建议。
  // 二次确认要说清「会丢什么」，不能只问「确定吗」—— 用户不知道自己在放弃什么。
  async function resetConfig() {
    if (!S.doc) return;
    if (S.dirty && !window.confirm("当前有未保存的改动，恢复默认会一并丢掉。继续？")) return;
    if (!window.confirm("把「" + (S.doc.displayName || S.doc.id) + "」的绑定、动作、表情、取景、手感全部恢复成自动探测的初始状态？模型文件不会动，只是配置重来。")) return;
    try {
      await api("/api/packs/" + encodeURIComponent(S.doc.id) + "/reset", { method: "POST", body: {} });
      S.dirty = false;
      markDirty(false);
      toast("已恢复默认配置", "ok");
      await select(S.doc.id, { silent: true });
    } catch (e) {
      toast("恢复失败：" + e.message, "bad");
    }
  }

  async function applyNow() {
    if (!S.doc) return;
    if (S.dirty) {
      const ok = confirm("还有没保存的改动。要连改动一起应用吗？（选取消就只切模型）");
      // save() 自己会把异常咽下去（它要负责把「保存失败」写到 formState 上），
      // 所以这里必须看返回值：存不上还接着切模型，等于用旧配置上线。
      if (ok && !(await save())) return;
    }
    try {
      const r = await window.deskfish.adapterActivate(S.doc.id);
      if (!r || r.ok === false) { toast("切换失败：" + ((r && r.error) || ""), "bad"); return; }
      toast("已设为当前模型", "ok");
      $("hdrSub").textContent = "当前：" + S.doc.id;
      renderList(S.doc.id);
    } catch (e) {
      toast("切换失败：" + e.message, "bad");
    }
  }

  async function importDir() {
    const p = await window.deskfish.adapterPickDir();
    if (!p || !p.ok) return;
    return importPath(p.path, "文件夹");
  }

  async function importZip() {
    const p = await window.deskfish.adapterPickArchive();
    if (!p || !p.ok) return;
    return importPath(p.path, "压缩包");
  }

  // 拖拽导入：把 zip 或文件夹直接丢到窗口上。
  // Electron 里 File.path 是真实路径（Electron 32+ 需要 webUtils，这里兼容两种）。
  async function importDropped(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const f = files[0];
    const p = f.path || (window.deskfish && window.deskfish.pathForFile ? window.deskfish.pathForFile(f) : "");
    if (!p) { toast("拿不到这个文件的路径，请用按钮导入", "bad"); return; }
    return importPath(p, /\.zip$/i.test(p) ? "压缩包" : "文件夹");
  }

  async function importPath(path, kind) {
    const zip = /\.zip$/i.test(String(path || ""));
    try {
      $("btnImport").disabled = true;
      if ($("btnImportZip")) $("btnImportZip").disabled = true;
      toast("正在检查" + (kind || (zip ? "压缩包" : "文件夹")) + "…");
      const chk = await api("/api/packs/check?path=" + encodeURIComponent(path));
      if (!chk.ok || !chk.canImport) {
        // 说清楚到底缺什么：找到清单但缺贴图，和「根本没找到模型」是两回事，
        // 一律回「找不到 .model3.json」会让用户对着明明存在的清单文件怀疑人生。
        const list = chk.issues || [];
        const first = list.find((x) => x.level === "error") || list[0];
        toast(chk.error || (first && first.message) || "这个文件夹不能导入", "bad");
        return;
      }
      // 让「检查」这件事被看见：用户得知道即将拷进来的是什么、占多大。
      const rp = chk.report || {};
      const brief = [
        (rp.params || 0) + " 参数",
        (rp.motionFiles || 0) + " 动作",
        (rp.expressions || 0) + " 表情",
        (rp.textures || 0) + " 贴图",
        Math.max(1, Math.round((chk.bytes || 0) / 1048576)) + "MB",
      ].join(" · ");
      const arc = chk.archive ? " · 解包 " + (chk.archive.files || 0) + " 个文件" : "";
      toast("检查通过：" + brief + arc + (chk.clash ? " · 同 id 会自动改名" : "") + "，正在" + (zip ? "解包并复制" : "复制") + "…");
      await new Promise((r) => setTimeout(r, 320));
      const r = await api("/api/packs/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
      toast("已导入 " + (r.id || ""), "ok");
      await loadList();
      if (r.id) select(r.id, { silent: true });
    } catch (e) {
      toast("导入失败：" + e.message, "bad");
    } finally {
      $("btnImport").disabled = false;
      if ($("btnImportZip")) $("btnImportZip").disabled = false;
    }
  }

  // ── 事件 ──────────────────────────────────────────────────
  $("btnClose").addEventListener("click", () => window.deskfish.closeAdapter());
  $("btnImport").addEventListener("click", importDir);
  if ($("btnImportZip")) $("btnImportZip").addEventListener("click", importZip);

  // 整个窗口接收拖拽；拖进来时给一圈高亮，松手前就知道「这里能放」
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.body.classList.add("dropping");
  });
  window.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null) document.body.classList.remove("dropping");
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    document.body.classList.remove("dropping");
    importDropped(e.dataTransfer && e.dataTransfer.files);
  });
  $("btnSave").addEventListener("click", save);
  $("btnApply").addEventListener("click", applyNow);
  $("btnReset").addEventListener("click", resetConfig);
  $("btnReload").addEventListener("click", async () => {
    builtinCache = null;
    await loadList();
    toast("已重读");
  });

  // ── 取景交互（原独立取景窗并进来）────────────────────────────
  // 滚轮缩放：以指针所在位置为锚，缩放时「指针下面那一块模型」不动，手感才像在推镜头。
  previewEl.addEventListener("wheel", (e) => {
    if (!S.model) return;
    e.preventDefault();
    const dispH = Math.max(1, S.model.height);
    const modelTop = S.model.position.y - dispH / 2;
    const anchor = (e.clientY - modelTop) / dispH;
    const lay = cfgOf("layout") || {};
    const vh0 = Math.max(0.06, num(lay.viewH, 0.5));
    const vy0 = num(lay.viewY, 0.1);
    const k = e.deltaY > 0 ? 1.06 : 1 / 1.06;
    const nh = Math.min(1.3, Math.max(0.06, vh0 * k));
    const rel = (anchor - vy0) / vh0;               // 锚点在框里的相对位置保持不变
    const ny = Math.min(0.95, Math.max(-0.2, anchor - rel * nh));
    setBoxValue("viewY", Math.round(ny * 1000) / 1000);
    setBoxValue("viewH", Math.round(nh * 1000) / 1000);
    if (S.crop) layoutPreview(); else drawBox();
    touch();
  }, { passive: false });

  if (vfCropBtn) {
    vfCropBtn.addEventListener("click", () => {
      S.crop = !S.crop;
      previewEl.classList.toggle("crop", S.crop);
      vfCropBtn.classList.toggle("on", S.crop);
      vfCropBtn.textContent = S.crop ? "退出主窗口视图" : "主窗口视图";
      layoutPreview();
    });
  }

  if (vfResetBtn) {
    vfResetBtn.addEventListener("click", async () => {
      if (!S.doc) return;
      try {
        const r = await api("/api/packs/" + encodeURIComponent(S.doc.id) + "/recommend");
        const cfg = (r && r.cfg) || {};
        const lay = cfgOf("layout") || {};
        for (const key of ["viewY", "viewH", "offsetX", "padding"]) {
          if (cfg[key] == null) continue;
          lay[key] = cfg[key];
          const s = S.sliders && S.sliders[key];
          if (s) { s.inp.value = String(cfg[key]); s.valEl.textContent = cfg[key] + s.unit; }
        }
        if (S.crop) layoutPreview(); else { layoutPreview(); }
        touch();
        toast("已按这个模型重新给了一版取景，觉得合适再保存", "ok");
      } catch (e) {
        toast("推荐取景失败：" + e.message, "bad");
      }
    });
  }

  window.addEventListener("resize", () => { layoutPreview(); drawBox(); });
  if (window.ResizeObserver) {
    new ResizeObserver(() => { layoutPreview(); drawBox(); }).observe(previewEl);
  }
  window.addEventListener("beforeunload", () => {
    if (!S.dirty) return;
    // Electron 里 beforeunload 不能直接弹自定义框，交给主进程的 close 确认更靠谱；
    // 这里只是最后一道「别把改动悄悄丢了」的网。
    S.dirty = false;
  });

  // 适配器窗口被要求切到某个模型（比如从设置页点「适配这个模型」）
  try {
    window.deskfish.onAdapterSelect((id) => { if (id && id !== S.curId) select(id); });
  } catch (e) { }
  // 窗口已经开着时又点了「调整取景」：滚到取景步骤（不重载页面，避免丢掉未保存的改动）
  try {
    if (window.deskfish.onAdapterFocusStep) {
      window.deskfish.onAdapterFocusStep((step) => {
        const st = stepsEl.querySelector('.step[data-rule="' + step + '"]');
        if (!st) return;
        for (const s2 of stepsEl.querySelectorAll(".step.open")) s2.classList.remove("open");
        st.classList.add("open");
        st.scrollIntoView({ block: "nearest" });
      });
    }
  } catch (e) { }

  // 关窗口时把 PIXI / WebGL 资源放掉：不然每开一次适配器就多一份 8192 贴图，
  // 来回开几次显存就上去了（任务管理器里表现为 Electron GPU 进程一路涨）。
  window.addEventListener("beforeunload", () => {
    try {
      // 贴图由 Pixi 的 Assets 托管，这里显式 destroy 会触发
      // "[Assets] A Texture managed by Assets was destroyed instead of unloaded" 警告。
      // 页面马上就要销毁，GPU 资源会随 WebGL context 一起回收，交给渲染器即可。
      if (S.app) S.app.destroy(true, { children: true, texture: false, textureSource: false });
    } catch (e) { }
    S.model = null;
    S.app = null;
  });

  loadList();
})();
