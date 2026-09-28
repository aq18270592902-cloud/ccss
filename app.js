/* 竞足预测汇总 - 页面逻辑 */
(function () {
  /* 全局常量：比分常用选项、半全场选项映射（多处引用，必须在 autoConsensusMatch 之前定义） */
  const SC_COMMON = ["1:0", "2:0", "2:1", "3:0", "3:1", "3:2", "4:0", "4:1", "5:0",
    "0:0", "1:1", "2:2", "3:3",
    "0:1", "0:2", "1:2", "0:3", "1:3", "2:3", "0:4", "1:4"];
  const HF_OPTS = ["胜胜", "胜平", "胜负", "平胜", "平平", "平负", "负胜", "负平", "负负"];
  const HF_KEY = { "胜胜": "hh", "胜平": "hd", "胜负": "ha", "平胜": "dh", "平平": "dd", "平负": "da", "负胜": "ah", "负平": "ad", "负负": "aa" };

  const DATA = window.APP_DATA;
  const $ = (s) => document.querySelector(s);
  const LABEL = { wdl: "胜平负", tg: "总进球", hf: "半全场", sc: "比分" };

  const dates = Object.keys(DATA.days).sort().reverse();
  /* 默认选中今天：今天有数据就选今天，否则取最近日期 */
  const todayStr = new Date().toLocaleDateString("sv-CN"); /* YYYY-MM-DD */
  let curDate = dates.includes(todayStr) ? todayStr : (dates[0] || "");

  /* ---------- 用户态：登录后 currentUser 非 null 时，loadJSON 走 userDataCache；未登录走 localStorage 兜底 ---------- */
  let currentUser = null;
  /* 服务器 data 字段名 ↔ localStorage 键映射（迁移与回退用） */
  const LS_KEY_MAP = {
    myFinal: "ccss_my_final_v1",
    customModels: "ccss_custom_models_v1",
    preds: "ccss_preds_v1",
    renames: "ccss_model_renames_v1",
    order: "ccss_model_order_v1",
    bets: "ccss_bets_v1",
    notes: "ccss_notes_v1",
    tags: "ccss_match_tags_v1"
  };
  const DATA_KEYS = Object.keys(LS_KEY_MAP);
  const userDataCache = {}; /* serverKey -> value，登录后由 loadUserDataFromServer 填充 */
  /* 通过 localStorage 键反查 server 字段名（loadJSON 用） */
  const lsKeyToServer = (k) => {
    for (const sk of DATA_KEYS) if (LS_KEY_MAP[sk] === k) return sk;
    return null;
  };

  /* ---------- 我的预测：localStorage 持久化（点选结果优先于 data.js 默认值） ---------- */
  const LS_KEY = LS_KEY_MAP.myFinal;
  let savedFinals = null; /* myFinal 内存镜像，避免每次重读；登录后由 loadUserDataFromServer 同步 */
  function loadSavedFinals() {
    if (savedFinals) return savedFinals;
    if (currentUser) {
      const v = userDataCache.myFinal;
      savedFinals = (v && typeof v === "object") ? v : {};
    } else {
      try { savedFinals = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { savedFinals = {}; }
    }
    return savedFinals;
  }
  function applySavedFinals() {
    savedFinals = null; /* 强制下次 loadSavedFinals 重读（登录后从 userDataCache 取） */
    const saved = loadSavedFinals();
    Object.entries(saved).forEach(([d, mm]) => {
      const day = DATA.days[d]; if (!day) return;
      Object.entries(mm).forEach(([id, patch]) => {
        const m = day.matches.find((x) => x.id === id); if (!m) return;
        m.final = Object.assign({}, m.final, patch);
      });
    });
  }
  /* persistUser：写 userDataCache + POST /api/data；未登录走 localStorage 兜底 */
  function persistUser(key, value) {
    userDataCache[key] = value;
    if (key === "myFinal") savedFinals = value; /* 同步镜像 */
    if (currentUser) {
      fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value })
      }).catch(() => {});
    } else {
      const lk = LS_KEY_MAP[key];
      if (lk) { try { localStorage.setItem(lk, JSON.stringify(value)); } catch (e) {} }
    }
  }
  function saveFinalPick(date, id, k, val) {
    const saved = loadSavedFinals();
    saved[date] = saved[date] || {};
    saved[date][id] = saved[date][id] || {};
    saved[date][id][k] = val === undefined ? "" : val;
    persistUser("myFinal", saved);
  }
  /* applySavedFinals() 调用延后到 runAppInit() —— 确保 currentUser 与 userDataCache 已就绪后再回填 DATA */

  /* ---------- 自定义模型 / 手工录入预测：localStorage 持久化 ----------
   * LS_MODELS：全局自定义模型名（一次添加，所有日期通用）
   * LS_PREDS：{ 日期: { 比赛编号: { 模型名: {wdl,tg,hf,sc} } } }
   * 手工录入会覆盖同名模型在 data.js 中的值（可用于修正识别结果） */
  const LS_MODELS = LS_KEY_MAP.customModels;
  const LS_PREDS = LS_KEY_MAP.preds;
  const LS_RENAMES = LS_KEY_MAP.renames; /* 内置模型改名映射 {原名: 新名}，页面加载时应用 */
  const LS_ORDER = LS_KEY_MAP.order;    /* 模型列从左到右的显示顺序 */
  /* loadJSON：登录后从 userDataCache 取；未登录走 localStorage */
  const loadJSON = (k, def) => {
    if (currentUser) {
      const sk = lsKeyToServer(k);
      if (sk && Object.prototype.hasOwnProperty.call(userDataCache, sk)) return userDataCache[sk];
      return def;
    }
    try { return JSON.parse(localStorage.getItem(k)) || def; } catch (e) { return def; }
  };
  /* 兼容旧 saveJSON 调用：能反查到 server key 就走 persistUser，否则直接写 localStorage */
  const saveJSON = (k, v) => {
    const sk = lsKeyToServer(k);
    if (sk) persistUser(sk, v);
    else { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  let customModels = []; /* 实际加载延后到 runAppInit，确保 currentUser 已就绪 */
  let modelOrder = [];
  /* 内置（data.js）模型改名：把 preds 里的旧名键换成新名（新名已有数据时以新名为准） */
  function applyRenames() {
    const renames = loadJSON(LS_RENAMES, {});
    Object.values(DATA.days).forEach((day) => (day.matches || []).forEach((m) => {
      if (!m.preds) return;
      Object.entries(renames).forEach(([o, n]) => {
        if (m.preds[o]) { if (!m.preds[n]) m.preds[n] = m.preds[o]; delete m.preds[o]; }
      });
    }));
  }
  function applySavedPreds() {
    const saved = loadJSON(LS_PREDS, {});
    Object.entries(saved).forEach(([d, mm]) => {
      const day = DATA.days[d]; if (!day) return;
      Object.entries(mm).forEach(([id, pp]) => {
        const m = day.matches.find((x) => x.id === id); if (!m) return;
        m.preds = m.preds || {};
        Object.entries(pp).forEach(([name, p]) => { m.preds[name] = Object.assign({}, p); });
      });
    });
  }
  function savePredPick(date, id, name, p) {
    const saved = loadJSON(LS_PREDS, {});
    saved[date] = saved[date] || {};
    saved[date][id] = saved[date][id] || {};
    saved[date][id][name] = p;
    saveJSON(LS_PREDS, saved);
  }
  function dropModelAll(name) {
    customModels = customModels.filter((x) => x !== name);
    saveJSON(LS_MODELS, customModels);
    modelOrder = modelOrder.filter((x) => x !== name);
    saveJSON(LS_ORDER, modelOrder);
    const saved = loadJSON(LS_PREDS, {});
    Object.keys(saved).forEach((d) => Object.keys(saved[d] || {}).forEach((id) => {
      if (saved[d][id][name]) {
        delete saved[d][id][name];
        const m = DATA.days[d] && DATA.days[d].matches.find((x) => x.id === id);
        if (m && m.preds) delete m.preds[name];
      }
    }));
    saveJSON(LS_PREDS, saved);
  }
  /* 修改模型名：自定义模型直接改；内置模型记入改名映射（刷新后仍生效）。
   * 同时迁移本机已录入的预测键名，历史数据不丢。 */
  function renameModel(oldName, newName) {
    const oi = modelOrder.indexOf(oldName);
    if (oi > -1) { modelOrder[oi] = newName; saveJSON(LS_ORDER, modelOrder); }
    const ci = customModels.indexOf(oldName);
    if (ci > -1) {
      customModels[ci] = newName;
      saveJSON(LS_MODELS, customModels);
    } else {
      const renames = loadJSON(LS_RENAMES, {});
      let orig = null;
      Object.keys(renames).forEach((k) => { if (renames[k] === oldName) orig = k; }); /* 二次改名时更新原映射 */
      renames[orig || oldName] = newName;
      saveJSON(LS_RENAMES, renames);
    }
    const saved = loadJSON(LS_PREDS, {});
    Object.values(saved).forEach((mm) => Object.values(mm || {}).forEach((pp) => {
      if (pp[oldName]) { pp[newName] = pp[oldName]; delete pp[oldName]; }
    }));
    saveJSON(LS_PREDS, saved);
    Object.values(DATA.days).forEach((day) => (day.matches || []).forEach((m) => {
      if (m.preds && m.preds[oldName]) { m.preds[newName] = m.preds[oldName]; delete m.preds[oldName]; }
    }));
  }
  function allModelNames() {
    const set = new Set(customModels);
    Object.values(DATA.days).forEach((day) => (day.matches || []).forEach((m) =>
      Object.keys(m.preds || {}).forEach((s) => set.add(s))));
    return [...set];
  }
  /* 一次性清理已停用的「图2扫盘」模型（data.js 与本机缓存都删） */
  function purgeOldModel() {
    const OLD_LIST = ["图2扫盘", "测试模型X", "测试模型Y"];
    let changed = false;
    OLD_LIST.forEach((OLD) => {
      if (customModels.includes(OLD)) { customModels = customModels.filter((x) => x !== OLD); changed = true; }
      const saved = loadJSON(LS_PREDS, {});
      Object.values(saved).forEach((mm) => Object.values(mm || {}).forEach((pp) => { if (pp[OLD]) { delete pp[OLD]; changed = true; } }));
      if (changed) persistUser("preds", saved);
      Object.values(DATA.days).forEach((day) => (day.matches || []).forEach((m) => { if (m.preds && m.preds[OLD]) delete m.preds[OLD]; }));
    });
    if (changed) persistUser("customModels", customModels);
    const orderBefore = modelOrder.length;
    modelOrder = modelOrder.filter((n) => !OLD_LIST.includes(n));
    if (modelOrder.length !== orderBefore) persistUser("order", modelOrder);
  }
  /* applySavedPreds / purgeOldModel 调用延后到 runAppInit() —— 确保 currentUser 与 userDataCache 已就绪 */

  /* ---------- 初始化（日期选择器填充 / 页签监听；运行时 currentUser 已由 bootApp 设置） ---------- */
  const sel = $("#dateSel");
  dates.forEach((d) => {
    const o = document.createElement("option");
    o.value = d; o.textContent = d;
    sel.appendChild(o);
  });
  sel.value = curDate;
  sel.addEventListener("change", () => { curDate = sel.value; renderAll(); });

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
    });
  });

  /* ---------- 工具函数 ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parseScore = (s) => { const m = String(s || "").match(/(\d+)\s*[:：]\s*(\d+)/); return m ? [+m[1], +m[2]] : null; };
  const parseHandi = (wdl) => { const m = String(wdl || "").match(/([+-]\d+)/); return m ? +m[1] : 0; };
  const coreWdl = (wdl) => String(wdl || "").replace(/[+-]\d+\s*/g, "").trim();

  const isBlank = (v) => v == null || v === "" || v === "待分析" || v === "—";
  const hasRang = (pred) => /让/.test(String(pred || "")); /* 预测含“让”字=让球胜平负玩法 */
  /* 让球数：以该场官方盘口 rq 为准（让1/让2/让3或受让各不相同），预测串里的数字仅作展示 */
  const offHandi = (m) => (+(m && m.rq)) || 0;
  /* 返回 null=不可评估（占位预测）；true/false=命中/未中。handi=官方让球数 */
  function evalWdl(pred, result, handi) {
    const sc = parseScore(result && result.score); if (!sc || isBlank(pred)) return null;
    const h = hasRang(pred) ? ((handi == null) ? parseHandi(pred) : handi) : 0;
    const adj = sc[0] + h;
    const raw = adj > sc[1] ? "胜" : adj === sc[1] ? "平" : "负";
    return coreWdl(pred).split("/").map((s) => s.trim()).filter(Boolean)
      .some((t) => t === (t.charAt(0) === "让" ? "让" + raw : raw));
  }
  function evalTg(pred, result) {
    const sc = parseScore(result && result.score); if (!sc || isBlank(pred)) return null;
    const nums = String(pred).match(/\d+/g) || [];
    const total = sc[0] + sc[1];
    return nums.includes(String(total)) || (total >= 7 && nums.includes("7")); /* 7 档=7球及以上 */
  }
  function evalHf(pred, result) {
    const f = parseScore(result && result.score), h = parseScore(result && result.half);
    if (!f || !h || isBlank(pred)) return null;
    const fc = f[0] > f[1] ? "胜" : f[0] === f[1] ? "平" : "负";
    const hc = h[0] > h[1] ? "胜" : h[0] === h[1] ? "平" : "负";
    return String(pred).split("/").map((s) => s.trim()).includes(hc + fc);
  }
  function evalSc(pred, result) {
    const sc = parseScore(result && result.score); if (!sc || isBlank(pred)) return null;
    return String(pred).split("/").map((s) => { const p = parseScore(s); return p ? p.join(":") : ""; }).includes(sc.join(":"));
  }
  /* 单个选项的命中判定（用于主表逐项画圈），返回 null=不可评估 */
  function evalItem(k, item, handi, result) {
    item = String(item || "").trim();
    if (isBlank(item) || !result || !parseScore(result.score)) return null;
    const sc = parseScore(result.score);
    if (k === "wdl") {
      const core = item.replace(/[+-]?\d+\s*/g, "").trim(); /* 剥掉"-1"等让球数前缀 */
      const h = core.charAt(0) === "让" ? handi : 0;        /* 让球玩法才加官方让球数 */
      const adj = sc[0] + h;
      const raw = adj > sc[1] ? "胜" : adj === sc[1] ? "平" : "负";
      return core === (core.charAt(0) === "让" ? "让" + raw : raw);
    }
    if (k === "tg") {
      const n = (item.match(/\d+/) || [])[0];
      if (n == null) return false;
      const total = sc[0] + sc[1];
      return +n === 7 ? total >= 7 : +n === total;
    }
    if (k === "hf") {
      const h = parseScore(result.half); if (!h) return null;
      const fc = sc[0] > sc[1] ? "胜" : sc[0] === sc[1] ? "平" : "负";
      const hc = h[0] > h[1] ? "胜" : h[0] === h[1] ? "平" : "负";
      return item === hc + fc;
    }
    const p = parseScore(item);
    return p ? p.join(":") === sc.join(":") : false;
  }
  /* 主表玩法单元格：未开奖=原样(带★)；已开奖=命中的选项画绿圈，未中灰淡；不可评估=原样 */
  function playCell(k, full, m, starHtml) {
    const raw = String(full == null ? "" : full).trim();
    if (!raw) return '<span class="miss-dim">—</span>';
    const safe = (m.final.safe || []).includes(k) ? ' <span class="safe-star" title="稳健">★</span>' : '';
    const items = raw.split("/").map((s) => s.trim()).filter((s) => s.length);
    if (!m.result) return esc(raw) + safe + (starHtml || "");
    /* 让球数统一以官方盘口 rq 为准（让1/让2/让3、受让都可能），由 evalItem 按是否“让”项决定使用 */
    const handi = offHandi(m);
    const judged = items.map((it) => ({ it, ok: evalItem(k, it, handi, m.result) }));
    if (judged.some((x) => x.ok === null)) return esc(raw) + safe;
    return judged.map((x) => x.ok
      ? `<span class="hit-ring">${esc(x.it)}</span>`
      : `<span class="miss-dim">${esc(x.it)}</span>`).join('<span class="opt-sep">/</span>') + safe;
  }
  function consensus(vals) {
    const v = (vals || []).map((x) => String(x || "").replace(/\s+/g, "")).filter(Boolean);
    if (!v.length) return { value: "", count: 0, total: 0 };
    const freq = {};
    v.forEach((x) => { freq[x] = (freq[x] || 0) + 1; });
    let best = "", bc = 0;
    Object.keys(freq).forEach((k) => { if (freq[k] > bc) { bc = freq[k]; best = k; } });
    return { value: best, count: bc, total: v.length };
  }
  const star = (c) => (c.total >= 2 && c.count === c.total ? ' <span class="star">★</span>' : "");
  const wdlClass = (v) => /胜/.test(v) ? "wdl-win" : /平/.test(v) ? "wdl-draw" : /负/.test(v) ? "wdl-loss" : "";

  /* ---------- 自定义弹窗（替代原生 alert/confirm/prompt）+ 轻提示 ---------- */
  function uiModal(opt) {
    return new Promise((resolve) => {
      const hasInput = Object.prototype.hasOwnProperty.call(opt, "input");
      const multiline = opt.multiline === true;
      const maxLen = opt.maxLength || (multiline ? 200 : 30);
      const mask = document.createElement("div");
      mask.className = "ui-mask";
      const inputHtml = hasInput
        ? (multiline
            ? `<textarea class="ui-input" rows="3" maxlength="${maxLen}" placeholder="${esc(opt.placeholder || "")}">${esc(opt.input || "")}</textarea>`
            : `<input class="ui-input" value="${esc(opt.input || "")}" placeholder="${esc(opt.placeholder || "")}" maxlength="${maxLen}">`)
        : "";
      mask.innerHTML =
        `<div class="ui-dlg">` +
        (opt.title ? `<div class="ui-title">${esc(opt.title)}</div>` : "") +
        `<div class="ui-msg">${esc(opt.msg || "")}</div>` +
        inputHtml +
        `<div class="ui-btns">` +
        (opt.hideCancel ? "" : `<button type="button" class="ui-btn" data-x="0">取消</button>`) +
        `<button type="button" class="ui-btn ${opt.danger ? "danger" : "primary"}" data-x="1">${esc(opt.okText || "确定")}</button>` +
        `</div></div>`;
      document.body.appendChild(mask);
      const inp = mask.querySelector(".ui-input");
      const done = (v) => { document.removeEventListener("keydown", onKey); mask.remove(); resolve(v); };
      const onKey = (e) => {
        if (e.key === "Escape") done(hasInput ? null : false);
        else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
          done(hasInput ? (inp.value || "").trim() : true);
        }
      };
      document.addEventListener("keydown", onKey);
      mask.addEventListener("click", (e) => { if (e.target === mask) done(hasInput ? null : false); });
      mask.querySelectorAll(".ui-btn").forEach((b) => b.addEventListener("click", () => {
        done(b.dataset.x === "1" ? (hasInput ? (inp.value || "").trim() : true) : (hasInput ? null : false));
      }));
      if (inp) { inp.focus(); inp.select(); }
    });
  }
  const uiAlert = (msg, title) => uiModal({ msg, title, hideCancel: true });
  const uiConfirm = (msg, o) => uiModal(Object.assign({ msg }, o || {}));
  const uiPrompt = (msg, def, title, opts) => uiModal(Object.assign({ msg, title, input: def || "" }, opts || {}));
  /* 模型编辑菜单：改名 / 删除 二选一 */
  function modelEditMenu(name) {
    return new Promise((resolve) => {
      const mask = document.createElement("div");
      mask.className = "ui-mask";
      mask.innerHTML = `<div class="ui-dlg"><div class="ui-title">编辑模型</div>` +
        `<div class="ui-msg">模型名称：<b>${esc(name)}</b></div>` +
        `<div class="ui-btns"><button type="button" class="ui-btn" data-x="cancel">取消</button>` +
        `<button type="button" class="ui-btn danger" data-x="del">删除</button>` +
        `<button type="button" class="ui-btn primary" data-x="ren">改名</button></div></div>`;
      document.body.appendChild(mask);
      const done = (v) => { document.removeEventListener("keydown", onKey); mask.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") done(null); };
      document.addEventListener("keydown", onKey);
      mask.addEventListener("click", (e) => {
        if (e.target === mask) done(null);
        const b = e.target.closest(".ui-btn");
        if (b) done(b.dataset.x === "ren" ? "ren" : b.dataset.x === "del" ? "del" : null);
      });
    });
  }
  let toastTimer = null;
  function uiToast(msg, type) {
    let t = document.querySelector(".ui-toast");
    if (!t) { t = document.createElement("div"); t.className = "ui-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "ui-toast" + (type ? " " + type : "");
    /* 强制重排再加 show 类，确保动画重新触发 */
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(toastTimer);
    /* error/success 提示稍长，确保用户看清 */
    toastTimer = setTimeout(() => t.classList.remove("show"), type ? 3200 : 2200);
  }

  /* ---------- 比赛备注：localStorage 持久化 ----------
   * 双击主客队单元格即可编辑备注（伤停/临场变化/关键观察等）；
   * 备注以小字灰显在主客队名下方，每日汇总 / 模型对比均可见。
   * 编辑入口故意低调——无图标无按钮，靠双击触发，自己知道即可。 */
  const LS_NOTES = LS_KEY_MAP.notes;
  let matchNotes = {}; /* 实际加载延后到 runAppInit，确保 currentUser 已就绪 */
  const saveNotes = () => persistUser("notes", matchNotes);
  const noteKeyOf = (date, id) => date + "|" + id;
  function getMatchNote(date, id) { return matchNotes[noteKeyOf(date, id)] || ""; }
  function setMatchNote(date, id, text) {
    const k = noteKeyOf(date, id);
    text = (text || "").trim();
    if (text) matchNotes[k] = text; else delete matchNotes[k];
    saveNotes();
  }
  /* 比赛标签：localStorage 持久化，按日期+比赛编号存关键词数组。
   * 预设关键词（爆冷/假赛/冷门 等）+ 用户自定义词，徽章式展示在主客队名下方。 */
  const LS_TAGS = LS_KEY_MAP.tags;
  let matchTags = {};
  const saveTags = () => persistUser("tags", matchTags);
  function getMatchTags(date, id) { return matchTags[noteKeyOf(date, id)] || []; }
  function setMatchTags(date, id, tags) {
    const k = noteKeyOf(date, id);
    if (tags && tags.length) matchTags[k] = tags.slice(); else delete matchTags[k];
    saveTags();
  }
  /* 预设关键词 + 颜色映射：意外=橙 / 警示=红 / 积极=绿 / 强调=蓝 / 中性=灰 */
  const TAG_PRESETS = ["爆冷", "假赛", "冷门", "翻盘", "重磅", "大比分", "实力悬殊", "伤停", "红牌", "德比"];
  const TAG_COLOR = {
    "爆冷": "amber", "冷门": "amber",
    "假赛": "red",
    "翻盘": "green",
    "重磅": "blue", "大比分": "blue", "德比": "blue",
    "实力悬殊": "slate", "伤停": "slate", "红牌": "slate"
  };
  const tagColorCls = (t) => TAG_COLOR[t] || "slate";

  /* 比赛元信息编辑器：备注（多行）+ 标签（预设切换+自定义添加）。
   * 双击主客队单元格触发，自定义弹窗替代 uiPrompt——同时管理备注和标签。 */
  function editMatchMeta(date, m) {
    const curNote = getMatchNote(date, m.id);
    let curTags = getMatchTags(date, m.id).slice();
    return new Promise((resolve) => {
      const mask = document.createElement("div");
      mask.className = "ui-mask";
      mask.innerHTML =
        `<div class="ui-dlg meta-dlg">` +
        `<div class="ui-title">比赛备注与标签</div>` +
        `<div class="ui-msg">${esc(m.id + "  " + m.home + " VS " + m.away)}</div>` +
        `<div class="meta-section"><div class="meta-lbl">备注</div>` +
        `<textarea class="ui-input meta-note" rows="3" maxlength="200" placeholder="如：伤停 / 临场变化 / 关键观察（Ctrl+Enter 提交）">${esc(curNote)}</textarea></div>` +
        `<div class="meta-section"><div class="meta-lbl">标签（点击切换，可多选）</div>` +
        `<div class="meta-tags"></div></div>` +
        `<div class="meta-section"><div class="meta-lbl">自定义标签</div>` +
        `<div class="meta-custom"><input class="ui-input meta-custom-input" placeholder="输入后回车添加（最长 8 字）" maxlength="8">` +
        `<button type="button" class="meta-add-btn bar-btn">添加</button></div></div>` +
        `<div class="ui-btns">` +
        `<button type="button" class="ui-btn" data-x="0">取消</button>` +
        `<button type="button" class="ui-btn primary" data-x="1">保存</button></div></div>`;
      document.body.appendChild(mask);
      const tagBox = mask.querySelector(".meta-tags");
      const customInput = mask.querySelector(".meta-custom-input");
      /* 渲染标签按钮：预设词 + 当前已加的自定义词，按选中状态高亮 */
      const renderTags = () => {
        tagBox.innerHTML = "";
        const allTags = [...new Set([...TAG_PRESETS, ...curTags])];
        allTags.forEach((t) => {
          const on = curTags.includes(t);
          const b = document.createElement("button");
          b.type = "button";
          b.className = "m-tag " + tagColorCls(t) + (on ? " on" : "");
          b.textContent = t;
          b.addEventListener("click", () => {
            const idx = curTags.indexOf(t);
            if (idx > -1) curTags.splice(idx, 1);
            else curTags.push(t);
            renderTags();
          });
          tagBox.appendChild(b);
        });
      };
      renderTags();
      const addCustom = () => {
        const v = (customInput.value || "").trim();
        if (!v) return;
        if (curTags.includes(v)) { customInput.value = ""; return; }
        curTags.push(v);
        customInput.value = "";
        renderTags();
      };
      mask.querySelector(".meta-add-btn").addEventListener("click", addCustom);
      customInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } });
      const noteInput = mask.querySelector(".meta-note");
      const done = (save) => {
        document.removeEventListener("keydown", onKey);
        mask.remove();
        if (save) {
          const noteText = (noteInput.value || "").trim();
          setMatchNote(date, m.id, noteText);
          setMatchTags(date, m.id, curTags);
          uiToast(noteText || curTags.length ? "备注与标签已保存" : "已清空");
          renderAll();
        }
        resolve(save);
      };
      const onKey = (e) => {
        if (e.key === "Escape") done(false);
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) done(true);
      };
      document.addEventListener("keydown", onKey);
      mask.addEventListener("click", (e) => { if (e.target === mask) done(false); });
      mask.querySelectorAll(".ui-btn").forEach((b) => b.addEventListener("click", () => done(b.dataset.x === "1")));
      noteInput.focus();
    });
  }

  /* ---------- 每日汇总 ---------- */
  function renderSummary() {
    const day = DATA.days[curDate];
    $("#boardDate").textContent = curDate;
    $("#boardCount").textContent = "比赛数" + day.matches.length;
    const tbody = $("#summaryTable tbody");
    tbody.innerHTML = "";
    day.matches.forEach((m, idx) => {
      const srcs = Object.keys(m.preds || {});
      const cons = {};
      ["wdl", "tg", "hf", "sc"].forEach((k) => { cons[k] = consensus(srcs.map((s) => m.preds[s][k])); });
      const tr = document.createElement("tr");
      tr.className = idx % 2 ? "band-b" : "band-a";
      if (m.result) tr.classList.add("settled");
      const wdlColor = m.result ? "" : wdlClass(m.final.wdl); /* 开奖后改为复盘视图：绿圈/灰字 */
      const scoreLine = m.result
        ? `<div class="score-under"><span class="full-score">${esc(m.result.score)}</span>` +
          (m.result.half ? `<span class="half-score">(${esc(m.result.half)})</span>` : "") + "</div>"
        : '<div class="score-under"><span class="res-pend">未开赛</span></div>';
      /* 官方胜平负赔率：显示在胜平负预测下方（对应位置），最低赔=热门，蓝色加粗 */
      let oddsLine = "";
      if (m.odds && m.odds.h != null) {
        const o = m.odds;
        const min = Math.min(+o.h, +o.d, +o.a);
        const f = (v) => (+v === min) ? `<b class="odds-fav">${esc(v)}</b>` : esc(v);
        oddsLine = `<div class="odds-line" title="官方胜平负赔率 胜/平/负">${f(o.h)}<i>/</i>${f(o.d)}<i>/</i>${f(o.a)}</div>`;
      }
      /* 比赛备注：小字灰显在主客队名下方，双击单元格可编辑（编辑入口故意低调） */
      const noteTxt = getMatchNote(curDate, m.id);
      const noteLine = noteTxt ? `<div class="row-note" title="双击队伍单元格可编辑备注">${esc(noteTxt)}</div>` : "";
      /* 比赛标签：彩色徽章式关键词（爆冷/假赛等），双击单元格可在弹窗里管理 */
      const tags = getMatchTags(curDate, m.id);
      const tagLine = tags.length
        ? `<div class="row-tags" title="双击队伍单元格可编辑标签">${tags.map((t) => `<span class="m-tag ${tagColorCls(t)}">${esc(t)}</span>`).join("")}</div>`
        : "";
      tr.innerHTML =
        `<td><span class="exp-ico">▾</span> ${esc(m.id)}</td><td>${esc(m.time)}</td><td>${esc(m.league)}</td>` +
        `<td class="home-away">${esc(m.home)} <span class="vs">VS</span> ${esc(m.away)}${scoreLine}${noteLine}${tagLine}</td>` +
        `<td class="${wdlColor}">${playCell("wdl", m.final.wdl, m, star(cons.wdl))}${oddsLine}</td>` +
        `<td>${playCell("tg", m.final.tg, m, star(cons.tg))}</td>` +
        `<td>${playCell("hf", m.final.hf, m, star(cons.hf))}</td>` +
        `<td class="score-line">${playCell("sc", m.final.sc, m, star(cons.sc))}</td>`;
      tr.addEventListener("click", () => toggleDetail(tr, m));
      /* 双击主客队单元格 → 编辑备注（行单击展开详情会在双击的两下单击里先开再关，
         dblclick 在 click 之后触发，所以最终行处于关闭状态，刚好交给编辑器） */
      tr.querySelector("td.home-away").addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        editMatchMeta(curDate, m);
      });
      tbody.appendChild(tr);
    });
  }

  function toggleDetail(tr, m) {
    const next = tr.nextElementSibling;
    const wasOpen = next && next.classList.contains("detail-row");
    document.querySelectorAll("tr.detail-row").forEach((r) => r.remove());
    document.querySelectorAll("tr.detail-open").forEach((r) => r.classList.remove("detail-open"));
    if (wasOpen) return;
    tr.classList.add("detail-open");
    const dr = document.createElement("tr");
    dr.className = "detail-row";
    const td = document.createElement("td");
    td.colSpan = 8;
    td.innerHTML = detailHTML(m);
    dr.appendChild(td);
    tr.after(dr);
  }

  function detailHTML(m) {
    const srcs = Object.keys(m.preds || {});
    const hitCell = (ok) => ok === null ? "" : ok ? " cell-hit" : " cell-miss";
    let html = '<div class="detail-wrap">';

    /* ── 卡片：我的预测（2×2 网格，稳健项琥珀色+★） ── */
    const SAFE_LBL = { wdl: "胜平负", tg: "总进球", hf: "半全场", sc: "比分" };
    const safeSet = new Set(m.final.safe || []);
    html += '<div class="d-card"><h4>我的预测</h4><div class="mine-grid">';
    ["wdl", "tg", "hf", "sc"].forEach((k) => {
      html += `<div class="mine-item${safeSet.has(k) ? " is-safe" : ""}">`
        + `<span class="mine-k">${SAFE_LBL[k]}</span>`
        + `<span class="mine-v">${esc(m.final[k]) || "—"}</span>`
        + (safeSet.has(k) ? '<span class="mine-star">★</span>' : "")
        + "</div>";
    });
    html += "</div>";
    const rq = +m.rq || 0;
    const rqTxt = rq < 0 ? String(rq) : rq > 0 ? "+" + rq : "0";
    html += `<p class="d-foot">盘口：${esc(rqTxt)}${m.final.note ? "　·　" + esc(m.final.note) : ""}</p></div>`;

    /* ── 卡片：开奖结果（比分大字 + 玩法命中徽章） ── */
    html += '<div class="d-card"><h4>开奖结果</h4>';
    if (m.result) {
      const f = m.final || {};
      const items = [
        ["胜平负", evalWdl(f.wdl, m.result, offHandi(m))], ["总进球", evalTg(f.tg, m.result)],
        ["半全场", evalHf(f.hf, m.result)], ["比分", evalSc(f.sc, m.result)]
      ];
      html += `<div class="res-score">${esc(m.result.score)}${m.result.half ? `<span>半场 ${esc(m.result.half)}</span>` : ""}</div>`;
      html += "<div class=\"res-tags\">" + items.map(([n, ok]) => {
        const cls = ok === null ? "na" : ok ? "hit" : "miss";
        const txt = ok === null ? "暂无" : ok ? "命中" : "未中";
        return `<span class="rtag ${cls}">${n} ${txt}</span>`;
      }).join("") + "</div>";
    } else {
      html += '<p class="res-pend">未开赛，完场后自动更新命中情况</p>';
    }
    html += "</div>";

    /* ── 卡片：共识度（行式：玩法 / 主流意见 / 票数） ── */
    html += '<div class="d-card"><h4>共识度</h4>';
    ["wdl", "tg", "hf", "sc"].forEach((k) => {
      const c = consensus(srcs.map((s) => m.preds[s][k]));
      html += `<div class="cons-row"><span class="cons-k">${LABEL[k]}</span><span class="cons-v">${esc(c.value) || "—"}</span><span class="cons-n">${c.count}/${c.total} 票</span></div>`;
    });
    html += "</div>";

    /* ── 整行卡：各模型预测（已完场时单元格按命中上色） ── */
    html += '<div class="d-card d-wide"><h4>各模型预测</h4>';
    if (srcs.length) {
      html += '<div class="d-table-wrap"><table><colgroup><col class="dc-src"><col><col><col><col></colgroup><tr><th>来源</th><th>胜平负</th><th>总进球</th><th>半全场</th><th>比分</th></tr>';
      srcs.forEach((s) => {
        const p = m.preds[s];
        const r = m.result;
        html += `<tr><td class="dc-src-td">${esc(s)}</td>` +
          `<td class="${wdlClass(p.wdl)}${r ? hitCell(evalWdl(p.wdl, r, offHandi(m))) : ""}">${esc(p.wdl)}</td>` +
          `<td class="${r ? hitCell(evalTg(p.tg, r)).trim() : ""}">${esc(p.tg)}</td>` +
          `<td class="${r ? hitCell(evalHf(p.hf, r)).trim() : ""}">${esc(p.hf)}</td>` +
          `<td class="${r ? hitCell(evalSc(p.sc, r)).trim() : ""}">${esc(p.sc)}</td></tr>`;
      });
      html += "</table></div>";
      if (m.result) html += '<p class="d-foot">绿底=该玩法命中，红底=未中，无色=无半场比分暂不评估半全场。</p>';
    } else {
      html += '<p class="res-pend">暂无模型预测数据。</p>';
    }
    html += "</div>";

    /* ── 整行卡：官方赔率（玩法名 + 选项胶囊，最低赔蓝标） ── */
    html += oddsBlockHTML(m);
    html += "</div>";
    return html;
  }

  /* 官方赔率区块：每行 = 玩法名 + 选项胶囊（选项名上、赔率下），最低赔蓝色高亮 */
  function oddsBlockHTML(m) {
    const o = m.odds;
    if (!o) return '<div class="d-card d-wide"><h4>官方赔率</h4><p class="res-pend">暂无赔率数据</p></div>';
    const hotIdx = (arr) => { /* 最低赔索引（热门） */
      let k = -1, v = Infinity;
      arr.forEach((x, i) => { const n = +x; if (n > 0 && n < v) { v = n; k = i; } });
      return k;
    };
    const chip = (name, val, fav) =>
      `<span class="ochip${fav ? " fav" : ""}"><i>${esc(name)}</i><b>${esc(val)}</b></span>`;
    const row = (name, chips) =>
      `<div class="obl"><span class="obl-name">${name}</span><span class="obl-chips">${chips}</span></div>`;
    let body = "";
    /* 胜平负 / 让球胜平负 */
    if (o.h != null) {
      const arr = [o.h, o.d, o.a], hi = hotIdx(arr);
      body += row("胜平负", ["胜", "平", "负"].map((n, i) => chip(n, arr[i], i === hi)).join(""));
    }
    if (o.rq && o.rq.h != null) {
      const arr = [o.rq.h, o.rq.d, o.rq.a], hi = hotIdx(arr);
      const ln = +o.rq.line || 0;
      const lnTxt = "让球胜平负（" + (ln < 0 ? String(ln) : ln > 0 ? "+" + ln : "0") + "）";
      body += row(lnTxt, ["胜", "平", "负"].map((n, i) => chip(n, arr[i], i === hi)).join(""));
    }
    /* 上下单双（部分场次开售） */
    if (o.sxds) {
      const arr = [o.sxds.sd, o.sxds.ss, o.sxds.xd, o.sxds.xs];
      if (arr.every((x) => x != null)) {
        const hi = hotIdx(arr);
        body += row("上下单双", ["上单", "上双", "下单", "下双"].map((n, i) => chip(n, arr[i], i === hi)).join(""));
      }
    }
    /* 总进球 0-7 */
    if (o.tg) {
      const keys = ["0", "1", "2", "3", "4", "5", "6", "7"].filter((k) => o.tg[k] != null);
      if (keys.length) {
        const hi = hotIdx(keys.map((k) => o.tg[k]));
        body += row("总进球", keys.map((k, i) => chip(k === "7" ? "7+" : k + "球", o.tg[k], i === hi)).join(""));
      }
    }
    /* 半全场 9 项（前字=半场，后字=全场） */
    if (o.hf) {
      const keys = ["hh", "hd", "ha", "dh", "dd", "da", "ah", "ad", "aa"].filter((k) => o.hf[k] != null);
      const names = { hh: "胜胜", hd: "胜平", ha: "胜负", dh: "平胜", dd: "平平", da: "平负", ah: "负胜", ad: "负平", aa: "负负" };
      if (keys.length) {
        const hi = hotIdx(keys.map((k) => o.hf[k]));
        body += row("半全场", keys.map((k, i) => chip(names[k], o.hf[k], i === hi)).join(""));
      }
    }
    /* 比分（全部官方选项） */
    if (o.sc && Object.keys(o.sc).length) {
      const entries = Object.entries(o.sc);
      const hotV = Math.min(...entries.map(([, v]) => +v));
      body += row("比分", entries.map(([k, v]) => chip(k, v, +v === hotV)).join(""));
    }
    let html = '<div class="d-card d-wide"><h4>官方赔率</h4>' + body;
    if (o.upd) html += `<p class="d-foot">赔率更新：${esc(o.upd)}（数据随官方每2小时自动刷新）</p>`;
    html += "</div>";
    return html;
  }

  /* ---------- 模型对比 ---------- */
  const inputMode = true; /* 始终可编辑：双击单元格录入，投注列始终显示 */

  function compareSrcs(day) {
    /* 当天出现过的模型 + 全局自定义模型（即使当天无数据也显示空列，便于录入） */
    const set = new Set(customModels);
    day.matches.forEach((m) => Object.keys(m.preds || {}).forEach((s) => set.add(s)));
    /* 按已保存的列顺序从左到右排列；没排过的新模型追加在最后 */
    const ordered = modelOrder.filter((n) => set.has(n));
    const rest = [...set].filter((n) => !modelOrder.includes(n));
    return ordered.concat(rest);
  }
  /* 左右移动模型列：dir=-1 左移，1 右移；srcs=当天当前列顺序 */
  function moveModel(name, dir, srcs) {
    const i = srcs.indexOf(name), j = i + dir;
    if (i < 0 || j < 0 || j >= srcs.length) return;
    const next = srcs.slice();
    const tmp = next[i]; next[i] = next[j]; next[j] = tmp;
    /* 合并全局顺序：当天可见列按新顺序，其余日期独有的列保持原次序追加在后 */
    modelOrder = next.concat(modelOrder.filter((n) => !next.includes(n)));
    saveJSON(LS_ORDER, modelOrder);
  }

  /* 列宽控制：比赛/玩法/我的预测列固定宽，模型列均分剩余空间；
   * 模型较多时保证每列最小宽度（表格横滑），避免列被挤变形 */
  let curSrcs = [];
  function syncCompareWidth() {
    const mobile = window.matchMedia("(max-width:720px)").matches;
    const per = mobile ? 84 : 96, base = mobile ? 700 : 560;
    $("#compareTable").style.minWidth = Math.max(base, 324 + curSrcs.length * per) + "px";
  }
  window.addEventListener("resize", syncCompareWidth);

  function renderCompare() {
    const day = DATA.days[curDate];
    const srcs = compareSrcs(day);
    curSrcs = srcs;
    /* colgroup 与表头同步重建：模型列不设宽度即自动均分 */
    $("#compareTable colgroup").innerHTML =
      '<col class="c-match"><col class="c-play">'
      + srcs.map(() => '<col class="c-model">').join("")
      + '<col class="c-mine">';
    syncCompareWidth();
    $("#compareTable thead").innerHTML =
      "<tr><th>比赛</th><th>玩法</th>" + srcs.map((s, si) => {
        const mv = inputMode
          ? (si > 0 ? ` <span class="mv-model" data-mv="-1" data-name="${esc(s)}" title="左移一列">‹</span>` : `<span class="mv-model off">‹</span>`)
          + (si < srcs.length - 1 ? ` <span class="mv-model" data-mv="1" data-name="${esc(s)}" title="右移一列">›</span>` : `<span class="mv-model off">›</span>`)
          : "";
        const ren = inputMode ? ` <span class="ren-model" data-ren="${esc(s)}" title="编辑模型（改名/删除）"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/><path d="M9.796.786a.75.75 0 0 1 1.06 0l.592.592a.75.75 0 0 1 0 1.061l-.18.18a3.5 3.5 0 0 1 0 4.95l.18.18a.75.75 0 0 1 0 1.061l-.592.592a.75.75 0 0 1-1.06 0l-.18-.18a3.5 3.5 0 0 1-4.95 0l-.18.18a.75.75 0 0 1-1.06 0l-.592-.592a.75.75 0 0 1 0-1.061l.18-.18a3.5 3.5 0 0 1 0-4.95l-.18-.18a.75.75 0 0 1 0-1.061l.592-.592a.75.75 0 0 1 1.06 0l.18.18a3.5 3.5 0 0 1 4.95 0l.18-.18z"/></svg></span>` : "";
        return `<th>${esc(s)}${ren}${mv}</th>`;
      }).join("") + "<th>我的预测</th></tr>";
    const tbody = $("#compareTable tbody");
    tbody.innerHTML = "";
    day.matches.forEach((m, mi) => {
      ["wdl", "tg", "hf", "sc"].forEach((k, ri) => {
        const tr = document.createElement("tr");
        tr.className = mi % 2 ? "band-b" : "band-a";
        let html = "";
        if (ri === 0) {
          const noteTxt = getMatchNote(curDate, m.id);
          const noteLine = noteTxt ? `<div class="row-note">${esc(noteTxt)}</div>` : "";
          const tags = getMatchTags(curDate, m.id);
          const tagLine = tags.length
            ? `<div class="row-tags">${tags.map((t) => `<span class="m-tag ${tagColorCls(t)}">${esc(t)}</span>`).join("")}</div>`
            : "";
          html += `<td class="match" rowspan="4">` +
            `<div class="m-league">${esc(m.league || "—")}</div>` +
            `<div class="m-id">${esc(m.id)}</div>` +
            `<div class="m-teams">${esc(m.home)} <span class="vs">VS</span> ${esc(m.away)}</div>` +
            (m.result ? `<div class="score-under"><span class="full-score">${esc(m.result.score)}</span>` +
              (m.result.half ? `<span class="half-score">(${esc(m.result.half)})</span>` : "") + "</div>" : "") +
            tagLine + noteLine + `</td>`;
        }
        html += `<td>${LABEL[k]}</td>`;
        srcs.forEach((s) => {
          const v = m.preds[s] ? m.preds[s][k] : "";
          if (inputMode) {
            html += `<td class="editable${v ? "" : " empty"}" data-mi="${mi}" data-src="${esc(s)}" title="点击录入/修改预测">${esc(v) || "点击录入"}</td>`;
          } else {
            html += `<td class="pickable ${k === "wdl" ? wdlClass(v) : ""}" data-mi="${mi}" data-k="${k}" data-src="${esc(s)}" title="双击录入/修改预测">${esc(v) || "—"}</td>`;
          }
        });
        const isSafe = (m.final.safe || []).includes(k);
        const hasVal = m.final[k] && String(m.final[k]).trim();
        html += `<td class="mycell" data-mi="${mi}" data-k="${k}">` +
          `<span class="my-val"${hasVal ? "" : ' title="双击模型格可录入预测"'}>${esc(m.final[k]) || "—"}</span>` +
          (hasVal ? `<span class="my-clear" data-mi="${mi}" data-k="${k}" title="清空该玩法预测">×</span>` : "") +
          `<span class="star-toggle ${isSafe ? "on" : ""}" data-mi="${mi}" data-k="${k}" title="感觉这项把握大？点★标记为稳健（再点取消）">★</span></td>`;
        tr.innerHTML = html;
        tbody.appendChild(tr);
      });
    });

    if (inputMode) {
      /* 双击模型格打开录入框；铅笔=改名/删除 */
      tbody.querySelectorAll("td.editable").forEach((td) => {
        td.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          openEditor(+td.dataset.mi, td.dataset.src);
        });
      });
      document.querySelectorAll("#compareTable thead .ren-model").forEach((x) => {
        x.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const old = x.dataset.ren;
          const act = await modelEditMenu(old);
          if (act === "ren") {
            const name = await uiPrompt("输入新的模型名称：", old, "修改模型名称");
            if (name === null || !name || name === old) return;
            if (allModelNames().includes(name)) { uiAlert("已存在同名模型，请换一个名称。", "修改模型名称"); return; }
            renameModel(old, name);
            uiToast("已改名为「" + name + "」");
            renderAll();
          } else if (act === "del") {
            if (await uiConfirm("确定删除模型「" + old + "」？\n该模型在所有日期录入的预测都会删除，且不可恢复。", { title: "删除模型", danger: true, okText: "删除" })) {
              dropModelAll(old);
              uiToast("已删除模型「" + old + "」");
              renderAll();
            }
          }
        });
      });
      document.querySelectorAll("#compareTable thead .mv-model[data-mv]").forEach((x) => {
        x.addEventListener("click", (ev) => {
          ev.stopPropagation();
          moveModel(x.dataset.name, +x.dataset.mv, srcs);
          uiToast("已调整「" + x.dataset.name + "」列位置");
          renderAll();
        });
      });
    } else {
      tbody.querySelectorAll("td.pickable, td.mycell").forEach((td) => {
        td.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          if (td.classList.contains("pickable")) openEditor(+td.dataset.mi, td.dataset.src);
          else { const m = day.matches[+td.dataset.mi]; const s = curSrcs.find((x) => m.preds && m.preds[x]); if (s) openEditor(+td.dataset.mi, s); }
        });
      });
    }
    /* 双击比赛队伍单元格 → 编辑备注（低调入口，无图标无按钮，两种模式通用） */
    tbody.querySelectorAll("td.match").forEach((td) => {
      td.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        /* match cell 在每场比赛的第一行（ri=0），用 tr 索引 ÷ 4 反推比赛下标 */
        const trList = [...tbody.querySelectorAll("tr")];
        const trIdx = trList.indexOf(td.closest("tr"));
        const rowMi = Math.floor(trIdx / 4);
        const m2 = day.matches[rowMi];
        if (m2) editMatchMeta(curDate, m2);
      });
    });
    /* 双击"我的预测"单元格 → 直接录入我的预测（不再自动共识，由用户手动选） */
    tbody.querySelectorAll("td.mycell").forEach((td) => {
      td.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        openEditor(+td.dataset.mi, "_my_final");
      });
    });
    /* "我的预测"列：× 清空单玩法（两种模式下都可用） */
    tbody.querySelectorAll(".my-clear").forEach((x) => {
      x.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const m = day.matches[+x.dataset.mi], k = x.dataset.k;
        m.final[k] = "";
        saveFinalPick(curDate, m.id, k, "");
        renderAll();
      });
    });
    /* ★ 稳健标记 */
    tbody.querySelectorAll(".star-toggle").forEach((st2) => {
      st2.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const m = day.matches[+st2.dataset.mi], k = st2.dataset.k;
        const arr = (m.final.safe || []).filter((x) => x !== k);
        if (!st2.classList.contains("on")) arr.push(k);
        m.final.safe = arr;
        const saved = loadSavedFinals();
        saved[curDate] = saved[curDate] || {};
        saved[curDate][m.id] = saved[curDate][m.id] || {};
        saved[curDate][m.id].safe = arr;
        persistUser("myFinal", saved);
        renderAll();
      });
    });
  }

  /* ---------- 录入模态框 ---------- */
  let edCtx = null; /* {mi, name, m} */
  let edCur = { wdl: [], rq: [], tg: [], hf: [], sc: [] };

  function toggleArr(arr, v) {
    const i = arr.indexOf(v);
    if (i > -1) arr.splice(i, 1); else arr.push(v);
  }
  /* 选项对应的官方赔率；该场无赔率数据返回 null */
  function chipOdds(k, v) {
    const o = edCtx && edCtx.m && edCtx.m.odds;
    if (!o) return null;
    if (k === "wdl") {
      const val = v === "胜" ? o.h : v === "平" ? o.d : o.a;
      return val != null ? +val : null;
    }
    if (k === "rq") {
      const t = o.rq || {};
      const val = v === "胜" ? t.h : v === "平" ? t.d : t.a;
      return val != null ? +val : null;
    }
    if (k === "tg") { const t = o.tg || {}; return t[v] != null ? +t[v] : null; }
    if (k === "hf") { const t = o.hf || {}; const key = HF_KEY[v]; return key && t[key] != null ? +t[key] : null; }
    const t = o.sc || {}; return t[v] != null ? +t[v] : null;
  }
  function renderChips(k) {
    const box = document.querySelector('.chips[data-k="' + k + '"]');
    let vals, offList = null;
    if (k === "wdl" || k === "rq") vals = ["胜", "平", "负"];
    else if (k === "tg") vals = ["0", "1", "2", "3", "4", "5", "6", "7"];
    else if (k === "hf") vals = HF_OPTS;
    else {
      /* 比分：有官方赔率时展示官方全部31项（含胜/平/负其他），否则退回常用列表 */
      offList = (edCtx && edCtx.m && edCtx.m.odds && edCtx.m.odds.sc) ? Object.keys(edCtx.m.odds.sc) : SC_COMMON;
      vals = offList.concat(edCur.sc.filter((v) => !offList.includes(v)));
    }
    const oddsMap = {};
    vals.forEach((v) => { oddsMap[v] = chipOdds(k, v); });
    const hasOdds = vals.some((v) => oddsMap[v] != null);
    const min = hasOdds ? Math.min(...vals.map((v) => oddsMap[v]).filter((x) => x != null)) : Infinity;
    box.innerHTML = "";
    vals.forEach((v) => {
      const b = document.createElement("button");
      b.type = "button";
      const on = edCur[k].includes(v);
      const od = oddsMap[v];
      b.className = "chip" + (on ? " on" : "") + (k === "sc" && offList && !offList.includes(v) ? " custom" : "");
      b.innerHTML = '<span class="c-n">' + esc(k === "tg" ? (v === "7" ? "7+" : v + "球") : v) + "</span>"
        + (od != null ? '<span class="c-o' + (od === min ? " fav" : "") + '">' + od.toFixed(2) + "</span>" : "");
      b.addEventListener("click", () => {
        toggleArr(edCur[k], v);
        b.classList.toggle("on");
      });
      box.appendChild(b);
    });
  }
  function rqText(rq) {
    const n = +rq || 0;
    return n < 0 ? String(n) : n > 0 ? "+" + n : "0";
  }
  function openEditor(mi, name) {
    const day = DATA.days[curDate];
    const m = day.matches[mi];
    const isMy = name === "_my_final";
    /* _my_final = 直接编辑"我的预测"：从 m.final 加载，保存时也写回 m.final（不走共识） */
    const p = isMy
      ? { wdl: (m.final && m.final.wdl) || "", tg: (m.final && m.final.tg) || "", hf: (m.final && m.final.hf) || "", sc: (m.final && m.final.sc) || "" }
      : (m.preds[name] || { wdl: "", tg: "", hf: "", sc: "" });
    edCtx = { mi, name, m, isMy };
    /* 胜平负串拆两组：普通选项进 wdl，带"让"的进 rq（兼容历史勾选让球的数据格式） */
    const wdlParts = String(p.wdl || "").split("/").map((s) => s.replace(/[+-]?\d+\s*/g, "").trim()).filter(Boolean);
    edCur = {
      wdl: wdlParts.filter((s) => !s.startsWith("让")),
      rq: wdlParts.filter((s) => s.startsWith("让")).map((s) => s.slice(1)).filter(Boolean),
      tg: String(p.tg || "").match(/\d+/g) || [],
      hf: String(p.hf || "").split("/").map((s) => s.trim()).filter(Boolean),
      sc: String(p.sc || "").split("/").map((s) => s.trim()).filter(Boolean)
    };
    $("#dlgTitle").textContent = isMy ? "我的预测" : name;
    $("#dlgSub").textContent = m.id + "  " + m.home + " VS " + m.away + "  （" + (m.league || "—") + " " + m.time + "）";
    $("#rqNumTxt").textContent = (m.rq == null || m.rq === "") ? "（0）" : "（" + rqText(m.rq) + "）";
    ["wdl", "rq", "tg", "hf", "sc"].forEach(renderChips);
    $("#dlgEdit").classList.remove("hidden");
  }
  function closeEditor() { $("#dlgEdit").classList.add("hidden"); edCtx = null; }
  function buildPred(m) {
    /* 普通胜平负与让球胜平负分开录入，保存时合并回 wdl 串（让球项带官方盘口数字） */
    const parts = [];
    if (edCur.wdl.length) parts.push(edCur.wdl.join("/"));
    if (edCur.rq.length) {
      const hd = +m.rq || 0;
      parts.push((hd !== 0 ? hd : "") + edCur.rq.map((x) => "让" + x).join("/"));
    }
    return {
      wdl: parts.join("/"),
      tg: edCur.tg.map((n) => n === "7" ? "7+球" : n + "球").join("/"),
      hf: edCur.hf.join("/"),
      sc: edCur.sc.join("/")
    };
  }

  $("#btnAddModel").addEventListener("click", async () => {
    const name = await uiPrompt("请输入新模型名称（如：模型A、扫盘助手）：", "", "添加模型");
    if (name === null || !name) return;
    if (allModelNames().includes(name)) { uiAlert("已存在同名模型，请换一个名称。", "添加模型"); return; }
    customModels.push(name);
    saveJSON(LS_MODELS, customModels);
    if (!modelOrder.includes(name)) { modelOrder.push(name); saveJSON(LS_ORDER, modelOrder); } /* 新模型列默认排在最右 */
    uiToast("已添加模型「" + name + "」，双击单元格即可录入预测");
    renderAll();
  });
  /* btnInputMode 已移除：录入始终可用，双击单元格即可录入 */

  /* 足球比赛预测分析：综合模型投票 + 官方赔率隐含概率，加权打分选最优。
   * 不是简单数票——赔率反映官方/市场对概率的判断，和模型投票互补。
   * 赔率隐含概率需归一化（1/odds 后除以总和，去掉博彩抽水）。
   * 各玩法之间做一致性校验：wdl=胜时比分应倾向主队赢的比分，总进球和比分要匹配等 */
  function bestPick(vals, k, m) {
    const cnt = {};
    const total = (vals || []).filter(Boolean).length;
    (vals || []).forEach((v) => {
      String(v || "").split("/").map((s) => s.trim()).filter(Boolean)
        .forEach((t) => { cnt[t] = (cnt[t] || 0) + 1; });
    });
    if (!total || !Object.keys(cnt).length) return "";

    const o = m.odds || {};
    const getOdds = (pick) => {
      pick = String(pick).replace(/^让/, "");
      if (k === "wdl") return pick === "胜" ? o.h : pick === "平" ? o.d : pick === "负" ? o.a : null;
      if (k === "tg") return o.tg ? o.tg[pick] : null;
      if (k === "hf") return o.hf ? o.hf[HF_KEY[pick]] : null;
      if (k === "sc") return o.sc ? o.sc[pick] : null;
      return null;
    };

    /* 赔率→隐含概率，归一化去抽水 */
    const allOpts = Object.keys(cnt);
    const invSum = allOpts.reduce((s, p) => {
      const od = getOdds(p);
      return s + (od != null && +od > 1 ? 1 / +od : 0);
    }, 0);

    let best = null, bestScore = -1;
    allOpts.forEach((pick) => {
      const voteRatio = cnt[pick] / total;                    /* 模型投票占比 0-1 */
      let oddsProb = 0;
      if (invSum > 0) {
        const od = getOdds(pick);
        if (od != null && +od > 1) oddsProb = (1 / +od) / invSum; /* 赔率隐含概率，归一化 */
      }
      /* 综合分：模型投票 60% + 赔率概率 40%
       * 模型一致同意时投票占比高→得分高；赔率低（官方看好）→概率高→得分高 */
      const score = voteRatio * 0.6 + oddsProb * 0.4;
      if (score > bestScore) { bestScore = score; best = pick; }
    });
    return best || "";
  }

  /* 玩法间一致性校验：wdl=胜时比分倾向主队赢；总进球和比分要匹配 */
  function crossValidate(m) {
    const f = m.final;
    const sc = parseScore(f.sc);
    if (!sc) return;
    /* wdl 和比分一致性 */
    const wdl = String(f.wdl || "").replace(/让.*/, "");
    if (wdl === "胜" && sc[0] <= sc[1]) {
      /* wdl 选胜但比分不是主队赢——修正比分为主队小胜 */
      if (m.odds && m.odds.sc) {
        const candidates = ["1:0", "2:0", "2:1", "3:0", "3:1"].filter((s) => m.odds.sc[s] != null);
        if (candidates.length) f.sc = candidates[0];
      }
    } else if (wdl === "负" && sc[0] >= sc[1]) {
      if (m.odds && m.odds.sc) {
        const candidates = ["0:1", "0:2", "1:2", "0:3", "1:3"].filter((s) => m.odds.sc[s] != null);
        if (candidates.length) f.sc = candidates[0];
      }
    } else if (wdl === "平" && sc[0] !== sc[1]) {
      if (m.odds && m.odds.sc) {
        const candidates = ["0:0", "1:1", "2:2", "3:3"].filter((s) => m.odds.sc[s] != null);
        if (candidates.length) f.sc = candidates[0];
      }
    }
    /* 总进球和比分一致性 */
    const tg = String(f.tg || "").match(/\d+/);
    if (tg) {
      const total = sc[0] + sc[1];
      const tgNum = +tg[0];
      if (tgNum < 7 && total !== tgNum) {
        /* 比分和总进球不匹配——总进球修正为比分实际进球数 */
        f.tg = (total >= 7 ? "7" : String(total)) + "球";
      }
    }
  }

  /* 自动分析：模型投票 + 赔率概率 → 最优预测，玩法间做一致性校验（★稳健标记保留） */
  function autoConsensusMatch(m, d) {
    const preds = Object.values(m.preds || {});
    let changed = false;
    ["wdl", "tg", "hf", "sc"].forEach((k) => {
      const v = bestPick(preds.map((p) => p[k]), k, m);
      if (String(m.final[k] || "") !== v) { m.final[k] = v; saveFinalPick(d, m.id, k, v); changed = true; }
    });
    /* 胜平负、总进球、比分算完后做交叉校验，保证逻辑一致 */
    const before = JSON.stringify({ wdl: m.final.wdl, tg: m.final.tg, sc: m.final.sc });
    crossValidate(m);
    const after = JSON.stringify({ wdl: m.final.wdl, tg: m.final.tg, sc: m.final.sc });
    if (before !== after) {
      saveFinalPick(d, m.id, "sc", m.final.sc);
      saveFinalPick(d, m.id, "tg", m.final.tg);
      changed = true;
    }
    return changed;
  }
  $("#dlgClose").addEventListener("click", closeEditor);
  $("#dlgCancel").addEventListener("click", closeEditor);
  $("#dlgEdit").addEventListener("click", (e) => { if (e.target.id === "dlgEdit") closeEditor(); });
  $("#dlgClear").addEventListener("click", () => {
    if (!edCtx) return;
    edCur = { wdl: [], rq: [], tg: [], hf: [], sc: [] };
    ["wdl", "rq", "tg", "hf", "sc"].forEach(renderChips);
    uiToast("已清空，点「保存」后生效");
  });
  $("#dlgSave").addEventListener("click", () => {
    if (!edCtx) return;
    const day = DATA.days[curDate];
    const m = day.matches[edCtx.mi];
    const who = edCtx.name; /* closeEditor 会清空 edCtx，先取名 */
    const isMy = edCtx.isMy === true;
    const p = buildPred(m);
    closeEditor();
    if (isMy) {
      /* 直接编辑"我的预测"：写入 m.final 并持久化，不再走共识自动重算 */
      m.final = Object.assign({}, m.final || {}, p);
      ["wdl", "tg", "hf", "sc"].forEach((k) => saveFinalPick(curDate, m.id, k, m.final[k]));
      uiToast("已保存「我的预测」");
    } else {
      m.preds = m.preds || {};
      m.preds[who] = p;
      savePredPick(curDate, m.id, who, p);
      uiToast("已保存「" + who + "」的预测");
    }
    renderAll();
  });

  /* ---------- 历史统计 ---------- */
  const PLAY_EVAL = { wdl: evalWdl, tg: evalTg, hf: evalHf, sc: evalSc };
  const newStat = () => ({ n: 0, wdl: 0, wdlN: 0, tg: 0, tgN: 0, hf: 0, hfN: 0, sc: 0, scN: 0 });
  const checkPred = (p, st, m) => {
    st.n++;
    Object.keys(PLAY_EVAL).forEach((k) => {
      const r = PLAY_EVAL[k](p[k], m.result, k === "wdl" ? offHandi(m) : undefined);
      if (r !== null) { st[k + "N"]++; if (r) st[k]++; }
    });
  };

  function renderStats() {
    const perSource = {};
    const dayRows = [];
    let totalMatches = 0, totalResults = 0;

    dates.slice().sort().reverse().forEach((d) => {
      const day = DATA.days[d];
      const r0 = { res: 0, allH: 0, allN: 0 };
      ["wdl", "tg", "hf", "sc"].forEach((k) => { r0[k] = 0; r0[k + "N"] = 0; });
      day.matches.forEach((m) => {
        totalMatches++;
        if (!m.result) return;
        r0.res++; totalResults++;
        Object.keys(m.preds || {}).forEach((s) => {
          checkPred(m.preds[s], perSource[s] = perSource[s] || newStat(), m);
        });
        const f = m.final || {};
        const st = perSource["最终预测"] = perSource["最终预测"] || newStat();
        checkPred(f, st, m);
        ["wdl", "tg", "hf", "sc"].forEach((k) => {
          const ok = PLAY_EVAL[k](f[k], m.result, k === "wdl" ? offHandi(m) : undefined);
          if (ok !== null) { r0[k + "N"]++; r0.allN++; if (ok) { r0[k]++; r0.allH++; } }
        });
      });
      dayRows.push({ d, total: day.matches.length, ...r0 });
    });

    const st = perSource["最终预测"] || { wdlN: 0, wdl: 0 };
    const allN = ["wdlN", "tgN", "hfN", "scN"].reduce((s, k) => s + (st[k] || 0), 0);
    const allH = ["wdl", "tg", "hf", "sc"].reduce((s, k) => s + (st[k] || 0), 0);
    const pct = (h, n) => n ? Math.round((h / n) * 100) + "%" : "—";
    $("#statCards").innerHTML =
      `<div class="card"><div class="num">${dates.length}</div><div class="lbl">记录天数</div></div>` +
      `<div class="card"><div class="num">${totalMatches}</div><div class="lbl">总场次</div></div>` +
      `<div class="card"><div class="num">${totalResults}</div><div class="lbl">已开奖</div></div>` +
      `<div class="card"><div class="num">${pct(st.wdl, st.wdlN)}</div><div class="lbl">我的胜平负命中</div></div>` +
      `<div class="card"><div class="num">${pct(allH, allN)}</div><div class="lbl">我的综合命中率</div></div>`;

    const names = Object.keys(perSource);
    names.sort((a, b) => (a === "最终预测" ? -1 : b === "最终预测" ? 1 : a.localeCompare(b, "zh")));
    const showName = (n) => n === "最终预测" ? "我的预测" : n;
    const cell = (s, k) => {
      const n = s[k + "N"];
      if (!n) return '<td class="miss">—</td>';
      const pct = Math.round((s[k] / n) * 100);
      return `<td class="${pct >= 50 ? "hit" : "miss"}">${s[k]}/${n}（${pct}%）</td>`;
    };
    $("#srcTable tbody").innerHTML = names.length ? names.map((n, i) => {
      const s = perSource[n];
      return `<tr class="${i % 2 ? "band-b" : "band-a"}"><td>${esc(showName(n))}</td><td>${s.n}</td>` +
        cell(s, "wdl") + cell(s, "tg") + cell(s, "hf") + cell(s, "sc") + "</tr>";
    }).join("") : '<tr><td colspan="6">暂无已开奖数据</td></tr>';

    const dcell = (r, k) => {
      const n = r[k + "N"];
      if (!n) return '<td class="miss">—</td>';
      const p = Math.round((r[k] / n) * 100);
      return `<td class="${p >= 50 ? "hit" : "miss"}">${r[k]}/${n}（${p}%）</td>`;
    };
    $("#dayTable tbody").innerHTML = dayRows.map((r, i) =>
      `<tr class="${i % 2 ? "band-b" : "band-a"}"><td>${r.d}</td><td>${r.total}</td><td>${r.res}</td>` +
      dcell(r, "wdl") + dcell(r, "tg") + dcell(r, "hf") + dcell(r, "sc") +
      `<td class="hit">${r.allN ? r.allH + "/" + r.allN + "（" + Math.round(r.allH / r.allN * 100) + "%）" : "—"}</td>` +
      `<td class="note-cell">${r.res < r.total ? "部分未开奖" : (r.res ? "全部已开奖" : "未开奖")}</td></tr>`
    ).join("");
  }

  /* ---------- 导出 Excel / 图片 ---------- */
  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  function getExportTarget() {
    const id = document.querySelector(".panel.active").id;
    const day = DATA.days[curDate];
    if (id === "tab-summary")
      return { name: "每日汇总", cap: "本期扫盘  " + curDate + "  比赛数:" + day.matches.length,
        tables: [{ el: $("#summaryTable"), cap: "" }] };
    if (id === "tab-compare")
      return { name: "模型对比", cap: "模型对比  " + curDate, tables: [{ el: $("#compareTable"), cap: "" }] };
    if (id === "tab-bets")
      return { name: "投注方案", cap: "投注方案记录", tables: [{ el: $("#betsTable"), cap: "" }] };
    return { name: "历史统计", cap: "历史统计  " + curDate,
      tables: [{ el: $("#srcTable"), cap: "各模型 / 我的预测命中率" }, { el: $("#dayTable"), cap: "每日总结" }] };
  }

  /* 克隆表格并剔除控件：改名/删除/移动图标、点选✓、空★、展开行、“点击录入”占位 */
  function cleanTableClone(table) {
    const clone = table.cloneNode(true);
    clone.querySelectorAll("tr.detail-row").forEach((r) => r.remove());
    clone.querySelectorAll(".del-model,.ren-model,.mv-model").forEach((n) => n.remove());
    clone.querySelectorAll("td.pickable").forEach((td) => {
      [...td.childNodes].forEach((n) => {
        if (n.nodeType === 3 && n.textContent.includes("✓")) n.textContent = n.textContent.replace(/✓\s*/g, "");
      });
    });
    clone.querySelectorAll("td.editable").forEach((td) => {
      const tx = td.textContent.trim();
      if (!tx || tx === "点击录入") td.textContent = "—";
    });
    clone.querySelectorAll(".star-toggle:not(.on)").forEach((n) => n.remove());
    return clone;
  }

  let _cssCache = "";
  function appCssText() {
    if (_cssCache) return _cssCache;
    let out = "";
    [...document.styleSheets].forEach((sh) => {
      try { [...sh.cssRules].forEach((r) => { out += r.cssText + "\n"; }); } catch (e) {}
    });
    return (_cssCache = out);
  }

  const EXPORT_CSS =
    ".export-page{background:#f4f6f9;padding:18px 20px;box-sizing:border-box;" +
    'font-family:"Microsoft YaHei","PingFang SC",sans-serif;}' +
    ".export-head{background:#fff;border-left:4px solid #2563eb;border-radius:8px 8px 0 0;" +
    "padding:12px 16px;font-size:19px;font-weight:700;color:#111827;letter-spacing:1px;}" +
    ".export-cap{font-size:15px;font-weight:700;color:#2563eb;margin:18px 2px 8px;}" +
    ".export-page .table-wrap{overflow:visible!important;box-shadow:none;border-radius:0 0 10px 10px;}" +
    ".export-page table.board thead th{position:static!important;}";

  /* 组装干净的导出页（脱离当前DOM，不影响页面显示） */
  function buildExportPage(t) {
    const page = document.createElement("div");
    page.className = "export-page";
    const head = document.createElement("div");
    head.className = "export-head";
    head.textContent = t.cap;
    page.appendChild(head);
    t.tables.forEach((x) => {
      if (x.cap) {
        const c = document.createElement("div");
        c.className = "export-cap";
        c.textContent = x.cap;
        page.appendChild(c);
      }
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      wrap.appendChild(cleanTableClone(x.el));
      page.appendChild(wrap);
    });
    return page;
  }

  function exportExcel() {
    const t = getExportTarget();
    const blocks = t.tables.map((x) =>
      (x.cap ? "<h3>" + esc(x.cap) + "</h3>" : "") + cleanTableClone(x.el).outerHTML).join("<br>");
    const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
      '<head><meta charset="UTF-8"><style>h2{font-family:"Microsoft YaHei"}h3{font-family:"Microsoft YaHei";color:#2563eb}' +
      "table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 10px;text-align:center;font-family:'Microsoft YaHei';font-size:12px}" +
      "th{background:#f1f5f9}</style></head><body><h2>" + esc(t.cap) + "</h2>" + blocks + "</body></html>";
    saveBlob(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }),
      "竞足_" + t.name + "_" + curDate + ".xls");
  }

  /* 图片导出：真实DOM（完整样式、绿圈/红★/配色）序列化进 SVG foreignObject 再绘制，
   * 宽表也完整不截断；不依赖网络，离线可用；失败时降级为SVG矢量图 */
  async function exportImage() {
    const t = getExportTarget();
    const page = buildExportPage(t);
    page.style.position = "fixed";
    page.style.left = "-99999px";
    page.style.top = "0";
    page.style.width = "max-content"; /* 按表格真实内容撑开，宽表完整测量 */
    document.body.appendChild(page);
    const W = Math.ceil(page.scrollWidth), H = Math.ceil(page.scrollHeight);
    const pageHtml0 = page.outerHTML;
    page.remove();
    if (!W || !H) { uiAlert("导出失败：请先切换到要导出的页签", "导出图片"); return; }

    /* foreignObject 要求严格 XHTML：HTML 空标签(<br>等)必须自闭合，否则图片加载失败 */
    const VOID = /<(br|img|hr|input|meta|link|col)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    const pageHtml = pageHtml0.replace(VOID, (m, tag, attrs) =>
      attrs.trim().endsWith("/") ? m : "<" + tag + attrs + "/>");

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
      '<foreignObject x="0" y="0" width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + W + 'px">' +
      "<style>" + appCssText() + EXPORT_CSS + "</style>" + pageHtml +
      "</div></foreignObject></svg>";
    const fileName = "竞足_" + t.name + "_" + curDate;

    let img;
    try {
      img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      });
    } catch (e) {
      saveBlob(new Blob([svg], { type: "image/svg+xml" }), fileName + ".svg");
      uiToast("当前浏览器无法转PNG，已保存为SVG矢量图");
      return;
    }
    const scale = 2; /* 2倍图，清晰不模糊 */
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    try {
      canvas.toBlob((blob) => {
        if (blob) saveBlob(blob, fileName + ".png");
        else { saveBlob(new Blob([svg], { type: "image/svg+xml" }), fileName + ".svg"); uiToast("已保存为SVG矢量图"); }
      }, "image/png");
    } catch (e) {
      saveBlob(new Blob([svg], { type: "image/svg+xml" }), fileName + ".svg");
      uiToast("已保存为SVG矢量图");
    }
  }

  $("#btnExpExcel").addEventListener("click", () => {
    exportExcel();
    uiToast("Excel 已开始下载，请在下载列表查看");
  });
  $("#btnExpImg").addEventListener("click", () => {
    uiToast("正在生成图片…");
    exportImage();
  });

  /* ---------- 投注方案：官方赔率自由过关 + localStorage + 开奖自动结算 ----------
   * 规则同官方竞彩：2元/注，注数=组合数×倍数；过关方式复选（自由过关）；
   * 理论最高奖金 = 所选全部组合均命中时的奖金（按保存时赔率结算） */
  const LS_BETS = LS_KEY_MAP.bets;
  let bets = []; /* 实际加载延后到 runAppInit，确保 currentUser 已就绪 */
  const saveBets = () => persistUser("bets", bets);
  const BET_PLAY_LABEL = { wdl: "胜平负", rq: "让球胜平负", tg: "总进球", hf: "半全场", sc: "比分" };
  const combN = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); };
  function combIdx(n, k) {
    const out = [], cur = [];
    (function go(s) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = s; i < n; i++) { cur.push(i); go(i + 1); cur.pop(); }
    })(0);
    return out;
  }
  const fmtMoney = (x) => (Math.round(x * 100) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });

  let slip = { legs: [], modes: [], mult: 1 };

  /* 比赛是否还在售（未开赛且官方有赔率）：date=日期串，m=比赛对象 */
  function betCanBuy(date, m) {
    if (m.result) return false;
    if (!m.odds) return false;
    const t = (m.time || "").trim();
    if (!t) return false;
    /* ISO 8601 字符串（带 T 分隔符）现代浏览器统一按本地时间解析；
     * 不能把 - 换成 / —— 那会让 T 分隔符失效变成 Invalid Date */
    const dt = new Date(date + "T" + t + ":00");
    if (isNaN(dt.getTime())) return false;
    /* 竞彩赛程惯例：「周X」日程下时间在 00:00-11:59 的比赛，
     * 实际开球时间在「次日」凌晨/上午（如 周一003 00:00 = 周二 00:00）。
     * 把 hour<12 的比赛往后推 24 小时再和当前时间比较，避免已开赛误判。 */
    const hh = +t.split(":")[0];
    const kickOff = hh < 12 ? new Date(dt.getTime() + 24 * 3600 * 1000) : dt;
    return kickOff.getTime() > Date.now();
  }
  function betUpcoming() {
    const out = [];
    Object.keys(DATA.days).sort().reverse().forEach((d) =>
      (DATA.days[d].matches || []).forEach((m) => { if (betCanBuy(d, m)) out.push({ date: d, m }); }));
    return out;
  }
  function betFind(key) {
    if (!key) return null;
    const i = key.indexOf("|");
    const d = key.slice(0, i), id = key.slice(i + 1);
    const day = DATA.days[d];
    const m = day && (day.matches || []).find((x) => x.id === id);
    return m ? { date: d, m } : null;
  }
  function renderBetMatchSel() {
    const sel = $("#betMatchSel");
    const prev = sel.value;
    sel.innerHTML = "";
    const list = betUpcoming();
    if (!list.length) { sel.innerHTML = '<option value="">暂无可投注场次</option>'; return; }
    const groups = {};
    list.forEach((e) => (groups[e.date] = groups[e.date] || []).push(e.m));
    Object.keys(groups).forEach((d) => {
      const og = document.createElement("optgroup");
      og.label = d;
      groups[d].forEach((m) => {
        const o = document.createElement("option");
        o.value = d + "|" + m.id;
        o.textContent = m.id + " " + m.home + " VS " + m.away + "（" + (m.time || "") + "）";
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    const has = [...sel.options].some((o) => o.value === prev);
    sel.value = has ? prev : sel.options[0].value;
  }
  function renderBetChips() {
    /* 所有玩法盘口一次性铺开：胜平负 / 让球胜平负（带盘口） / 总进球 / 半全场 / 比分
     * 同场同玩法可换选，再次点击已选项即移除；每玩法缺赔率时显示该区块为"暂无" */
    const box = $("#betChips");
    box.innerHTML = "";
    const ent = betFind($("#betMatchSel").value);
    if (!ent) { box.innerHTML = '<div class="bet-none">暂无可投注场次</div>'; return; }
    const m = ent.m, o = m.odds || {};
    const rqN = +m.rq || 0;
    const rqTxt = rqN < 0 ? "盘口 " + rqN : rqN > 0 ? "盘口 +" + rqN : "盘口 0";
    /* 各玩法的 (label, vals, oddsMap, chipClass) */
    const groups = [
      { play: "wdl", title: "胜平负", vals: ["胜", "平", "负"], map: { "胜": o.h, "平": o.d, "负": o.a }, cls: "chips" },
      { play: "rq", title: "让球胜平负", sub: rqTxt, vals: o.rq ? ["胜", "平", "负"] : [], map: o.rq ? { "胜": o.rq.h, "平": o.rq.d, "负": o.rq.a } : {}, cls: "chips" },
      { play: "tg", title: "总进球", vals: ["0", "1", "2", "3", "4", "5", "6", "7"], map: o.tg || {}, cls: "chips", numFmt: (v) => v === "7" ? "7+" : v + "球" },
      { play: "hf", title: "半全场", vals: HF_OPTS, map: (function () { const t = o.hf || {}; const mp = {}; HF_OPTS.forEach((v) => { mp[v] = t[HF_KEY[v]]; }); return mp; })(), cls: "chips hf-grid" },
      { play: "sc", title: "比分", vals: o.sc ? Object.keys(o.sc) : SC_COMMON, map: o.sc || {}, cls: "chips sc-grid" }
    ];
    groups.forEach((g) => {
      if (!g.vals.length) return;
      const sec = document.createElement("div");
      sec.className = "ep";
      const head = document.createElement("div");
      head.className = "ep-t";
      head.textContent = g.title;
      if (g.sub) { const s = document.createElement("span"); s.className = "ep-d"; s.textContent = " " + g.sub; head.appendChild(s); }
      sec.appendChild(head);
      const chips = document.createElement("div");
      chips.className = g.cls;
      const nums = g.vals.map((v) => g.map[v]).filter((x) => x != null && x !== "").map(Number);
      const min = nums.length ? Math.min(...nums) : Infinity;
      g.vals.forEach((v) => {
        const raw = g.map[v];
        const od = raw != null && raw !== "" ? +raw : null;
        const on = slip.legs.some((l) => l.date === ent.date && l.id === m.id && l.play === g.play && l.pick === v);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip" + (on ? " on" : "");
        const lbl = g.numFmt ? g.numFmt(v) : v;
        b.innerHTML = '<span class="c-n">' + esc(lbl) + "</span>"
          + '<span class="c-o' + (od != null && od === min ? " fav" : "") + '">' + (od != null ? od.toFixed(2) : "—") + "</span>";
        b.addEventListener("click", () => toggleBetPick(ent, g.play, v, od));
        chips.appendChild(b);
      });
      sec.appendChild(chips);
      box.appendChild(sec);
    });
  }
  function toggleBetPick(ent, play, pick, odds) {
    const i = slip.legs.findIndex((l) => l.date === ent.date && l.id === ent.m.id && l.play === play);
    if (i > -1) {
      if (slip.legs[i].pick === pick) slip.legs.splice(i, 1);
      else { slip.legs[i].pick = pick; slip.legs[i].odds = odds; }
    } else {
      if (slip.legs.length >= 8) { uiAlert("单张方案最多8场（官方最高8串1）。", "投注方案"); return; }
      slip.legs.push({
        date: ent.date, id: ent.m.id, home: ent.m.home, away: ent.m.away,
        play, pick, odds, handi: play === "rq" ? (+ent.m.rq || 0) : 0
      });
    }
    normalizeModes();
    renderSlip();
    renderBetChips();
  }
  function normalizeModes() {
    const n = slip.legs.length;
    slip.modes = slip.modes.filter((k) => k <= n);
    if (n === 1) slip.modes = [1];
    else if (n >= 2 && !slip.modes.length) slip.modes = [2];
  }
  /* 注数/金额/理论最高奖金：注数=组合数×倍数；最高=全部组合均命中（官方口径） */
  function slipCalc(legs, modes, mult) {
    const n = legs.length;
    let units = 0, prodSum = 0, oddsOk = n > 0;
    modes.forEach((k) => {
      units += combN(n, k);
      combIdx(n, k).forEach((ix) => {
        let p = 1;
        ix.forEach((li) => { const od = legs[li].odds; if (od == null || isNaN(od)) oddsOk = false; else p *= od; });
        prodSum += p;
      });
    });
    return { bets: units * mult, stake: units * 2 * mult, maxWin: oddsOk ? 2 * mult * prodSum : null };
  }
  function betPickDisp(l) {
    if (l.play === "tg") return l.pick === "7" ? "7球+" : l.pick + "球";
    if (l.play === "rq") return (l.handi ? "让" + Math.abs(l.handi) : "") + l.pick;
    return l.pick;
  }
  function renderSlip() {
    const box = $("#slipLegs");
    box.innerHTML = slip.legs.length
      ? slip.legs.map((l, i) =>
        '<div class="slip-leg"><div class="sl-info"><b>' + esc(l.id) + "</b> " + esc(l.home + " VS " + l.away) +
        "<em>" + esc(BET_PLAY_LABEL[l.play]) + " · " + esc(betPickDisp(l)) +
        (l.odds != null ? ' <i>@' + (+l.odds).toFixed(2) + "</i>" : "") + "</em></div>" +
        '<span class="slip-x" data-i="' + i + '" title="移除">×</span></div>').join("")
      : '<div class="bet-none">尚未选择，从左侧点击玩法选项加入投注单</div>';
    const mr = $("#modeRow");
    const n = slip.legs.length;
    if (!n) mr.innerHTML = '<span class="bet-none">添加选项后自动出现过关方式</span>';
    else if (n === 1) mr.innerHTML = '<span class="mode-single">单关</span>';
    else mr.innerHTML = Array.from({ length: Math.min(8, n) - 1 }, (_, i) => i + 2).map((k) =>
      '<button type="button" class="mode-btn' + (slip.modes.includes(k) ? " on" : "") + '" data-k="' + k + '">' + k + "串1</button>").join("");
    const c = slipCalc(slip.legs, slip.modes, slip.mult);
    $("#betSum").innerHTML = !slip.legs.length ? ""
      : (n >= 2 && !slip.modes.length ? '<div class="bet-none">请选择过关方式</div>' : "")
      + '<div><span class="bs-bets">' + c.bets + "</span> 注 · 金额 <b class=\"bs-stake\">¥" + fmtMoney(c.stake) + "</b></div>"
      + '<div>理论最高奖金 <b class="bs-max">¥' + (c.maxWin == null ? "—" : fmtMoney(c.maxWin)) + "</b>"
      + (c.maxWin != null && c.maxWin > 5000000 ? "<i>（超单票500万上限，按规则封顶）</i>" : "") + "</div>";
  }
  /* 单腿结算：won/lost/pending；让球数以下注时的官方盘口为准 */
  function legEval(l) {
    const day = DATA.days[l.date];
    const m = day && (day.matches || []).find((x) => x.id === l.id);
    if (!m) return "pending";
    const r = m.result;
    const f = parseScore(r && r.score);
    if (!f) return "pending";
    if (l.play === "wdl" || l.play === "rq") {
      const h = l.play === "rq" ? (l.handi != null ? l.handi : (+m.rq || 0)) : 0;
      const adj = f[0] + h;
      const raw = adj > f[1] ? "胜" : adj === f[1] ? "平" : "负";
      return l.pick === raw ? "won" : "lost";
    }
    if (l.play === "tg") { const t = f[0] + f[1]; return (+l.pick === t || (l.pick === "7" && t >= 7)) ? "won" : "lost"; }
    if (l.play === "hf") {
      const h = parseScore(r.half);
      if (!h) return "pending";
      const fc = f[0] > f[1] ? "胜" : f[0] === f[1] ? "平" : "负";
      const hc = h[0] > h[1] ? "胜" : h[0] === h[1] ? "平" : "负";
      return l.pick === hc + fc ? "won" : "lost";
    }
    return l.pick === f.join(":") ? "won" : "lost";
  }
  /* 整单结算：遍历所选过关方式的全部组合，全命中组合累加奖金（官方口径） */
  function betSettle(b) {
    const st = b.legs.map(legEval);
    let prize = 0, alivePending = false, anyWon = false, allPending = true;
    st.forEach((s) => { if (s !== "pending") allPending = false; });
    b.modes.forEach((k) => {
      combIdx(b.legs.length, k).forEach((ix) => {
        let p = 1, dead = false, pend = false;
        ix.forEach((li) => {
          const s = st[li];
          if (s === "lost") dead = true;
          else if (s === "pending") pend = true;
          else p *= (b.legs[li].odds || 0);
        });
        if (dead) return;
        if (pend) { alivePending = true; return; }
        anyWon = true;
        prize += 2 * b.mult * p;
      });
    });
    const status = allPending ? "pend"
      : anyWon ? (alivePending ? "live" : "won")
      : alivePending ? "pend" : "lost";
    return { status, prize };
  }
  const betModesText = (b) => b.modes.map((k) => (k === 1 ? "单关" : k + "串1")).join("、");
  function renderBets() {
    const tbody = $("#betsTable tbody");
    tbody.innerHTML = "";
    if (!bets.length) {
      tbody.innerHTML = '<tr class="band-a"><td colspan="7" class="bets-empty">还没有保存的方案，在上方选场选玩法即可创建第一注</td></tr>';
      return;
    }
    bets.forEach((b, idx) => {
      const c = slipCalc(b.legs, b.modes, b.mult);
      const s = betSettle(b);
      const badge = s.status === "pend" ? '<span class="bst bst-pend">待开奖</span>'
        : s.status === "live" ? '<span class="bst bst-live">部分结算</span>'
        : s.status === "won" ? '<span class="bst bst-won">已中奖</span>'
        : '<span class="bst bst-lost">未中</span>';
      const prizeLine = (s.status === "won" || s.status === "live") && s.prize > 0
        ? '<div class="bprize">奖金 ¥' + fmtMoney(s.prize) + "</div>" : "";
      const tr = document.createElement("tr");
      tr.className = idx % 2 ? "band-b" : "band-a";
      tr.innerHTML =
        "<td>" + esc((b.ts || "").slice(5, 16)) + "</td>" +
        '<td class="bc-content">' + b.legs.map((l) =>
          '<div class="bleg"><b>' + esc(l.id) + "</b> " + esc(BET_PLAY_LABEL[l.play]) + " · " + esc(betPickDisp(l)) +
          (l.odds != null ? " <i>@" + (+l.odds).toFixed(2) + "</i>" : "") +
          "<em>" + esc(l.home + " VS " + l.away) + "</em></div>").join("") + "</td>" +
        "<td>" + esc(betModesText(b)) + "</td>" +
        "<td>" + c.bets + "注×" + b.mult + "倍</td>" +
        "<td>¥" + fmtMoney(c.stake) + "</td>" +
        "<td>¥" + (c.maxWin == null ? "—" : fmtMoney(c.maxWin)) + "</td>" +
        '<td class="bc-status">' + badge + prizeLine +
        '<span class="del-model" data-bid="' + b.id + '" title="删除该方案">×</span></td>';
      tbody.appendChild(tr);
    });
  }
  $("#betMatchSel").addEventListener("change", renderBetChips);
  $("#modeRow").addEventListener("click", (e) => {
    const b = e.target.closest(".mode-btn"); if (!b) return;
    const k = +b.dataset.k;
    const i = slip.modes.indexOf(k);
    if (i > -1) slip.modes.splice(i, 1); else slip.modes.push(k);
    slip.modes.sort((a, c) => a - c);
    renderSlip();
  });
  $("#slipLegs").addEventListener("click", (e) => {
    const x = e.target.closest(".slip-x"); if (!x) return;
    slip.legs.splice(+x.dataset.i, 1);
    normalizeModes();
    renderSlip();
    renderBetChips();
  });
  function setMult(v) {
    slip.mult = Math.min(9999, Math.max(1, Math.round(+v) || 1));
    $("#multInput").value = slip.mult;
    renderSlip();
  }
  $("#multMinus").addEventListener("click", () => setMult(slip.mult - 1));
  $("#multPlus").addEventListener("click", () => setMult(slip.mult + 1));
  $("#multInput").addEventListener("change", () => setMult($("#multInput").value));
  $("#betSave").addEventListener("click", () => {
    if (!slip.legs.length) { uiAlert("请先添加投注选项。", "保存方案"); return; }
    if (!slip.modes.length) { uiAlert("请先选择过关方式。", "保存方案"); return; }
    const c = slipCalc(slip.legs, slip.modes, slip.mult);
    bets.unshift({
      id: Date.now(),
      ts: new Date().toISOString().slice(0, 16).replace("T", " "),
      legs: JSON.parse(JSON.stringify(slip.legs)),
      modes: slip.modes.slice(),
      mult: slip.mult
    });
    saveBets();
    /* 保存后投注单内容保留：方便用户继续下相同或相近的方案 */
    renderSlip(); renderBetChips(); renderBets();
    uiToast("方案已保存：" + c.bets + "注 · ¥" + fmtMoney(c.stake) + "，投注单已保留");
  });
  $("#betReset").addEventListener("click", () => {
    slip = { legs: [], modes: [], mult: 1 };
    $("#multInput").value = "1";
    renderSlip(); renderBetChips();
  });
  $("#betsTable").addEventListener("click", async (e) => {
    const x = e.target.closest(".del-model[data-bid]"); if (!x) return;
    const ok = await uiConfirm("确定删除该方案？删除后不可恢复。", { title: "删除方案", danger: true, okText: "删除" });
    if (!ok) return;
    const i = bets.findIndex((b) => String(b.id) === x.dataset.bid);
    if (i > -1) { bets.splice(i, 1); saveBets(); renderBets(); uiToast("方案已删除"); }
  });

  renderBetMatchSel(); renderBetChips(); renderSlip();

  /* ---------- 官方数据自动更新 ----------
   * 服务端每2小时自动拉取；页面打开时查状态，数据过旧则静默补拉，
   * 完成后只给轻提示（点提示才刷新，不打断正在录入的操作） */
  const AUTO_AGE_MIN = 90;   /* 数据超过 90 分钟视为过旧 */
  const POLL_MIN = 30;       /* 页面开着时每 30 分钟查一次 */
  let autoBusy = false;
  function setSyncMsg(html) { const el = $("#syncMsg"); if (el) el.innerHTML = html; }
  async function autoCheck() {
    if (autoBusy) return;
    try {
      const st = await (await fetch("/api/status")).json();
      if (st.updating) { setSyncMsg('<span class="sync-run">正在更新官方数据…</span>'); return; }
      if (st.lastAt && st.ageMin != null && st.ageMin <= AUTO_AGE_MIN) {
        setSyncMsg('<span class="sync-ok">官方数据已更新 · ' + new Date(st.lastAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + "</span>");
        return;
      }
      autoBusy = true;
      setSyncMsg('<span class="sync-run">正在更新官方数据…</span>');
      const r = await (await fetch("/api/update")).json();
      autoBusy = false;
      if (r.busy) return;
      if (r.ok) {
        setSyncMsg('<a href="javascript:void(0)" id="syncReload" class="sync-new">官方数据有更新，点击查看最新 ↻</a>');
        const a = $("#syncReload");
        if (a) a.addEventListener("click", () => location.reload());
      } else {
        setSyncMsg("");
      }
    } catch (e) { /* 本地服务未运行时静默 */ autoBusy = false; }
  }

  /* 一键更新官方比赛数据（近2天走澳客在售+赛果大厅，更早日期走500历史库） */
  $("#btnSync").addEventListener("click", async () => {
    const btn = $("#btnSync"), msg = $("#syncMsg");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "更新中…";
    msg.textContent = "正在拉取官方数据，请稍候（约10秒）";
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const cur = new Date(curDate + "T00:00:00");
      const diff = Math.round((today - cur) / 86400000);
      const url = "/api/update" + (diff >= 2 ? "?date=" + curDate : "");
      const r = await fetch(url);
      const j = await r.json();
      if (j.ok) {
        msg.textContent = "官方数据已更新，正在刷新页面…";
        setTimeout(() => location.reload(), 700);
      } else {
        msg.textContent = "更新失败，请稍后重试";
        btn.disabled = false; btn.textContent = "↻ 更新比赛数据";
      }
    } catch (e) {
      msg.textContent = "更新服务未运行，请稍后重试";
      btn.disabled = false; btn.textContent = "↻ 更新比赛数据";
    }
  });

  function renderAll() { renderSummary(); renderCompare(); renderBets(); renderStats(); }

  /* ============================================================
   * 登录注册：硬门禁遮罩 + 顶栏用户区 + 服务器数据加载
   * bootApp 在脚本末尾调用：先查 /api/me，已登录则填充 userDataCache 并 runAppInit；
   * 未登录则显示登录遮罩。doLoginSubmit/doLogout 通过 location.reload() 简化状态切换。
   * ============================================================ */

  /* 拉取当前用户在服务器上的 8 个私有字段，全部塞进 userDataCache */
  async function loadUserDataFromServer() {
    let r;
    try { r = await fetch("/api/data", { cache: "no-store" }); } catch (e) { return; }
    if (!r.ok) return;
    const d = await r.json();
    DATA_KEYS.forEach((k) => {
      if (d[k] != null) userDataCache[k] = d[k];
    });
  }

  function showLoginMask() {
    const m = $("#loginMask");
    if (m) m.style.display = "flex";
    document.body.classList.add("logged-out");
  }
  function hideLoginMask() {
    const m = $("#loginMask");
    if (m) m.style.display = "none";
    document.body.classList.remove("logged-out");
  }
  /* 手机号脱敏：138****0000 */
  function maskPhone(p) {
    p = String(p || "");
    return p.length === 11 ? p.slice(0, 3) + "****" + p.slice(-4) : p;
  }
  function renderTopbarUser() {
    const el = $("#userPhone");
    if (el) el.textContent = maskPhone(currentUser);
  }

  /* 注册成功后：检测 localStorage 是否有旧数据，弹窗询问是否上传到新账号 */
  async function tryMigrateLocalData() {
    const items = {};
    let total = 0;
    DATA_KEYS.forEach((sk) => {
      const lk = LS_KEY_MAP[sk];
      let v = null;
      try { v = JSON.parse(localStorage.getItem(lk)); } catch (e) { v = null; }
      if (v == null) return;
      if (Array.isArray(v)) { if (!v.length) return; total += v.length; }
      else if (typeof v === "object") { const n = Object.keys(v).length; if (!n) return; total += n; }
      else return;
      items[sk] = v;
    });
    if (!total) return;
    const ok = await uiConfirm("检测到本地有 " + total + " 条数据（预测/模型/方案等），是否上传到新账号？", { title: "迁移本地数据", okText: "上传" });
    if (!ok) return;
    for (const sk of Object.keys(items)) {
      try {
        await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: sk, value: items[sk] })
        });
      } catch (e) {}
    }
    /* 上传后清理 localStorage，避免下次再被迁移 */
    DATA_KEYS.forEach((sk) => { try { localStorage.removeItem(LS_KEY_MAP[sk]); } catch (e) {} });
    uiToast("已上传 " + total + " 条数据");
  }

  /* 登录/注册提交：isRegister 勾选走 /api/register（成功后弹窗提示并尝试迁移本地数据）
   * 所有提示用 toast（明显但不阻塞）+ alert 弹窗（关键节点必须确认） */
  async function doLoginSubmit() {
    const phone = ($("#loginPhone").value || "").trim();
    const password = $("#loginPass").value || "";
    const isRegister = $("#isRegister").checked;
    const submitBtn = $("#btnLoginSubmit");
    if (!/^\d{11}$/.test(phone)) { uiToast("请输入 11 位手机号", "error"); $("#loginPhone").focus(); return; }
    if (password.length < 6 || password.length > 20) { uiToast("密码长度需 6-20 位", "error"); $("#loginPass").focus(); return; }
    /* 提交中禁用按钮，防止重复点击 */
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = isRegister ? "注册中…" : "登录中…"; }
    const url = isRegister ? "/api/register" : "/api/login";
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password })
      });
      const j = await r.json();
      if (!j.ok) {
        uiToast(j.err || "请求失败", "error");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isRegister ? "注册" : "登录"; }
        return;
      }
      if (isRegister) {
        /* 注册成功：弹窗明确提示，用户点确认后进入主应用 */
        uiToast("注册成功，正在进入…", "success");
        try { await tryMigrateLocalData(); } catch (e) { console.warn("迁移失败", e); }
        setTimeout(() => location.reload(), 600);
      } else {
        uiToast("登录成功，正在进入…", "success");
        setTimeout(() => location.reload(), 400);
      }
    } catch (e) {
      uiToast("网络异常，请稍后重试", "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isRegister ? "注册" : "登录"; }
    }
  }

  /* 退出：清服务器 session，再刷新回登录页 */
  async function doLogout() {
    try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
    location.reload();
  }

  /* 绑定登录遮罩内的按钮 / 回车 / 切换注册模式同步按钮文案 */
  (function bindLoginUI() {
    const btn = $("#btnLoginSubmit");
    if (btn) btn.addEventListener("click", doLoginSubmit);
    const phoneInp = $("#loginPhone");
    const passInp = $("#loginPass");
    const onKey = (e) => { if (e.key === "Enter") doLoginSubmit(); };
    if (phoneInp) phoneInp.addEventListener("keydown", onKey);
    if (passInp) passInp.addEventListener("keydown", onKey);
    /* 勾选「注册新账号」时同步按钮文案 + 自动清空密码框 */
    const regChk = $("#isRegister");
    if (regChk && btn) {
      regChk.addEventListener("change", () => {
        btn.textContent = regChk.checked ? "注册" : "登录";
        if (passInp) passInp.value = "";
        if (phoneInp) phoneInp.focus();
      });
    }
    const logoutBtn = $("#btnLogout");
    if (logoutBtn) logoutBtn.addEventListener("click", doLogout);
  })();

  /* runAppInit：登录后启动主应用初始化（applySaved*、purge、autoCheck、renderAll） */
  function runAppInit() {
    /* currentUser 已就绪 → loadJSON 走 userDataCache → 把服务器数据回填到内存变量 */
    savedFinals = null;
    customModels = loadJSON(LS_MODELS, []);
    modelOrder = loadJSON(LS_ORDER, []);
    matchNotes = loadJSON(LS_NOTES, {});
    matchTags = loadJSON(LS_TAGS, {});
    bets = loadJSON(LS_BETS, []);
    applySavedFinals();
    applyRenames();
    applySavedPreds();
    purgeOldModel();
    /* 启动官方数据自动轮询 + 初次渲染 */
    setTimeout(autoCheck, 3000);
    setInterval(autoCheck, POLL_MIN * 60000);
    renderAll();
  }

  /* bootApp：脚本末尾调用，硬门禁入口 */
  async function bootApp() {
    try {
      const me = await (await fetch("/api/me", { cache: "no-store" })).json();
      if (me.ok) {
        currentUser = me.phone;
        await loadUserDataFromServer();
        hideLoginMask();
        renderTopbarUser();
        runAppInit();
      } else {
        showLoginMask();
      }
    } catch (e) {
      showLoginMask();
    }
  }
  bootApp();
})();
