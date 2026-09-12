(function(){
  "use strict";

  /* ---------------- storage adapter (localStorage w/ in-memory fallback) ---------------- */
  const memoryStore = {};
  let usingFallback = false;
  const storage = {
    get(key, fallback){
      try{
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      }catch(e){
        usingFallback = true;
        return (key in memoryStore) ? memoryStore[key] : fallback;
      }
    },
    set(key, value){
      try{
        localStorage.setItem(key, JSON.stringify(value));
      }catch(e){
        usingFallback = true;
        memoryStore[key] = value;
      }
    }
  };

  const STORE_KEY = "slate.widgets.v1";
  const BG_KEY = "slate.background.v1";
  const canvas = document.getElementById("canvas");
  const storageFlag = document.getElementById("storageFlag");

  /* ---------------- IndexedDB-backed asset store (for large background blobs) ---------------- */
  const idb = {
    _db: null,
    open(){
      if (this._db) return Promise.resolve(this._db);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("slate-assets", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("assets")) req.result.createObjectStore("assets");
        };
        req.onsuccess = () => { this._db = req.result; resolve(this._db); };
        req.onerror = () => reject(req.error);
      });
    },
    put(key, blob){
      return this.open().then(db => new Promise((resolve, reject) => {
        try{
          const tx = db.transaction("assets", "readwrite");
          tx.objectStore("assets").put(blob, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }catch(e){ reject(e); }
      }));
    },
    get(key){
      return this.open().then(db => new Promise((resolve, reject) => {
        try{
          const tx = db.transaction("assets", "readonly");
          const rq = tx.objectStore("assets").get(key);
          rq.onsuccess = () => resolve(rq.result);
          rq.onerror = () => reject(rq.error);
        }catch(e){ reject(e); }
      }));
    },
    del(key){
      return this.open().then(db => new Promise((resolve, reject) => {
        try{
          const tx = db.transaction("assets", "readwrite");
          tx.objectStore("assets").delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }catch(e){ reject(e); }
      }));
    }
  };

  function readAsDataURL(blob){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  async function saveBackgroundBlob(blob){
    try{
      const key = "bg_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      await idb.put(key, blob);
      return { type:"blob", key };
    }catch(e){
      const dataUrl = await readAsDataURL(blob);
      if (dataUrl.length < 4 * 1024 * 1024) return { type:"dataurl", url:dataUrl };
      throw new Error("image too large to store — use a smaller file or a URL");
    }
  }

  let bgObjectUrl = null;
  async function applyBackground(){
    const cfg = storage.get(BG_KEY, null);
    const layer = document.getElementById("bgLayer");
    if (bgObjectUrl){ URL.revokeObjectURL(bgObjectUrl); bgObjectUrl = null; }
    let url = null;
    if (cfg){
      if (cfg.type === "blob"){
        const blob = await idb.get(cfg.key).catch(() => null);
        if (blob){ bgObjectUrl = URL.createObjectURL(blob); url = bgObjectUrl; }
      } else if (cfg.url){
        url = cfg.url;
      }
    }
    layer.style.backgroundImage = url ? `url("${url}")` : "";
    layer.classList.toggle("has-image", !!url);
  }

  let widgets = storage.get(STORE_KEY, null);
  if (!widgets){
    widgets = [
      { id: uid(), type:"calculator", x:120, y:150, w:110, h:110,
        style:{hue:40, radius:0, opacity:100}, data:{} },
      { id: uid(), type:"todo", x:270, y:150, w:110, h:110,
        style:{hue:150, radius:0, opacity:100}, data:{items:[]} },
      { id: uid(), type:"calendar", x:195, y:290, w:110, h:110,
        style:{hue:280, radius:0, opacity:100}, data:{notes:{}} },
      { id: uid(), type:"ocr", x:120, y:430, w:110, h:110,
        style:{hue:200, radius:0, opacity:100}, data:{} },
    ];
  }

  let editMode = false;
  let zTop = 10;

  function uid(){ return Math.random().toString(36).slice(2,10); }

  function persist(){
    storage.set(STORE_KEY, widgets);
    storageFlag.style.display = usingFallback ? "block" : "none";
  }

  function tileColor(hue){
    return `hsl(${hue} 22% 24%)`;
  }

  /* ---------------- icons per type ---------------- */
  const ICONS = {
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6"/><path d="M13 6h5v5"/><path d="M11 18H6a3 3 0 0 1-3-3v-1"/><path d="M13 18h2a4 4 0 0 0 4-4v-1"/></svg>',
    calculator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/></svg>',
    todo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M16 4v3h3"/></svg>',
    ocr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H4a1 1 0 0 0-1 1v3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>'
  };

  const WIDGET_LABELS = { calculator:"Calculator", todo:"To-do", calendar:"Calendar", ocr:"OCR", note:"Note" };

  /* ---------------- smart search map ---------------- */
  const SMART_URLS = {
    youtube:"https://www.youtube.com", yt:"https://www.youtube.com",
    github:"https://github.com", gh:"https://github.com",
    twitter:"https://x.com", x:"https://x.com",
    reddit:"https://www.reddit.com",
    wikipedia:"https://en.wikipedia.org", wiki:"https://en.wikipedia.org",
    amazon:"https://www.amazon.com",
    maps:"https://maps.google.com",
    gmail:"https://mail.google.com", drive:"https://drive.google.com",
    docs:"https://docs.google.com", sheets:"https://docs.google.com/spreadsheets",
    slides:"https://docs.google.com/presentation",
    notion:"https://www.notion.so",
    stackoverflow:"https://stackoverflow.com", so:"https://stackoverflow.com",
    discord:"https://discord.com/channels", slack:"https://slack.com",
    netflix:"https://www.netflix.com",
    spotify:"https://open.spotify.com",
    twitch:"https://www.twitch.tv",
    linkedin:"https://www.linkedin.com",
    medium:"https://medium.com", devto:"https://dev.to",
    npm:"https://www.npmjs.com", jsdelivr:"https://cdn.jsdelivr.net",
    mdn:"https://developer.mozilla.org", caniuse:"https://caniuse.com",
    codepen:"https://codepen.io", codesandbox:"https://codesandbox.io",
    stackblitz:"https://stackblitz.com", replit:"https://replit.com",
    vercel:"https://vercel.com", netlify:"https://app.netlify.com",
    firebase:"https://console.firebase.google.com", supabase:"https://supabase.com",
    cloudflare:"https://www.cloudflare.com",
    aws:"https://console.aws.amazon.com", azure:"https://portal.azure.com",
    gcp:"https://console.cloud.google.com", digitalocean:"https://www.digitalocean.com",
    linear:"https://linear.app",
    figma:"https://www.figma.com", canva:"https://www.canva.com",
    unsplash:"https://unsplash.com", pexels:"https://www.pexels.com",
    chatgpt:"https://chatgpt.com", claude:"https://claude.ai",
    gemini:"https://gemini.google.com", perplexity:"https://www.perplexity.ai",
    huggingface:"https://huggingface.co", hf:"https://huggingface.co",
    deepseek:"https://chat.deepseek.com",
    google:"https://www.google.com", bing:"https://www.bing.com",
    duckduckgo:"https://duckduckgo.com", ddg:"https://duckduckgo.com",
    archive:"https://archive.org", arxiv:"https://arxiv.org",
    scholar:"https://scholar.google.com", wolframalpha:"https://www.wolframalpha.com",
    outlook:"https://outlook.live.com", protonmail:"https://mail.proton.me",
    telegram:"https://web.telegram.org", whatsapp:"https://web.whatsapp.com",
    teams:"https://teams.microsoft.com", zoom:"https://zoom.us",
    ebay:"https://www.ebay.com", imdb:"https://www.imdb.com",
    dropbox:"https://www.dropbox.com", onedrive:"https://onedrive.live.com",
    react:"https://react.dev", vue:"https://vuejs.org",
    svelte:"https://svelte.dev", nextjs:"https://nextjs.org",
    nuxt:"https://nuxt.com", astro:"https://astro.build",
    deno:"https://deno.com", bun:"https://bun.sh",
    tailwind:"https://tailwindcss.com",
    hackernews:"https://news.ycombinator.com", hn:"https://news.ycombinator.com",
    producthunt:"https://www.producthunt.com", ph:"https://www.producthunt.com",
    substack:"https://substack.com", hashnode:"https://hashnode.com",
    rust:"https://www.rust-lang.org", go:"https://go.dev",
    python:"https://www.python.org", typescript:"https://www.typescriptlang.org",
    xkcd:"https://xkcd.com", goodreads:"https://www.goodreads.com",
    leetcode:"https://leetcode.com",
    apple:"https://www.apple.com", microsoft:"https://www.microsoft.com",
    dribbble:"https://dribbble.com", behance:"https://www.behance.net"
  };

  function isLikelyUrl(q){
    const t = q.trim();
    if (/^https?:\/\//i.test(t)) return t;
    if (/^www\./i.test(t)) return "https://" + t;
    if (/^[a-z0-9-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return "https://" + t;
    return null;
  }

  function formatDomain(url){
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch(e){ return url; }
  }

  function iconFor(w){
    if (w.type === "shortcut") return ICONS.link;
    return ICONS[w.type] || ICONS.link;
  }

  /* ---------------- render ---------------- */
  function renderAll(){
    canvas.innerHTML = "";
    widgets.forEach(renderWidget);
  }

  function renderWidget(w){
    const el = document.createElement("div");
    el.className = "widget";
    el.dataset.id = w.id;
    el.dataset.type = w.type;
    el.style.left = w.x + "px";
    el.style.top = w.y + "px";
    el.style.width = w.w + "px";
    el.style.height = w.h + "px";
    el.style.borderRadius = w.style.radius + "px";
    el.style.opacity = (w.style.opacity/100).toFixed(2);
    el.style.zIndex = ++zTop;

    const head = document.createElement("div");
    head.className = "widget-head";
    head.innerHTML = `<div class="dots"><span></span><span></span><span></span></div>`;
    el.appendChild(head);

    const gear = document.createElement("button");
    gear.className = "widget-gear";
    gear.title = "Style";
    gear.setAttribute("aria-label", "Style");
    gear.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15 1.65 1.65 0 0 0 3.17 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.36.4.68.74.9.24.16.52.25.86.25H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    gear.addEventListener("click", (e) => { e.stopPropagation(); openStylePop(w, el); });
    el.appendChild(gear);

    const body = document.createElement("div");
    body.className = "widget-body";

    if (w.type === "note"){
      const ta = document.createElement("textarea");
      ta.className = "note-text";
      ta.placeholder = "Write something…";
      ta.value = w.data.text || "";
      ta.addEventListener("pointerdown", e => e.stopPropagation());
      ta.addEventListener("input", () => { w.data.text = ta.value; persist(); });
      body.appendChild(ta);
    } else {
      const icon = document.createElement("div");
      icon.className = "widget-icon";
      icon.style.setProperty("--tile", tileColor(w.style.hue));
      icon.innerHTML = iconFor(w);
      const label = document.createElement("div");
      label.className = "widget-label";
      label.textContent = w.type === "shortcut" ? (w.data.label || "Shortcut") : (WIDGET_LABELS[w.type] || "Widget");
      body.appendChild(icon);
      body.appendChild(label);

      body.addEventListener("click", (e) => {
        if (editMode) return;
        activate(w);
      });
    }

    el.appendChild(body);

    const handle = document.createElement("div");
    handle.className = "resize-handle";
    el.appendChild(handle);

    canvas.appendChild(el);
    wireDrag(el, w, head);
    wireResize(el, w, handle);
  }

  /* ---------------- drag / resize ---------------- */
  function wireDrag(el, w, handle){
    let dragging = false, sx=0, sy=0, ox=0, oy=0;
    handle.addEventListener("pointerdown", (e) => {
      if (!editMode) return;
      if (e.target.closest(".widget-gear")) return;
      dragging = true;
      el.style.zIndex = ++zTop;
      sx = e.clientX; sy = e.clientY; ox = w.x; oy = w.y;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      w.x = Math.max(0, ox + (e.clientX - sx));
      w.y = Math.max(0, oy + (e.clientY - sy));
      el.style.left = w.x + "px";
      el.style.top = w.y + "px";
    });
    function end(e){
      if (!dragging) return;
      dragging = false;
      persist();
    }
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);

    el.addEventListener("pointerdown", () => { el.style.zIndex = ++zTop; });
  }

  function wireResize(el, w, handle){
    let resizing = false, sx=0, sy=0, ow=0, oh=0;
    handle.addEventListener("pointerdown", (e) => {
      if (!editMode) return;
      e.stopPropagation();
      resizing = true;
      sx = e.clientX; sy = e.clientY; ow = w.w; oh = w.h;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      w.w = Math.max(90, ow + (e.clientX - sx));
      w.h = Math.max(90, oh + (e.clientY - sy));
      el.style.width = w.w + "px";
      el.style.height = w.h + "px";
    });
    function end(){
      if (!resizing) return;
      resizing = false;
      persist();
    }
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  /* ---------------- edit mode ---------------- */
  const btnEdit = document.getElementById("btnEdit");
  btnEdit.addEventListener("click", () => {
    editMode = !editMode;
    btnEdit.classList.toggle("active", editMode);
    document.querySelectorAll(".widget").forEach(el => el.dataset.editing = editMode ? "1" : "0");
    closeStylePop();
  });

  /* ---------------- style popover ---------------- */
  const stylePop = document.getElementById("stylePop");
  const popShortcutFields = document.getElementById("popShortcutFields");
  const popLabel = document.getElementById("popLabel");
  const popUrl = document.getElementById("popUrl");
  const popHue = document.getElementById("popHue");
  const popRadius = document.getElementById("popRadius");
  const popOpac = document.getElementById("popOpac");
  const popHueVal = document.getElementById("popHueVal");
  const popRadiusVal = document.getElementById("popRadiusVal");
  const popOpacVal = document.getElementById("popOpacVal");
  const popDelete = document.getElementById("popDelete");
  let popTarget = null, popEl = null;

  function openStylePop(w, el){
    popTarget = w; popEl = el;
    popShortcutFields.style.display = w.type === "shortcut" ? "flex" : "none";
    if (w.type === "shortcut"){
      popLabel.value = w.data.label || "";
      popUrl.value = w.data.url || "";
    }
    popHue.value = w.style.hue; popHueVal.textContent = w.style.hue + "°";
    popRadius.value = w.style.radius; popRadiusVal.textContent = w.style.radius + "px";
    popOpac.value = w.style.opacity; popOpacVal.textContent = w.style.opacity + "%";

    const r = el.getBoundingClientRect();
    let left = r.right + 10;
    if (left + 220 > window.innerWidth) left = r.left - 220;
    stylePop.style.left = Math.max(8,left) + "px";
    stylePop.style.top = Math.max(8, r.top) + "px";
    stylePop.classList.add("open");
  }
  function closeStylePop(){ stylePop.classList.remove("open"); popTarget = null; popEl = null; }

  document.addEventListener("pointerdown", (e) => {
    if (stylePop.classList.contains("open") && !stylePop.contains(e.target) && !e.target.closest(".widget-gear")){
      closeStylePop();
    }
  });

  [popLabel, popUrl].forEach(inp => inp.addEventListener("input", () => {
    if (!popTarget) return;
    popTarget.data.label = popLabel.value;
    popTarget.data.url = popUrl.value;
    const lbl = popEl.querySelector(".widget-label");
    if (lbl) lbl.textContent = popLabel.value || "Shortcut";
    persist();
  }));

  popHue.addEventListener("input", () => {
    if (!popTarget) return;
    popTarget.style.hue = +popHue.value;
    popHueVal.textContent = popHue.value + "°";
    const icon = popEl.querySelector(".widget-icon");
    if (icon) icon.style.setProperty("--tile", tileColor(popTarget.style.hue));
    persist();
  });
  popRadius.addEventListener("input", () => {
    if (!popTarget) return;
    popTarget.style.radius = +popRadius.value;
    popRadiusVal.textContent = popRadius.value + "px";
    popEl.style.borderRadius = popRadius.value + "px";
    persist();
  });
  popOpac.addEventListener("input", () => {
    if (!popTarget) return;
    popTarget.style.opacity = +popOpac.value;
    popOpacVal.textContent = popOpac.value + "%";
    popEl.style.opacity = (popOpac.value/100).toFixed(2);
    persist();
  });
  popDelete.addEventListener("click", () => {
    if (!popTarget) return;
    widgets = widgets.filter(w => w.id !== popTarget.id);
    persist();
    closeStylePop();
    renderAll();
    document.querySelectorAll(".widget").forEach(el => el.dataset.editing = editMode ? "1" : "0");
  });

  /* ---------------- add widget modal ---------------- */
  const addOverlay = document.getElementById("addOverlay");
  const btnAdd = document.getElementById("btnAdd");
  const addCancel = document.getElementById("addCancel");
  const addConfirm = document.getElementById("addConfirm");
  const shortcutForm = document.getElementById("shortcutForm");
  const scLabel = document.getElementById("scLabel");
  const scUrl = document.getElementById("scUrl");
  let pendingType = null;

  btnAdd.addEventListener("click", () => {
    pendingType = null;
    shortcutForm.classList.remove("open");
    addConfirm.disabled = true;
    document.querySelectorAll(".type-card").forEach(c => c.style.borderColor = "var(--line)");
    addOverlay.classList.add("open");
  });
  addCancel.addEventListener("click", () => addOverlay.classList.remove("open"));
  addOverlay.addEventListener("click", (e) => { if (e.target === addOverlay) addOverlay.classList.remove("open"); });

  document.querySelectorAll(".type-card").forEach(card => {
    card.addEventListener("click", () => {
      pendingType = card.dataset.type;
      document.querySelectorAll(".type-card").forEach(c => c.style.borderColor = "var(--line)");
      card.style.borderColor = "var(--accent)";
      shortcutForm.classList.toggle("open", pendingType === "shortcut");
      addConfirm.disabled = pendingType === "shortcut" ? !(scLabel.value && scUrl.value) : false;
    });
  });
  [scLabel, scUrl].forEach(i => i.addEventListener("input", () => {
    if (pendingType === "shortcut") addConfirm.disabled = !(scLabel.value && scUrl.value);
  }));

  addConfirm.addEventListener("click", () => {
    if (!pendingType) return;
    const base = {
      id: uid(), type: pendingType,
      x: 140 + Math.random()*160, y: 150 + Math.random()*120,
      w: 110, h: 110,
      style:{ hue: Math.floor(Math.random()*360), radius:0, opacity:100 },
      data: {}
    };
    if (pendingType === "shortcut") base.data = { label: scLabel.value, url: normalizeUrl(scUrl.value), icon:"link" };
    if (pendingType === "todo") base.data = { items: [] };
    if (pendingType === "calendar") base.data = { notes: {} };
    if (pendingType === "note") base.data = { text: "" };
    widgets.push(base);
    persist();
    renderAll();
    document.querySelectorAll(".widget").forEach(el => el.dataset.editing = editMode ? "1" : "0");
    addOverlay.classList.remove("open");
    scLabel.value = ""; scUrl.value = "";
  });

  function normalizeUrl(u){
    if (!/^https?:\/\//i.test(u)) return "https://" + u;
    return u;
  }

  /* ---------------- dock menu (export/import/reset) ---------------- */
  const btnMenu = document.getElementById("btnMenu");
  const dockMenu = document.getElementById("dockMenu");
  btnMenu.addEventListener("click", (e) => { e.stopPropagation(); dockMenu.classList.toggle("open"); });
  document.addEventListener("pointerdown", (e) => {
    if (!dockMenu.contains(e.target) && e.target !== btnMenu && !btnMenu.contains(e.target)) dockMenu.classList.remove("open");
  });

  document.getElementById("btnExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(widgets, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "slate-layout.json";
    a.click();
    dockMenu.classList.remove("open");
  });

  const fileInput = document.getElementById("fileInput");
  document.getElementById("btnImport").addEventListener("click", () => {
    fileInput.click();
    dockMenu.classList.remove("open");
  });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const parsed = JSON.parse(reader.result);
        if (Array.isArray(parsed)){
          widgets = parsed;
          persist();
          renderAll();
        }
      }catch(e){ alert("That file couldn't be read as a layout export."); }
    };
    reader.readAsText(f);
    fileInput.value = "";
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    if (!confirm("Remove all widgets? This can't be undone.")) return;
    widgets = [];
    persist();
    renderAll();
    dockMenu.classList.remove("open");
  });

  /* ---------------- background settings ---------------- */
  const bgModal = document.getElementById("bgModal");
  const bgPick = document.getElementById("bgPick");
  const bgFile = document.getElementById("bgFile");
  const bgUrl = document.getElementById("bgUrl");
  const bgApplyUrl = document.getElementById("bgApplyUrl");
  const bgReset = document.getElementById("bgReset");
  const bgDone = document.getElementById("bgDone");

  document.getElementById("btnBackground").addEventListener("click", () => {
    dockMenu.classList.remove("open");
    const cfg = storage.get(BG_KEY, null);
    bgUrl.value = cfg && cfg.type === "url" && !cfg.url.startsWith("data:") ? cfg.url : "";
    bgModal.classList.add("open");
  });
  bgDone.addEventListener("click", () => bgModal.classList.remove("open"));
  bgModal.addEventListener("click", e => { if (e.target === bgModal) bgModal.classList.remove("open"); });
  bgPick.addEventListener("click", () => bgFile.click());
  bgFile.addEventListener("change", async () => {
    const f = bgFile.files[0];
    if (f && f.type.startsWith("image/")){
      try{
        storage.set(BG_KEY, await saveBackgroundBlob(f));
        await applyBackground();
        bgModal.classList.remove("open");
      }catch(err){
        alert("Couldn't use that image — " + err.message);
      }
    }
    bgFile.value = "";
  });
  bgApplyUrl.addEventListener("click", async () => {
    const u = bgUrl.value.trim();
    if (!u) return;
    storage.set(BG_KEY, { type:"url", url:u });
    await applyBackground();
    bgModal.classList.remove("open");
  });
  bgReset.addEventListener("click", async () => {
    const cfg = storage.get(BG_KEY, null);
    if (cfg && cfg.type === "blob") idb.del(cfg.key).catch(() => {});
    storage.set(BG_KEY, null);
    await applyBackground();
    bgModal.classList.remove("open");
  });

  /* ---------------- search bar with history suggestions ---------------- */
  const searchInput = document.getElementById("searchInput");
  const searchWrap = document.getElementById("searchWrap");
  const searchClear = document.getElementById("searchClear");
  const searchSuggest = document.getElementById("searchSuggest");
  const SEARCH_HISTORY_KEY = "slate.search.history.v1";
  let activeIdx = -1;

  function getSearchHistory(){
    const h = storage.get(SEARCH_HISTORY_KEY, null);
    return Array.isArray(h) ? h : [];
  }

  function saveSearchHistory(q){
    if (!q) return;
    const h = getSearchHistory().filter(s => s.toLowerCase() !== q.toLowerCase());
    h.unshift(q);
    storage.set(SEARCH_HISTORY_KEY, h.slice(0, 30));
    storageFlag.style.display = usingFallback ? "block" : "none";
  }

  function removeHistoryEntry(text){
    storage.set(SEARCH_HISTORY_KEY, getSearchHistory().filter(s => s !== text));
    storageFlag.style.display = usingFallback ? "block" : "none";
  }

  function doSearch(q){
    if (!q) return;
    openUrl("https://noai.duckduckgo.com/?ia=web&t=h_&q=" + encodeURIComponent(q));
  }

  function hideSuggest(){
    searchSuggest.classList.remove("open");
    searchSuggest.innerHTML = "";
    activeIdx = -1;
  }

  /* Open in a new tab via an anchor (works cleaner than window.open from file://) */
  function openUrl(url){
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function setActive(i){
    const items = searchSuggest.querySelectorAll(".ss-item");
    items.forEach((it, idx) => it.classList.toggle("active", idx === i));
    activeIdx = i;
  }

  const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>';
  const ICON_EXTERNAL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderSuggest(){
    const q = searchInput.value.trim();
    if (!q){ hideSuggest(); return; }
    const lower = q.toLowerCase();
    const rows = [];

    const directUrl = isLikelyUrl(q);
    if (directUrl) rows.push({ type:"direct", label:"Open " + directUrl, url:directUrl, icon:ICON_EXTERNAL, badge:"→" });

    const shortcutUrl = SMART_URLS[lower];
    if (shortcutUrl) rows.push({ type:"shortcut", label:"Go to " + formatDomain(shortcutUrl), url:shortcutUrl, icon:ICON_EXTERNAL, badge:"→" });

    getSearchHistory().filter(s => s.toLowerCase().includes(lower)).slice(0, 7).forEach(s => {
      rows.push({ type:"history", label:s, text:s, icon:ICONS.link, badge:"" });
    });

    rows.push({ type:"search", label:"Search for “" + q + "”", url:"https://noai.duckduckgo.com/?ia=web&t=h_&q=" + encodeURIComponent(q), icon:ICON_SEARCH, badge:"↵" });

    searchSuggest.innerHTML = "";
    rows.forEach((row, i) => {
      const div = document.createElement("div");
      div.className = "ss-item";
      if (row.url) div.dataset.url = row.url;
      if (row.text) div.dataset.text = row.text;

      const ic = document.createElement("span");
      ic.className = "ss-ic";
      ic.innerHTML = row.icon;
      div.appendChild(ic);

      const txtEl = document.createElement("span");
      txtEl.className = "ss-txt";
      txtEl.textContent = row.label;
      div.appendChild(txtEl);

      if (row.type === "history"){
        const del = document.createElement("button");
        del.className = "ss-del";
        del.type = "button";
        del.title = "Remove from history";
        del.setAttribute("aria-label", "Remove “" + row.label + "” from history");
        del.textContent = "✕";
        del.addEventListener("mousedown", e => {
          e.preventDefault();
          e.stopPropagation();
          removeHistoryEntry(row.text);
          renderSuggest();
        });
        div.appendChild(del);
      } else {
        const badge = document.createElement("span");
        badge.className = "ss-srch";
        badge.textContent = row.badge;
        div.appendChild(badge);
      }

      div.addEventListener("mousedown", e => {
        if (e.target.closest(".ss-del")) return;
        e.preventDefault();
        if (row.url) openUrl(row.url);
        else doSearch(row.text);
        saveSearchHistory(searchInput.value.trim());
        hideSuggest();
      });

      searchSuggest.appendChild(div);
    });

    const hint = document.createElement("div");
    hint.className = "ss-hint";
    hint.textContent = "↑ ↓ navigate · ↵ go · ✕ remove · esc close";
    searchSuggest.appendChild(hint);
    searchSuggest.classList.add("open");
    setActive(0);
  }

  searchInput.addEventListener("input", () => {
    searchWrap.classList.toggle("has-text", !!searchInput.value);
    if (searchInput.value.trim()) renderSuggest();
    else hideSuggest();
  });
  searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim()) renderSuggest();
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchWrap.classList.toggle("has-text", false);
    hideSuggest();
    searchInput.focus();
  });

  searchInput.addEventListener("keydown", (e) => {
    const open = searchSuggest.classList.contains("open");
    const items = searchSuggest.querySelectorAll(".ss-item");
    if (e.key === "Enter"){
      if (items[activeIdx]){
        const url = items[activeIdx].dataset.url;
        const text = items[activeIdx].dataset.text;
        if (url) openUrl(url);
        else if (text) doSearch(text);
      } else if (searchInput.value.trim()){
        doSearch(searchInput.value.trim());
      }
      saveSearchHistory(searchInput.value.trim());
      hideSuggest();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp"){
      if (!open && searchInput.value.trim()) renderSuggest();
      else if (open && items.length){
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((activeIdx + step + items.length) % items.length);
      }
    } else if (e.key === "Escape"){
      hideSuggest();
      searchInput.blur();
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (!searchWrap.contains(e.target)) hideSuggest();
  });

  /* ---------------- floating windows (calc / todo / calendar) ---------------- */
  const flyout = document.getElementById("flyout");
  const flyoutHeadEl = document.getElementById("flyoutHead");
  const flyoutTitle = document.getElementById("flyoutTitle");
  const flyoutBody = document.getElementById("flyoutBody");
  const flyoutClose = document.getElementById("flyoutClose");
  let flyoutDrag = null;
  let ocrPasteHandler = null;

  function clampFlyout(){
    if (!flyout.classList.contains("open")) return;
    const w = flyout.offsetWidth, h = flyout.offsetHeight;
    const left = Math.min(Math.max(8, parseFloat(flyout.style.left) || 8), Math.max(8, window.innerWidth - w - 8));
    const top  = Math.min(Math.max(8, parseFloat(flyout.style.top)  || 8), Math.max(8, window.innerHeight - h - 8));
    flyout.style.left = left + "px";
    flyout.style.top = top + "px";
  }
  window.addEventListener("resize", clampFlyout);

  function closeFlyout(){
    flyout.classList.remove("open");
    flyoutBody.innerHTML = "";
  }
  flyoutClose.addEventListener("click", closeFlyout);

  flyoutHeadEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".flyout-close")) return;
    flyoutDrag = { sx:e.clientX, sy:e.clientY, ox:parseFloat(flyout.style.left) || 0, oy:parseFloat(flyout.style.top) || 0 };
    flyoutHeadEl.setPointerCapture(e.pointerId);
  });
  flyoutHeadEl.addEventListener("pointermove", (e) => {
    if (!flyoutDrag) return;
    flyout.style.left = (flyoutDrag.ox + (e.clientX - flyoutDrag.sx)) + "px";
    flyout.style.top = (flyoutDrag.oy + (e.clientY - flyoutDrag.sy)) + "px";
  });
  function endFlyoutDrag(){ if (!flyoutDrag) return; flyoutDrag = null; clampFlyout(); }
  flyoutHeadEl.addEventListener("pointerup", endFlyoutDrag);
  flyoutHeadEl.addEventListener("pointercancel", endFlyoutDrag);

  document.addEventListener("pointerdown", (e) => {
    if (flyout.classList.contains("open") && !flyout.contains(e.target)
        && !e.target.closest(".widget-body") && !e.target.closest(".widget-gear")){
      closeFlyout();
    }
  });

  function activate(w){
    if (w.type === "shortcut"){
      if (w.data.url) openUrl(w.data.url);
      return;
    }
    if (w.type === "calculator"){ flyoutTitle.textContent = "Calculator"; buildCalculator(); }
    else if (w.type === "todo"){ flyoutTitle.textContent = "To-do"; buildTodo(w); }
    else if (w.type === "calendar"){ flyoutTitle.textContent = "Calendar"; buildCalendar(w); }
    else if (w.type === "ocr"){ flyoutTitle.textContent = "OCR"; buildOCR(w); }
    else return;

    flyout.classList.add("open");
    const el = canvas.querySelector('[data-id="' + w.id + '"]');
    const r = el ? el.getBoundingClientRect() : { left:window.innerWidth/2, top:window.innerHeight/2, width:0, height:0 };
    flyout.style.left = (r.left + r.width/2 - flyout.offsetWidth/2) + "px";
    flyout.style.top = (r.top + r.height + 10) + "px";
    clampFlyout();
  }

  function buildCalculator(){
    flyoutBody.innerHTML = `
      <div class="calc-display" id="calcDisp">0</div>
      <div class="calc-grid" id="calcGrid"></div>`;
    const disp = flyoutBody.querySelector("#calcDisp");
    const grid = flyoutBody.querySelector("#calcGrid");
    let expr = "";
    const keys = ["C","(",")","÷","7","8","9","×","4","5","6","−","1","2","3","+","0",".","⌫","="];
    keys.forEach(k => {
      const b = document.createElement("button");
      b.className = "calc-btn" + (["÷","×","−","+","="].includes(k) ? " op" : "") + (k === "0" ? "" : "");
      b.textContent = k;
      b.addEventListener("click", () => {
        if (k === "C"){ expr = ""; }
        else if (k === "⌫"){ expr = expr.slice(0,-1); }
        else if (k === "="){
          try{
            const safe = expr.replace(/×/g,"*").replace(/÷/g,"/").replace(/−/g,"-");
            if (!/^[0-9+\-*/().\s]+$/.test(safe)) throw new Error("bad");
            const result = Function('"use strict";return (' + safe + ")")();
            expr = String(Math.round(result * 1e10) / 1e10);
          }catch(e){ expr = "Error"; }
        } else {
          expr += k;
        }
        disp.textContent = expr || "0";
      });
      grid.appendChild(b);
    });
  }

  function buildTodo(w){
    flyoutBody.innerHTML = `
      <div class="todo-add">
        <input type="text" id="todoInput" placeholder="Add a task…">
        <button id="todoAddBtn">Add</button>
      </div>
      <div id="todoList"></div>`;
    const list = flyoutBody.querySelector("#todoList");
    function draw(){
      list.innerHTML = "";
      if (!w.data.items.length){
        list.innerHTML = '<div class="todo-empty">Nothing here yet.</div>';
        return;
      }
      w.data.items.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "todo-item" + (item.done ? " done" : "");
        row.innerHTML = `<input type="checkbox" ${item.done ? "checked" : ""}><span></span><button>✕</button>`;
        row.querySelector("span").textContent = item.text;
        row.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
          item.done = e.target.checked; persist(); draw();
        });
        row.querySelector("button").addEventListener("click", () => {
          w.data.items.splice(i,1); persist(); draw();
        });
        list.appendChild(row);
      });
    }
    function add(){
      const inp = flyoutBody.querySelector("#todoInput");
      const val = inp.value.trim();
      if (!val) return;
      w.data.items.push({text:val, done:false});
      inp.value = "";
      persist(); draw();
    }
    flyoutBody.querySelector("#todoAddBtn").addEventListener("click", add);
    flyoutBody.querySelector("#todoInput").addEventListener("keydown", e => { if (e.key === "Enter") add(); });
    draw();
  }

  function buildCalendar(w){
    let view = new Date();
    flyoutBody.innerHTML = `
      <div class="cal-nav">
        <button id="calPrev">‹</button>
        <div class="cal-title" id="calTitle"></div>
        <button id="calNext">›</button>
      </div>
      <div class="cal-grid" id="calGrid"></div>
      <div class="cal-note-box" id="calNoteBox" style="display:none;">
        <span class="cal-note-label" id="calNoteLabel"></span>
        <textarea id="calNoteText" placeholder="Add a note for this day…"></textarea>
      </div>`;
    const grid = flyoutBody.querySelector("#calGrid");
    const title = flyoutBody.querySelector("#calTitle");
    const noteBox = flyoutBody.querySelector("#calNoteBox");
    const noteLabel = flyoutBody.querySelector("#calNoteLabel");
    const noteText = flyoutBody.querySelector("#calNoteText");
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const dows = ["S","M","T","W","T","F","S"];
    let selectedKey = null;

    function key(y,m,d){ return `${y}-${m+1}-${d}`; }

    function draw(){
      grid.innerHTML = "";
      const y = view.getFullYear(), m = view.getMonth();
      title.textContent = months[m] + " " + y;
      dows.forEach(d => {
        const el = document.createElement("div");
        el.className = "cal-dow"; el.textContent = d;
        grid.appendChild(el);
      });
      const first = new Date(y,m,1);
      const startDow = first.getDay();
      const daysInMonth = new Date(y,m+1,0).getDate();
      const daysInPrev = new Date(y,m,0).getDate();
      const today = new Date();
      const cells = [];
      for (let i=startDow-1;i>=0;i--) cells.push({d:daysInPrev-i, other:true, m:m-1});
      for (let d=1; d<=daysInMonth; d++) cells.push({d, other:false, m});
      while (cells.length % 7 !== 0) cells.push({d:cells.length, other:true, m:m+1});
      cells.forEach(c => {
        const el = document.createElement("div");
        el.className = "cal-day" + (c.other ? " other" : "");
        const isToday = !c.other && today.getFullYear()===y && today.getMonth()===m && today.getDate()===c.d;
        if (isToday) el.classList.add("today");
        const k = key(y,m,c.d);
        if (!c.other && w.data.notes[k]) el.classList.add("has-note");
        el.textContent = c.d;
        if (!c.other){
          el.addEventListener("click", () => {
            selectedKey = k;
            noteBox.style.display = "block";
            noteLabel.textContent = months[m] + " " + c.d + ", " + y;
            noteText.value = w.data.notes[k] || "";
            noteText.focus();
          });
        }
        grid.appendChild(el);
      });
    }
    noteText.addEventListener("input", () => {
      if (!selectedKey) return;
      if (noteText.value.trim()) w.data.notes[selectedKey] = noteText.value;
      else delete w.data.notes[selectedKey];
      persist();
      draw();
    });
    flyoutBody.querySelector("#calPrev").addEventListener("click", () => { view.setMonth(view.getMonth()-1); draw(); });
    flyoutBody.querySelector("#calNext").addEventListener("click", () => { view.setMonth(view.getMonth()+1); draw(); });
    draw();
  }

  /* ---------------- OCR window ---------------- */
  function loadTesseract(){
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error("couldn't load the OCR engine"));
      document.head.appendChild(s);
    });
  }

  function buildOCR(w){
    flyoutBody.innerHTML = `
      <div class="ocr-drop" id="ocrDrop">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>
        <div class="ocr-drop-title">Drop an image here</div>
        <div class="ocr-drop-sub">pick a file, drag one in, or paste (Ctrl/Cmd+V)</div>
        <button class="btn primary" id="ocrPick">Choose image…</button>
      </div>
      <div class="ocr-preview" id="ocrPreview"></div>
      <div class="ocr-status" id="ocrStatus"></div>
      <div class="ocr-result" id="ocrResult" style="display:none">
        <div class="ocr-result-head"><span>Extracted text</span><button class="btn" id="ocrCopy">Copy</button></div>
        <textarea class="ocr-text" id="ocrText" readonly spellcheck="false"></textarea>
      </div>`;

    const drop  = flyoutBody.querySelector("#ocrDrop");
    const preview = flyoutBody.querySelector("#ocrPreview");
    const status  = flyoutBody.querySelector("#ocrStatus");
    const result  = flyoutBody.querySelector("#ocrResult");
    const text    = flyoutBody.querySelector("#ocrText");

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    flyoutBody.appendChild(fileInput);

    flyoutBody.querySelector("#ocrPick").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
      fileInput.value = "";
    });

    ["dragenter","dragover"].forEach(ev =>
      flyoutBody.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); drop.classList.add("drag"); })
    );
    ["dragleave","drop"].forEach(ev =>
      flyoutBody.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove("drag"); })
    );
    flyoutBody.addEventListener("drop", e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type.startsWith("image/")) handleFile(f);
    });

    if (ocrPasteHandler) document.removeEventListener("paste", ocrPasteHandler);
    ocrPasteHandler = function(e){
      if (!flyout.classList.contains("open") || flyoutTitle.textContent !== "OCR") return;
      const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
      if (f && f.type.startsWith("image/")){ e.preventDefault(); handleFile(f); }
    };
    document.addEventListener("paste", ocrPasteHandler);

    flyoutBody.querySelector("#ocrCopy").addEventListener("click", async () => {
      try{ await navigator.clipboard.writeText(text.value); }
      catch(err){ text.focus(); text.select(); }
    });

    async function handleFile(file){
      drop.style.display = "none";
      result.style.display = "none";
      preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="source">`;
      status.style.display = "block";
      status.innerHTML = `<div class="bar"><i></i></div><div class="msg">Starting OCR engine…</div>`;
      const bar = status.querySelector(".bar i");
      const msg = status.querySelector(".msg");
      try{
        const Tesseract = await loadTesseract();
        const worker = await Tesseract.createWorker(["eng"], 1, {
          logger: m => {
            if (m.status === "recognizing text"){
              const pct = Math.round((m.progress || 0) * 100);
              bar.style.width = pct + "%";
              msg.textContent = "Recognizing text — " + pct + "%";
            } else if (m.status){
              msg.textContent = m.status.replace(/^./, c => c.toUpperCase()) + "…";
            }
          }
        });
        const { data } = await worker.recognize(file);
        await worker.terminate();
        const out = (data.text || "").trim();
        status.style.display = "none";
        if (out){
          text.value = out;
          result.style.display = "flex";
        } else {
          preview.innerHTML = "";
          drop.style.display = "flex";
          status.style.display = "block";
          status.innerHTML = `<div class="msg">No text was recognized in that image.</div>`;
        }
      }catch(err){
        status.style.display = "block";
        status.innerHTML = `<div class="msg" style="color:var(--danger)">OCR failed — ${(err && err.message) || err}</div>`;
      }
    }
  }

  /* ---------------- type to search anywhere ---------------- */
  document.addEventListener("keydown", function(e){
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (editMode) return;
    if (document.querySelector(".overlay.open, .popover.open")) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
    if (!e.key || e.key.length !== 1 || e.key === " ") return;
    e.preventDefault();
    e.stopPropagation();
    searchInput.value = e.key;
    searchInput.focus();
    searchInput.setSelectionRange(1, 1);
    searchInput.dispatchEvent(new Event("input"));
  }, true);

  /* ---------------- init ---------------- */
  renderAll();
  persist();
  applyBackground();
})();
