/* ============================================================
   双人星轨 · Our Orbit
   纯前端 · 数据存 localStorage
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- 小工具 ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad = (n) => String(n).padStart(2, "0");

  function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function dayDiff(aKey, bKey) {
    const a = new Date(aKey + "T00:00:00");
    const b = new Date(bKey + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2200);
  }

  /* ---------------- 状态 ---------------- */
  const KEY = "our-orbit-v1";

  const DEFAULT_STATE = () => ({
    v: 3,
    startChanged: false,
    startChangedAt: 0,
    namesChangedAt: 0,
    names: { a: "我", b: "TA" },
    start: "2026-08-01",
    who: "a",
    box: { date: "", qid: -1, a: "", b: "", opened: false, scoreA: 0, scoreB: 0, score: 0 },
    history: [],
    story: { lines: [], done: false },
    wheel: {
      options: ["火锅", "烧烤", "日料", "家常菜", "外卖", "随便走走"],
      last: null
    },
    todos: [
      { id: "seed1", title: "一起去看一次日出", note: "找个不用早起的周末，带上热咖啡", cat: "仪式感", done: false, ts: Date.now() },
      { id: "seed2", title: "给对方写一封手写信", note: "", cat: "日常", done: false, ts: Date.now() },
      { id: "seed3", title: "去一个都没去过的城市", note: "不用远，隔壁市也行", cat: "旅行", done: false, ts: Date.now() }
    ]
  });

  let state = load();
  save(); // 让迁移结果（比如纪念日修正）立刻落盘

  /** 兼容旧数据 / 破损数据，保证嵌套结构都存在 */
  function normalize(s) {
    if (!s || typeof s !== "object") s = DEFAULT_STATE();
    s.names = Object.assign({ a: "我", b: "TA" }, s.names || {});
    if (!s.start) s.start = todayKey();
    s.box = Object.assign({ date: "", qid: -1, a: "", b: "", opened: false, scoreA: 0, scoreB: 0, score: 0 }, (s.box && typeof s.box === "object") ? s.box : {});
    if (s.box.score && !s.box.scoreA) { s.box.scoreA = s.box.score; s.box.scoreB = s.box.score; }
    if (s.who !== "a" && s.who !== "b") s.who = "a";
    if (!Array.isArray(s.history)) s.history = [];
    if (!s.story || !Array.isArray(s.story.lines)) s.story = { lines: [], done: false };
    if (!s.wheel || !Array.isArray(s.wheel.options) || s.wheel.options.length < 2) {
      s.wheel = { options: ["火锅", "烧烤", "日料", "家常菜", "外卖", "随便走走"], last: null };
    }
    if (!Array.isArray(s.todos)) s.todos = [];

    // v2 迁移：早期版本把纪念日默认成了「第一次打开那天」，
    // 用户手动改过的（startChanged=true）不动，其余统一改为 2026-08-01。
    if (!s.v || s.v < 2) {
      if (!s.startChanged) s.start = "2026-08-01";
      s.v = 2;
      }
      if (s.startChanged && !s.startChangedAt) s.startChangedAt = 1;
      if (!s.namesChangedAt) s.namesChangedAt = 0;
      if (!s.v || s.v < 3) s.v = 3;
      {    }
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return DEFAULT_STATE();
      return normalize(Object.assign(DEFAULT_STATE(), JSON.parse(raw)));
    } catch (e) {
      console.warn("读取本地数据失败，使用默认值", e);
      return DEFAULT_STATE();
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("保存失败", e);
    }
    if (window.OurSync && !window.OurSync.isApplying()) window.OurSync.touch();
  }

  /* ---------------- 背景：星尘 ---------------- */
  const Starfield = (() => {
    const canvas = $("#sky");
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, DPR = 1;
    const COUNT = reduce ? 320 : 760;
    const parts = [];
    const sparks = [];
    const pointer = { x: 0, y: 0, px: 0, py: 0, active: false };
    const TAU = Math.PI * 2;
    const rand = (a, b) => a + Math.random() * (b - a);

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * DPR);
      canvas.height = Math.floor(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (!parts.length) {
        for (let i = 0; i < COUNT; i++) {
          parts.push({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: 0, vy: 0,
            r: rand(0.5, 1.6),
            hue: rand(180, 320),
            seed: Math.random() * TAU,
            wob: rand(0.2, 0.9)
          });
        }
      }
    }

    function burst(x, y, hue = 200) {
      const n = 42;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const sp = rand(1.1, 5.2);
        sparks.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: rand(0.009, 0.021),
          hue: (hue + rand(-30, 30) + 360) % 360,
          r: rand(0.7, 2.2)
        });
      }
      for (const p of parts) {
        const dx = p.x - x, dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 240 * 240) {
          const d = Math.sqrt(d2) || 1;
          const f = (1 - d / 240) * 7;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }
    }

    let t = 0, last = performance.now();
    function loop(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;

      ctx.clearRect(0, 0, W, H);

      const vx = pointer.x - pointer.px;
      const vy = pointer.y - pointer.py;
      pointer.px = pointer.x;
      pointer.py = pointer.y;
      const speed = Math.min(Math.hypot(vx, vy), 50);

      for (const p of parts) {
        // 极缓慢的漂移
        const drift = Math.sin(t * 0.16 * p.wob + p.seed);
        p.vx += drift * 0.004;
        p.vy += Math.cos(t * 0.13 * p.wob + p.seed) * 0.004;

        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 210 * 210) {
            const d = Math.sqrt(d2) || 1;
            const f = 1 - d / 210;
            p.vx += (dx / d) * f * (1.6 + speed * 0.07);
            p.vy += (dy / d) * f * (1.6 + speed * 0.07);
          }
        }

        p.vx *= 0.972;
        p.vy *= 0.972;
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -30) p.x = W + 30;
        else if (p.x > W + 30) p.x = -30;
        if (p.y < -30) p.y = H + 30;
        else if (p.y > H + 30) p.y = -30;

        const sp = Math.hypot(p.vx, p.vy);
        const a = 0.16 + Math.min(sp * 0.09, 0.5);
        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${a})`;
        ctx.arc(p.x, p.y, p.r + Math.min(sp * 0.04, 1.1), 0, TAU);
        ctx.fill();
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.vx *= 0.965;
        s.vy *= 0.965;
        s.vy += 0.02;
        s.x += s.vx;
        s.y += s.vy;
        s.life -= s.decay;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.fillStyle = `hsla(${s.hue}, 100%, 72%, ${s.life * 0.9})`;
        ctx.arc(s.x, s.y, s.r * s.life, 0, TAU);
        ctx.fill();
      }

      if (pointer.active && speed > 2) {
        const g = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 70 + speed * 2);
        g.addColorStop(0, "rgba(124,246,255,0.10)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, 70 + speed * 2, 0, TAU);
        ctx.fill();
      }

      requestAnimationFrame(loop);
    }

    window.addEventListener("pointermove", (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    }, { passive: true });
    window.addEventListener("pointerleave", () => { pointer.active = false; });
    window.addEventListener("resize", resize);

    resize();
    requestAnimationFrame(loop);

    return { burst };
  })();

  function celebrate(el, hue = 300) {
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    Starfield.burst(r.left + r.width / 2, r.top + r.height / 2, hue);
  }

  /* ---------------- 通用渲染 ---------------- */
  function renderChrome() {
    const __other = state.who === "b" ? "a" : "b";
    $("#nameA").textContent = state.names[state.who === "b" ? "b" : "a"] || "我";
    $("#nameB").textContent = state.names[__other] || "TA";
    const avMine = $("#avMine");
    if (avMine) avMine.textContent = ((state.who === "b" ? state.names.b : state.names.a) || "我").slice(0, 3);

    const days = Math.max(1, dayDiff(state.start, todayKey()) + 1);
    $("#dayCount").textContent = `第 ${days} 天`;
  }

  /* ---------------- 选项卡 ---------------- */
  const TAB_KEY = "our-orbit-tab";
  const TABS = ["today", "relay", "wheel", "todo"];

  // 记住当前在哪一页：刷新后停在原处，而不是跳回「默契盲盒」
  function activateTab(name, opts) {
    const target = TABS.indexOf(name) >= 0 ? name : "today";
    $$(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === target)));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + target));
    if (target === "wheel") requestAnimationFrame(() => drawWheel(currentRotation));
    try { localStorage.setItem(TAB_KEY, target); } catch (e) {}
    if (!(opts && opts.silent)) {
      // 地址栏也带上 #today/#relay/...，这样刷新、收藏、发给对方都能定位到同一页
      try { history.replaceState(null, "", "#" + target); } catch (e) { location.hash = target; }
    }
    return target;
  }

  function currentTab() {
    const fromHash = String(location.hash || "").replace(/^#/, "");
    if (TABS.indexOf(fromHash) >= 0) return fromHash;
    let saved = "";
    try { saved = localStorage.getItem(TAB_KEY) || ""; } catch (e) {}
    return TABS.indexOf(saved) >= 0 ? saved : "today";
  }

  function initTabs() {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    });
    window.addEventListener("hashchange", () => {
      const fromHash = String(location.hash || "").replace(/^#/, "");
      if (TABS.indexOf(fromHash) >= 0) activateTab(fromHash, { silent: true });
    });
    activateTab(currentTab(), { silent: true });
  }

  /* ---------------- 默契盲盒 ---------------- */
  const SIM = (a, b) => {
    const norm = (s) => String(s).replace(/[\s\u3000]/g, "").replace(/[，。！？、；：""''（）…—·,.!?;:"'()\-]/g, "").toLowerCase();
    const A = norm(a), B = norm(b);
    if (!A || !B) return 0;
    if (A === B) return 100;
    const grams = (s) => {
      const set = new Set();
      if (s.length === 1) set.add(s);
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };
    const ga = grams(A), gb = grams(B);
    let inter = 0;
    ga.forEach((g) => { if (gb.has(g)) inter++; });
    const jaccard = inter / (ga.size + gb.size - inter);
    const ratio = Math.min(A.length, B.length) / Math.max(A.length, B.length);
    return Math.round((jaccard * 0.72 + ratio * 0.28) * 100);
  };

  function scoreLabel(score) {
    if (score >= 85) return "心有灵犀 · 你们俩想的是同一件事";
    if (score >= 65) return "相当默契 · 大方向完全一致";
    if (score >= 45) return "有点默契 · 细节上各有小算盘";
    if (score >= 25) return "各说各的 · 但也算另一种合拍";
    return "完全两路人 · 所以才有意思";
  }

  function ensureTodayBox() {
    const today = todayKey();
    if (state.box.date !== today) {
      state.box = { date: today, qid: -1, a: "", b: "", opened: false, scoreA: 0, scoreB: 0, score: 0 };
      save();
    }
  }

  function currentQuestion() {
    const list = window.QUESTIONS || [];
    if (!list.length) return "今天想对 TA 说的一句心里话是什么？";
    const idx = state.box.qid >= 0 ? state.box.qid : hashStr(state.box.date) % list.length;
    return list[idx % list.length];
  }

  function streakDays() {
    const dates = new Set(state.history.map((h) => h.date));
    let n = 0;
    const d = new Date();
    for (let i = 0; i < 400; i++) {
      const k = todayKey(d);
      if (dates.has(k)) { n++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return n;
  }

  function renderBox() {
    ensureTodayBox();
    const q = currentQuestion();
    $("#questionText").textContent = q;
    $("#todayDate").textContent = state.box.date;

    const mine = state.who === "b" ? "b" : "a";
    const other = mine === "a" ? "b" : "a";
    const mineName = state.names[mine] || (mine === "a" ? "我" : "TA");
    const otherName = state.names[other] || (other === "a" ? "我" : "TA");

    const whoA = $("#whoA"), whoB = $("#whoB");
    if (whoA && whoB) {
      whoA.textContent = state.names.a || "我";
      whoB.textContent = state.names.b || "TA";
      whoA.classList.toggle("on", mine === "a");
      whoB.classList.toggle("on", mine === "b");
      whoA.setAttribute("aria-pressed", mine === "a" ? "true" : "false");
      whoB.setAttribute("aria-pressed", mine === "b" ? "true" : "false");
    }

    if ($("#whoNote")) $("#whoNote").textContent = "现在以「" + mineName + "」的身份作答";
    if ($("#avMine")) $("#avMine").textContent = mineName.slice(0, 3);
    if ($("#labelMine")) $("#labelMine").textContent = "我的答案";

    const mineBox = $("#ansMine");
    if (mineBox) {
      const cur = state.box[mine] || "";
      if (mineBox.value !== cur) mineBox.value = cur;
      mineBox.placeholder = "只写你自己的答案 —— 填完把设备递给" + otherName;
    }

    const opened = state.box.opened;
    $("#answerArea").hidden = opened;
    $("#boxState").textContent = opened ? "今日已开盒" : "今日未开盒";
    $("#boxState").classList.toggle("live", !opened);
    $("#boxStreak").textContent = "连续 " + streakDays() + " 天";
    $("#dotToday").hidden = opened;

    updateBoxReady();
    renderReveal();
    renderHistory();
  }

  function updateBoxReady() {
    const mine = state.who === "b" ? "b" : "a";
    const other = mine === "a" ? "b" : "a";
    const mineDone = (state.box[mine] || "").trim().length > 0;
    const otherDone = (state.box[other] || "").trim().length > 0;
    const ready = mineDone && otherDone;
    const btn = $("#btnOpenBox");
    if (btn) btn.disabled = !ready;
    const hint = $("#openHint");
    if (!hint) return;
    const otherName = state.names[other] || (other === "a" ? "我" : "TA");
    if (ready) hint.textContent = "两个人都答完了，一起开盒吧";
    else if (mineDone) hint.textContent = "你已答完，等「" + otherName + "」也答一遍";
    else hint.textContent = "两个人都答完才能开盒";
  }

  function renderReveal() {
    const area = $("#revealArea");
    if (!state.box.opened) { area.innerHTML = ""; return; }
    const na = state.names.a || "我";
    const nb = state.names.b || "TA";
    const scored = Number(state.box.score) > 0;

    const scoreBlock = scored
      ? '<div class="score-bar">' +
          '<div class="score-ring" style="--p:' + clamp(state.box.score, 0, 100) + '%">' + state.box.score + '</div>' +
          '<div class="score-text">' +
            '<b>默契指数 ' + state.box.score + '</b>' +
            '<span>' + esc(scoreLabel(state.box.score)) + '</span>' +
            '<span class="rate-detail">' + esc(na) + ' 打 ' + state.box.scoreA + ' 分 · ' + esc(nb) + ' 打 ' + state.box.scoreB + ' 分，取平均</span>' +
          '</div>' +
        '</div>'
      : '<div class="rate-box">' +
          '<div class="rate-title">答案都在这儿了。接下来各自给对方打个分，取平均就是今天的默契指数。</div>' +
          '<label class="rate-row"><span>' + esc(na) + ' 打分</span>' +
            '<input type="range" id="rateA" min="0" max="100" step="5" value="' + (state.box.scoreA || 70) + '">' +
            '<output id="outA">' + (state.box.scoreA || 70) + '</output></label>' +
          '<label class="rate-row"><span>' + esc(nb) + ' 打分</span>' +
            '<input type="range" id="rateB" min="0" max="100" step="5" value="' + (state.box.scoreB || 70) + '">' +
            '<output id="outB">' + (state.box.scoreB || 70) + '</output></label>' +
          '<div class="row" style="margin-top:14px">' +
            '<button class="btn primary" id="btnSaveScore">算出默契分</button>' +
            '<span class="turn-note">两个人都拖一下，再点确认</span>' +
          '</div>' +
        '</div>';

    area.innerHTML = '<div class="reveal">' +
      '<div class="reveal-card"><div class="who">' + esc(na) + ' 说</div>' + esc(state.box.a) + '</div>' +
      '<div class="reveal-card"><div class="who">' + esc(nb) + ' 说</div>' + esc(state.box.b) + '</div>' +
      scoreBlock +
      '<div class="row"><button class="btn ghost small" id="btnResetBox">重新答一次</button></div>' +
    '</div>';

    const resetBtn = $("#btnResetBox");
    if (resetBtn) resetBtn.addEventListener("click", () => {
      state.box.opened = false;
      state.box.score = 0;
      state.box.scoreA = 0;
      state.box.scoreB = 0;
      state.history = state.history.filter((h) => h.date !== state.box.date);
      save();
      renderBox();
    });

    if (!scored) {
      const ra = $("#rateA"), rb = $("#rateB");
      if (ra) ra.addEventListener("input", () => { $("#outA").textContent = ra.value; });
      if (rb) rb.addEventListener("input", () => { $("#outB").textContent = rb.value; });
      const btn = $("#btnSaveScore");
      if (btn) btn.addEventListener("click", () => {
        const sa = ra ? Number(ra.value) : 0;
        const sb = rb ? Number(rb.value) : 0;
        const avg = Math.round((sa + sb) / 2);
        state.box.scoreA = sa;
        state.box.scoreB = sb;
        state.box.score = avg;
        state.history = state.history.filter((h) => h.date !== state.box.date);
        state.history.push({ date: state.box.date, q: currentQuestion(), a: state.box.a, b: state.box.b, score: avg });
        save();
        renderBox();
        celebrate($("#revealArea"), avg >= 60 ? 170 : 320);
        toast("默契指数 " + avg);
      });
    }
  }

  function renderHistory() {
    const list = $("#historyList");
    const items = state.history.slice().sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 6);
    if (!items.length) {
      list.innerHTML = '<div class="empty">还没有往期回忆。<br>今天开第一个盒子吧 🎁</div>';
      return;
    }
    list.innerHTML = items.map((h) =>
      '<div class="hist-item">' +
        '<span class="d">' + esc(h.date.slice(5)) + '</span>' +
        '<span class="q" title="' + esc(h.q) + '">' + esc(h.q.length > 26 ? h.q.slice(0, 26) + "…" : h.q) + '</span>' +
        '<span class="s">' + (h.score == null ? "—" : h.score) + '</span>' +
      '</div>').join("");
  }

  function initBox() {
    const mineBox = $("#ansMine");
    if (mineBox) {
      mineBox.addEventListener("input", () => {
        state.box[state.who === "b" ? "b" : "a"] = mineBox.value;
        save();
        updateBoxReady();
      });
    }

    const pickWho = (w) => () => { state.who = w; save(); renderBox(); };
    const whoA = $("#whoA"), whoB = $("#whoB");
    if (whoA) whoA.addEventListener("click", pickWho("a"));
    if (whoB) whoB.addEventListener("click", pickWho("b"));

    $("#btnOpenBox").addEventListener("click", () => {
      if (!state.box.a.trim() || !state.box.b.trim()) return;
      state.box.opened = true;
      state.box.score = 0;
      state.box.scoreA = 0;
      state.box.scoreB = 0;
      state.history = state.history.filter((h) => h.date !== state.box.date);
      state.history.push({ date: state.box.date, q: currentQuestion(), a: state.box.a, b: state.box.b, score: null });
      save();
      renderBox();
      toast("🎁 开盒啦，看看对方写了什么");
    });

    $("#btnSkipQ").addEventListener("click", () => {
      const n = (window.QUESTIONS || []).length || 1;
      state.box.qid = (hashStr(state.box.date + "|" + Math.random()) % n);
      save();
      renderBox();
      toast("换了一题");
    });
  }

  /* ---------------- 故事接力 ---------------- */
  function renderStory() {
    const box = $("#storyLines");
    const lines = state.story.lines;
    $("#storyCount").textContent = `${lines.length} 句`;

    if (!lines.length) {
      box.innerHTML = `<div class="empty"><span class="big">✒️</span>还没有第一句。<br>写「在一个下雨的傍晚，我们……」开头试试。</div>`;
    } else {
      box.innerHTML = lines.map((l) => `
        <div class="story-line ${l.who}">
          <span class="tag">${esc(l.who === "a" ? (state.names.a || "我") : (state.names.b || "TA")).slice(0, 3)}</span>
          <div class="bubble">${esc(l.text)}</div>
        </div>`).join("");
      box.scrollTop = box.scrollHeight;
    }

    const turn = lines.length % 2 === 0 ? "a" : "b";
    const who = turn === "a" ? (state.names.a || "我") : (state.names.b || "TA");
    $("#turnNote").innerHTML = state.story.done
      ? "这个故事已经写完了 · 想换一个就点「重新开始」"
      : `轮到 <b>${esc(who)}</b> 接一句。`;

    const done = state.story.done;
    $("#storyInputRow").hidden = done;
    $("#btnAddLine").hidden = done;
    $("#btnFinishStory").hidden = done || lines.length < 2;
    $("#storyDone").hidden = !done;
    if (done) {
      $("#storyFinalText").textContent = `共 ${lines.length} 句，${(state.names.a || "我")} 和 ${(state.names.b || "TA")} 一起写的。`;
    }
  }

  function initStory() {
    const input = $("#storyInput");
    const add = () => {
      const text = input.value.trim();
      if (!text) return;
      if (state.story.done) return;
      const turn = state.story.lines.length % 2 === 0 ? "a" : "b";
      state.story.lines.push({ who: turn, text });
      input.value = "";
      save();
      renderStory();
      celebrate($("#storyLines"), turn === "a" ? 190 : 320);
    };
    $("#btnAddLine").addEventListener("click", add);
    input.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") add();
    });

    $("#btnFinishStory").addEventListener("click", () => {
      if (state.story.lines.length < 2) return;
      state.story.done = true;
      save();
      renderStory();
      celebrate($("#storyDone"), 45);
      toast("📖 故事收藏好了");
    });

    $("#btnResetStory").addEventListener("click", () => {
      if (!confirm("重新开始会清掉现在这个故事，确定吗？")) return;
      state.story = { lines: [], done: false };
      save();
      renderStory();
      toast("换一个故事吧");
    });
  }

  /* ---------------- 转盘 ---------------- */
  const WHEEL_COLORS = [
    ["#7cf6ff", "#3fb9d8"],
    ["#b18cff", "#7a54d8"],
    ["#ff9ecd", "#d95c9e"],
    ["#ffd479", "#d9a13f"],
    ["#96f5aa", "#4fbf74"],
    ["#ffa07a", "#d96a45"],
    ["#9fd2ff", "#4a8fd8"],
    ["#e3a0ff", "#a94fd8"]
  ];

  const wheelCanvas = $("#wheel");
  const wctx = wheelCanvas.getContext("2d");
  let currentRotation = 0;
  let spinning = false;

  function drawWheel(rot) {
    const opts = state.wheel.options.filter((o) => o.trim());
    const W = wheelCanvas.width, H = wheelCanvas.height;
    const cx = W / 2, cy = H / 2, R = W * 0.46;
    wctx.clearRect(0, 0, W, H);

    // 外环
    wctx.beginPath();
    wctx.arc(cx, cy, R + 10, 0, Math.PI * 2);
    wctx.strokeStyle = "rgba(160,148,210,0.25)";
    wctx.lineWidth = 2;
    wctx.stroke();

    if (!opts.length) {
      wctx.fillStyle = "rgba(160,148,210,0.6)";
      wctx.font = "600 26px system-ui, sans-serif";
      wctx.textAlign = "center";
      wctx.textBaseline = "middle";
      wctx.fillText("先加几个选项", cx, cy);
      return;
    }

    const n = opts.length;
    const slice = (Math.PI * 2) / n;

    for (let i = 0; i < n; i++) {
      const start = rot + i * slice - Math.PI / 2;
      const end = start + slice;
      const c = WHEEL_COLORS[i % WHEEL_COLORS.length];

      const g = wctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
      g.addColorStop(0, c[0]);
      g.addColorStop(1, c[1]);

      wctx.beginPath();
      wctx.moveTo(cx, cy);
      wctx.arc(cx, cy, R, start, end);
      wctx.closePath();
      wctx.fillStyle = g;
      wctx.fill();
      wctx.strokeStyle = "rgba(5,4,14,0.55)";
      wctx.lineWidth = 2;
      wctx.stroke();

      // 文字
      wctx.save();
      wctx.translate(cx, cy);
      wctx.rotate(start + slice / 2);
      wctx.textAlign = "right";
      wctx.textBaseline = "middle";
      wctx.fillStyle = "rgba(8,10,20,0.88)";
      const label = opts[i].length > 8 ? opts[i].slice(0, 8) + "…" : opts[i];
      wctx.font = `700 ${Math.min(30, 460 / Math.max(n, 4))}px system-ui, "PingFang SC", sans-serif`;
      wctx.fillText(label, R - 26, 0);
      wctx.restore();
    }

    // 中心
    wctx.beginPath();
    wctx.arc(cx, cy, 34, 0, Math.PI * 2);
    wctx.fillStyle = "rgba(8,6,20,0.9)";
    wctx.fill();
    wctx.strokeStyle = "rgba(255,212,121,0.55)";
    wctx.lineWidth = 2;
    wctx.stroke();
    wctx.fillStyle = "#ffd479";
    wctx.font = "700 13px system-ui, sans-serif";
    wctx.textAlign = "center";
    wctx.textBaseline = "middle";
    wctx.fillText("转", cx, cy);
  }

  function renderOptions() {
    const wrap = $("#optionList");
    wrap.innerHTML = "";
    state.wheel.options.forEach((opt, i) => {
      const row = document.createElement("div");
      row.className = "option-row";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = opt;
      inp.maxLength = 16;
      inp.addEventListener("input", () => {
        state.wheel.options[i] = inp.value;
        save();
        drawWheel(currentRotation);
        $("#wheelCount").textContent = `${state.wheel.options.filter((o) => o.trim()).length} 个选项`;
      });
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "×";
      del.title = "删除";
      del.addEventListener("click", () => {
        if (state.wheel.options.length <= 2) { toast("至少留两个选项"); return; }
        state.wheel.options.splice(i, 1);
        save();
        renderOptions();
        drawWheel(currentRotation);
      });
      row.append(inp, del);
      wrap.appendChild(row);
    });
    $("#wheelCount").textContent = `${state.wheel.options.filter((o) => o.trim()).length} 个选项`;
  }

  const easeOut = (x) => 1 - Math.pow(1 - x, 3);

  function initWheel() {
    renderOptions();
    drawWheel(0);
    $("#wheelCount").textContent = `${state.wheel.options.filter((o) => o.trim()).length} 个选项`;

    $("#btnAddOption").addEventListener("click", () => {
      if (state.wheel.options.length >= 8) { toast("最多 8 个选项，够纠结了"); return; }
      state.wheel.options.push("新的选项");
      save();
      renderOptions();
      drawWheel(currentRotation);
    });

    $("#btnSpin").addEventListener("click", () => {
      if (spinning) return;
      const opts = state.wheel.options.filter((o) => o.trim());
      if (opts.length < 2) { toast("至少要有两个选项"); return; }

      spinning = true;
      $("#wheelResult").textContent = "…";
      const n = opts.length;
      const slice = (Math.PI * 2) / n;
      const target = Math.floor(Math.random() * n);

      // 让 target 扇区停在正上方指针处
      const desired = -target * slice - slice / 2;
      const start = currentRotation;
      const extraTurns = 5 + Math.floor(Math.random() * 2);
      let delta = desired - start;
      while (delta < 0) delta += Math.PI * 2;
      delta += Math.PI * 2 * extraTurns;

      const t0 = performance.now();
      const dur = 4200;

      function frame(now) {
        const p = clamp((now - t0) / dur, 0, 1);
        const rot = start + delta * easeOut(p);
        drawWheel(rot);
        if (p < 1) {
          requestAnimationFrame(frame);
        } else {
          currentRotation = start + delta;
          currentRotation %= Math.PI * 2;
          spinning = false;
          const chosen = opts[target];
          state.wheel.last = chosen;
          save();
          $("#wheelResult").textContent = chosen;
          celebrate($("#wheelResult"), 45);
          toast("就它了：" + chosen);
        }
      }
      requestAnimationFrame(frame);
    });
  }

  /* ---------------- 一起去做（清单） ---------------- */
  let todoFilter = "all";

  function renderTodos() {
    const list = $("#todoList");
    const all = state.todos.slice();

    const doneN = all.filter((t) => t.done).length;
    $("#todoCount").textContent = `${all.length} 件`;
    $("#progressNum").textContent = `${doneN} / ${all.length}`;
    $("#progressFill").style.width = all.length ? `${(doneN / all.length) * 100}%` : "0%";

    let items = all;
    if (todoFilter === "todo") items = all.filter((t) => !t.done);
    if (todoFilter === "done") items = all.filter((t) => t.done);
    // 未完成在前
    items = items.slice().sort((a, b) => (a.done === b.done ? b.ts - a.ts : a.done ? 1 : -1));

    if (!items.length) {
      list.innerHTML = `<div class="empty"><span class="big">🌱</span>${
        todoFilter === "done" ? "还没有完成的事，先去勾一个吧" : "清单是空的，写一件想一起做的事"
      }</div>`;
      return;
    }

    list.innerHTML = items.map((t) => `
      <div class="todo-item ${t.done ? "done" : ""}" data-id="${t.id}">
        <button class="check ${t.done ? "on" : ""}" data-act="toggle" title="${t.done ? "标记未完成" : "标记完成"}">✓</button>
        <div class="t-body">
          <div class="t-title">${esc(t.title)}</div>
          ${t.note ? `<div class="t-note">${esc(t.note)}</div>` : ""}
          <div class="t-meta">
            <span class="chip c-${esc(t.cat)}">${esc(t.cat)}</span>
            ${t.done && t.doneTs ? `<span class="chip">完成于 ${new Date(t.doneTs).toLocaleDateString("zh-CN")}</span>` : ""}
          </div>
        </div>
        <div class="t-actions">
          <button class="mini" data-act="edit" title="编辑">✎</button>
          <button class="mini danger" data-act="del" title="删除">🗑</button>
        </div>
      </div>`).join("");

    $$(".todo-item").forEach((el) => {
      const id = el.dataset.id;
      el.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        const idx = state.todos.findIndex((t) => t.id === id);
        if (idx < 0) return;
        const t = state.todos[idx];

        if (act === "toggle") {
          t.done = !t.done;
          t.doneTs = t.done ? Date.now() : null;
          save();
          renderTodos();
          if (t.done) {
            celebrate(el, 165);
            toast("✅ 又完成一件");
          }
        } else if (act === "edit") {
          startEdit(t, el);
        } else if (act === "del") {
          if (!confirm(`删除「${t.title}」？`)) return;
          state.todos.splice(idx, 1);
          save();
          renderTodos();
          toast("已删除");
        }
      });
    });
  }

  function startEdit(t, el) {
    const body = el.querySelector(".t-body");
    body.innerHTML = `
      <input type="text" id="editTitle" maxlength="80" value="${esc(t.title)}" style="margin-bottom:8px" />
      <input type="text" id="editNote" maxlength="120" value="${esc(t.note || "")}" placeholder="备注（可选）" style="margin-bottom:8px" />
      <div class="row">
        <select id="editCat" style="max-width:120px">
          ${["日常", "旅行", "仪式感", "挑战"].map((c) => `<option value="${c}" ${c === t.cat ? "selected" : ""}>${c}</option>`).join("")}
        </select>
        <button class="btn primary small" id="editSave">保存</button>
        <button class="btn ghost small" id="editCancel">取消</button>
      </div>`;
    const titleEl = body.querySelector("#editTitle");
    titleEl.focus();
    titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length);

    body.querySelector("#editSave").addEventListener("click", (e) => {
      e.stopPropagation();
      const title = titleEl.value.trim();
      if (!title) { toast("标题不能为空"); return; }
      t.title = title;
      t.note = body.querySelector("#editNote").value.trim();
      t.cat = body.querySelector("#editCat").value;
      save();
      renderTodos();
      toast("已保存");
    });
    body.querySelector("#editCancel").addEventListener("click", (e) => {
      e.stopPropagation();
      renderTodos();
    });
  }

  function initTodos() {
    const add = () => {
      const title = $("#todoTitle").value.trim();
      if (!title) { toast("先写一件想做的事"); return; }
      state.todos.push({
        id: "t" + Date.now() + Math.random().toString(36).slice(2, 6),
        title,
        note: $("#todoNote").value.trim(),
        cat: $("#todoCat").value,
        done: false,
        ts: Date.now()
      });
      $("#todoTitle").value = "";
      $("#todoNote").value = "";
      save();
      renderTodos();
      celebrate($("#todoList"), 200);
      toast("📌 加进清单了");
    };
    $("#btnAddTodo").addEventListener("click", add);
    $("#todoTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    $("#todoNote").addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });

    $$(".filter").forEach((f) => {
      f.addEventListener("click", () => {
        todoFilter = f.dataset.filter;
        $$(".filter").forEach((x) => x.classList.toggle("on", x === f));
        renderTodos();
      });
    });

    $("#btnClearDone").addEventListener("click", () => {
      const n = state.todos.filter((t) => t.done).length;
      if (!n) { toast("没有已完成的事"); return; }
      if (!confirm(`清空 ${n} 件已完成的事？`)) return;
      state.todos = state.todos.filter((t) => !t.done);
      save();
      renderTodos();
      toast("已清理");
    });

    $("#btnPick").addEventListener("click", () => {
      const left = state.todos.filter((t) => !t.done);
      if (!left.length) { toast("都做完了，加点新的吧 🎉"); return; }
      const pick = left[Math.floor(Math.random() * left.length)];
      todoFilter = "all";
      $$(".filter").forEach((x) => x.classList.toggle("on", x.dataset.filter === "all"));
      renderTodos();
      const el = $(`.todo-item[data-id="${pick.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.borderColor = "rgba(255,212,121,0.75)";
        el.style.boxShadow = "0 0 0 3px rgba(255,212,121,0.16)";
        setTimeout(() => { el.style.borderColor = ""; el.style.boxShadow = ""; }, 2600);
        celebrate(el, 45);
      }
      toast("今天就做这件：" + pick.title);
    });
  }

  /* ---------------- 设置 ---------------- */
  function initSettings() {
    const modal = $("#modalSettings");
    const open = () => {
      const __who = state.who === "b" ? "b" : "a";
      const __other = __who === "a" ? "b" : "a";
      $("#labelNameMe").textContent = "你的名字";
      $("#labelNameOther").textContent = "TA 的名字（" + (__other === "a" ? "A" : "B") + "）";
      $("#inputNameA").value = state.names[__who] || "";
      $("#inputNameB").value = state.names[__other] || "";
      const __swA = $("#setWhoA"), __swB = $("#setWhoB");
      if (__swA) __swA.classList.toggle("on", __who === "a");
      if (__swB) __swB.classList.toggle("on", __who === "b");
      $("#inputStart").value = state.start;
      modal.classList.add("on");
    };
    const close = () => modal.classList.remove("on");

    $("#btnSettings").addEventListener("click", open);
    const setWho = (w) => {
      state.who = w === "b" ? "b" : "a";
      save();
      open();
      renderChrome();
      renderBox();
    };
    const swA = $("#setWhoA"), swB = $("#setWhoB");
    if (swA) swA.addEventListener("click", () => setWho("a"));
    if (swB) swB.addEventListener("click", () => setWho("b"));
    $("#btnCloseSettings").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    $("#btnSaveSettings").addEventListener("click", () => {
      const __oldA = state.names.a, __oldB = state.names.b;
      const __who = state.who === "b" ? "b" : "a";
      const __other = __who === "a" ? "b" : "a";
      const __meName = ($("#inputNameA").value || "").trim();
      const __taName = ($("#inputNameB").value || "").trim();
      state.names[__who] = __meName || (__who === "a" ? "我" : "TA");
      state.names[__other] = __taName || (__other === "a" ? "我" : "TA");
      if (state.names.a !== __oldA || state.names.b !== __oldB) state.namesChangedAt = Date.now();
      const pickedStart = $("#inputStart").value;
      if (pickedStart && pickedStart !== state.start) {
        state.start = pickedStart;
        state.startChanged = true;
        state.startChangedAt = Date.now();
      }
      state.v = 3;
      save();
      renderChrome();
      renderBox();
      renderStory();
      close();
      toast("已保存");
    });

    $("#btnShare").addEventListener("click", async () => {
      try {
        const code = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
        await navigator.clipboard.writeText(code);
        toast("分享码已复制，发给 TA 用「导入」即可");
      } catch (e) {
        const code = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
        window.prompt("复制这段分享码发给 TA：", code);
      }
    });

    $("#btnImport").addEventListener("click", () => {
      const code = window.prompt("粘贴 TA 给你的分享码：");
      if (!code) return;
      try {
        const obj = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
        if (!obj || typeof obj !== "object") throw new Error("bad");
        state = normalize(Object.assign(DEFAULT_STATE(), obj));
        save();
        renderChrome();
        renderBox();
        renderStory();
        renderOptions();
        drawWheel(currentRotation);
        renderTodos();
        close();
        toast("导入成功");
      } catch (e) {
        toast("分享码无效");
      }
    });

    $("#btnWipe").addEventListener("click", () => {
      if (!confirm("会清掉这台设备上的全部数据，确定吗？")) return;
      localStorage.removeItem(KEY);
      state = DEFAULT_STATE();
      save();
      location.reload();
    });
  }

  /* ---------------- 启动 ---------------- */
  function initSync() {
    const sync = window.OurSync;
    const st = $("#syncState");
    const paint = () => {
      if (!sync || !st) return;
      const s = sync.status();
      st.textContent = s.message || "未开启";
      st.dataset.state = s.state;
    };
    if (!sync) { if (st) { st.textContent = "同步模块没加载上（按 Ctrl+F5 强制刷新一次）"; st.dataset.state = "error"; } return; }
    sync.onChange(paint);
    paint();

    const btnOn = $("#btnSyncOn");
    const btnOff = $("#btnSyncOff");
    if (btnOn) {
      btnOn.addEventListener("click", async () => {
        const pw = ($("#syncPass").value || "").trim();
        const tk = ($("#syncToken").value || "").trim();
        if (pw.length < 4) { toast("口令至少 4 位"); return; }
        btnOn.disabled = true;
        try {
          await sync.start(pw, tk);
          toast("双人空间已连接");
        } catch (e) {
          toast("连接失败：" + (e && e.message ? e.message : e));
        } finally {
          btnOn.disabled = false;
          paint();
        }
      });
    }
    if (btnOff) {
      btnOff.addEventListener("click", () => {
        sync.stop();
        const p = $("#syncPass"); if (p) p.value = "";
        const t = $("#syncToken"); if (t) t.value = "";
        paint();
        toast("已退出双人空间");
      });
    }

    sync.resume().then(() => paint());
  }

  function init() {
    renderChrome();
    initTabs();
    initBox();
    initStory();
    initWheel();
    initTodos();
    initSettings();
    initSync();

    renderBox();
    renderStory();
    renderTodos();

    // 跨天自动刷新
    setInterval(() => {
      if (state.box.date !== todayKey()) {
        renderBox();
        toast("新的一天，盲盒刷新了 🎁");
      }
      renderChrome();
    }, 60000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 给外部留一个口子
  window.OurOrbit = {
    state: () => state,
    celebrate,
    Starfield,
    applyRemote(next) {
      state = normalize(Object.assign(DEFAULT_STATE(), next || {}));
      ensureTodayBox();
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
      renderChrome();
      renderBox();
      renderStory();
      renderTodos();
    },
  };
})();
