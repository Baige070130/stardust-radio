/*
 * 双人同步（Our Orbit Sync）
 * ------------------------------------------------------------
 * 设计：口令 → 房间号 + 加密密钥；数据加密后写进 GitHub 仓库的一个分支文件里。
 *  - 房间号 = sha256("our-orbit:" + 口令) 前 16 位，口令相同就是同一个房间
 *  - 密钥   = PBKDF2-SHA256(口令, 20 万次) → AES-GCM-256
 *  - 存储   = Baige070130/stardust-radio 仓库 sync-data 分支 sync/<房间号>.json
 *            （专门的分支，不触发 Pages 重新构建；仓库是公开的，但存的是密文）
 *  - 读     = 公开仓库不需要 token；写 = 需要 token（填一次存在本机）
 *  - 冲突   = 按条目合并：待办按 id、记忆按日期、故事取更长、盲盒按日期互补
 */
(function () {
  "use strict";

  const CFG_KEY = "our-orbit-sync-v1";
  const REPO = "Baige070130/stardust-radio";
  const BRANCH = "sync-data";
  const POLL_MS = 8000;
  const PUSH_DELAY = 900;

  /* ---------- 工具 ---------- */
  const enc = (s) => new TextEncoder().encode(s);
  const dec = (b) => new TextDecoder().decode(b);

  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }
  function unb64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256hex(text) {
    const d = await crypto.subtle.digest("SHA-256", enc(text));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function deriveKey(pw) {
    const base = await crypto.subtle.importKey("raw", enc(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc("our-orbit-v1"), iterations: 200000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptJSON(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc(JSON.stringify(obj)));
    return { v: 1, iv: b64(iv), ct: b64(ct) };
  }

  async function decryptJSON(key, env) {
    const iv = unb64(env.iv);
    const ct = unb64(env.ct);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return JSON.parse(dec(pt));
  }

  /* ---------- 合并 ---------- */
  function mergeStates(local, remote) {
    const out = JSON.parse(JSON.stringify(remote || {}));

    // 设备本地字段：谁在用这台设备
    out.who = local.who === "b" ? "b" : "a";
    out.names = (remote && remote.names) || local.names;
    out.start = (remote && remote.start) || local.start;

    // 待办：并集，按 id，时间新的赢；任一为已完成就算完成
    const tmap = new Map();
    [...((remote && remote.todos) || []), ...(local.todos || [])].forEach((t) => {
      if (!t || !t.id) return;
      const prev = tmap.get(t.id);
      if (!prev) { tmap.set(t.id, Object.assign({}, t)); return; }
      const newer = (t.ts || 0) >= (prev.ts || 0) ? Object.assign({}, t, {}) : Object.assign({}, prev);
      const merged = Object.assign({}, prev, t, newer);
      merged.done = !!(t.done || prev.done);
      merged.doneTs = Math.max(t.doneTs || 0, prev.doneTs || 0) || null;
      tmap.set(t.id, merged);
    });
    out.todos = [...tmap.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0));

    // 往期回忆：并集，按日期，有分数的优先
    const hmap = new Map();
    [...((remote && remote.history) || []), ...(local.history || [])].forEach((h) => {
      if (!h || !h.date) return;
      const prev = hmap.get(h.date);
      if (!prev) { hmap.set(h.date, Object.assign({}, h)); return; }
      const pick = h.score != null ? h : prev;
      hmap.set(h.date, Object.assign({}, prev, pick));
    });
    out.history = [...hmap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    // 故事：取更长的
    const rl = ((remote && remote.story) || {}).lines || [];
    const ll = ((local.story || {}).lines) || [];
    out.story = ll.length > rl.length ? local.story : (remote && remote.story) || local.story;

    // 盲盒：同一天就互补，不同天取更近的一天
    const rb = (remote && remote.box) || {};
    const lb = local.box || {};
    if (lb.date && lb.date === rb.date) {
      out.box = {
        date: lb.date,
        qid: lb.qid >= 0 ? lb.qid : rb.qid,
        a: lb.a || rb.a || "",
        b: lb.b || rb.b || "",
        opened: !!(lb.opened || rb.opened),
        scoreA: lb.scoreA || rb.scoreA || 0,
        scoreB: lb.scoreB || rb.scoreB || 0,
        score: lb.score || rb.score || 0
      };
    } else {
      out.box = (lb.date || "") >= (rb.date || "") ? Object.assign({}, lb) : Object.assign({}, rb);
    }

    out.wheel = (remote && remote.wheel) || local.wheel;
    out.v = 2;
    return out;
  }

  /* ---------- 状态 ---------- */
  const S = {
    room: "",
    key: null,
    token: "",
    applying: false,
    pushing: false,
    timer: null,
    pushTimer: null,
    lastTs: 0,
    lastSha: "",
    state: "off", // off | syncing | ok | readonly | error
    message: "未开启",
    listeners: [],
  };

  function persist() {
    try {
      localStorage.setItem(
        CFG_KEY,
        JSON.stringify({ room: S.room, token: S.token, keyB64: S.key ? S.keyB64 : "" })
      );
    } catch (e) {}
  }

  function setStatus(state, message) {
    S.state = state;
    S.message = message;
    S.listeners.forEach((fn) => {
      try { fn(state, message); } catch (e) {}
    });
  }

  /* ---------- GitHub API ---------- */
  function gh(path, opts) {
    opts = opts || {};
    const headers = Object.assign(
      { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      opts.headers || {}
    );
    if (S.token) headers.Authorization = "Bearer " + S.token;
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch("https://api.github.com" + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(async (r) => {
      const text = await r.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) {}
      return { status: r.status, json, text };
    });
  }

  const filePath = () => "sync/" + S.room + ".json";
  const apiPath = (extra) =>
    "/repos/" + REPO + "/contents/" + filePath() + (extra || "");

  async function ensureBranch() {
    if (!S.token) return false;
    const ref = await gh("/repos/" + REPO + "/git/ref/heads/" + BRANCH);
    if (ref.status === 200) return true;
    const main = await gh("/repos/" + REPO + "/git/ref/heads/main");
    if (main.status !== 200 || !main.json || !main.json.object) return false;
    const created = await gh("/repos/" + REPO + "/git/refs", {
      method: "POST",
      body: { ref: "refs/heads/" + BRANCH, sha: main.json.object.sha },
    });
    return created.status === 201 || created.status === 422;
  }

  async function pull(force) {
    if (!S.room || !S.key) return null;
    const r = await gh(apiPath("?ref=" + BRANCH));
    if (r.status === 404) return null;
    if (r.status !== 200 || !r.json || !r.json.content) {
      if (!force) setStatus(S.token ? "error" : "readonly", "读取失败（" + r.status + "）");
      return null;
    }
    S.lastSha = r.json.sha || "";
    let env;
    try {
      const raw = JSON.parse(dec(unb64(r.json.content.replace(/\n/g, ""))));
      env = raw;
      const doc = await decryptJSON(S.key, raw);
      if (!doc || typeof doc !== "object") return null;
      if ((doc.ts || 0) <= S.lastTs && !force) return null;
      S.lastTs = doc.ts || 0;
      return doc.data || null;
    } catch (e) {
      setStatus("error", "口令不对，或数据已损坏");
      return null;
    }
  }

  // 合并云端最新版本到本机，返回合并后的数据（两台设备同时改也不会互相覆盖）
  async function mergeWithRemote() {
    const local = window.OurOrbit && window.OurOrbit.state ? window.OurOrbit.state() : null;
    if (!local) return null;
    const remote = await pull(true);
    if (!remote) return local;
    const merged = mergeStates(local, remote);
    S.applying = true;
    try { window.OurOrbit.applyRemote(merged); } finally { S.applying = false; }
    return merged;
  }

  async function push() {
    if (!S.room || !S.key || !S.token || S.pushing) return;
    S.pushing = true;
    try {
      const ok = await ensureBranch();
      if (!ok) { setStatus("error", "没有写权限（token 无效或过期）"); return; }

      let data = await mergeWithRemote();
      if (!data) return;

      for (let attempt = 0; attempt < 3; attempt++) {
        const ts = Date.now();
        const env = await encryptJSON(S.key, { ts, data });
        const body = {
          message: "sync " + new Date(ts).toISOString(),
          content: b64(enc(JSON.stringify(env))),
          branch: BRANCH,
        };
        const head = await gh(apiPath("?ref=" + BRANCH));
        if (head.status === 200 && head.json && head.json.sha) body.sha = head.json.sha;
        const put = await gh(apiPath(""), { method: "PUT", body });
        if (put.status === 200 || put.status === 201) {
          S.lastTs = ts;
          if (put.json && put.json.content) S.lastSha = put.json.content.sha;
          setStatus("ok", "已同步 · " + new Date().toLocaleTimeString("zh-CN"));
          return;
        }
        if (put.status === 409) {
          // 刚好被对方抢先写了：重新合并再来一次
          const again = await mergeWithRemote();
          if (!again) { setStatus("error", "上传冲突，稍后自动重试"); return; }
          data = again;
          continue;
        }
        setStatus("error", "上传失败（" + put.status + "）");
        return;
      }
      setStatus("error", "上传冲突多次，稍后自动重试");
    } catch (e) {
      setStatus("error", "同步出错：" + (e && e.message ? e.message : e));
    } finally {
      S.pushing = false;
    }
  }

  function scheduleTouch() {
    if (S.pushTimer) clearTimeout(S.pushTimer);
    S.pushTimer = setTimeout(() => { S.pushTimer = null; push(); }, PUSH_DELAY);
  }

  async function syncOnce() {
    const doc = await pull(false);
    if (doc && window.OurOrbit && window.OurOrbit.applyRemote) {
      const local = window.OurOrbit.state();
      const merged = mergeStates(local, doc);
      S.applying = true;
      try { window.OurOrbit.applyRemote(merged); } finally { S.applying = false; }
      setStatus(S.token ? "ok" : "readonly", "已拉取对方更新 · " + new Date().toLocaleTimeString("zh-CN"));
    } else if (S.state === "syncing") {
      setStatus(S.token ? "ok" : "readonly", S.token ? "已连接" : "只读模式（没有 token）");
    }
  }

  /* ---------- 对外 ---------- */
  const api = {
    isApplying: () => S.applying,
    status: () => ({ state: S.state, message: S.message, room: S.room, token: !!S.token }),
    onChange(fn) { S.listeners.push(fn); },

    async start(password, token) {
      if (!password || password.length < 4) { setStatus("error", "口令至少 4 位"); return false; }
      S.room = (await sha256hex("our-orbit:" + password)).slice(0, 16);
      S.key = await deriveKey(password);
      S.keyB64 = b64(await crypto.subtle.exportKey("raw", S.key));
      S.token = token || "";
      S.lastTs = 0;
      persist();
      setStatus("syncing", "正在连接…");
      const doc = await pull(true);
      if (doc && window.OurOrbit && window.OurOrbit.applyRemote) {
        const merged = mergeStates(window.OurOrbit.state(), doc);
        S.applying = true;
        try { window.OurOrbit.applyRemote(merged); } finally { S.applying = false; }
      }
      await push();
      if (S.timer) clearInterval(S.timer);
      S.timer = setInterval(syncOnce, POLL_MS);
      setStatus(S.token ? "ok" : "readonly", S.token ? "已连接 · 房间 " + S.room.slice(0, 6) : "只读模式（没有 token）");
      return true;
    },

    async resume() {
      let cfg = null;
      try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch (e) {}
      if (!cfg || !cfg.room || !cfg.keyB64) return false;
      S.room = cfg.room;
      S.token = cfg.token || "";
      S.keyB64 = cfg.keyB64;
      try {
        S.key = await crypto.subtle.importKey("raw", unb64(cfg.keyB64), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
      } catch (e) {
        setStatus("error", "本机密钥损坏，请重新输入口令");
        return false;
      }
      setStatus("syncing", "正在连接…");
      await syncOnce();
      if (S.timer) clearInterval(S.timer);
      S.timer = setInterval(syncOnce, POLL_MS);
      return true;
    },

    touch() { if (!S.applying) scheduleTouch(); },

    stop() {
      if (S.timer) clearInterval(S.timer);
      if (S.pushTimer) clearTimeout(S.pushTimer);
      S.timer = null;
      S.pushTimer = null;
      S.room = "";
      S.key = null;
      S.keyB64 = "";
      S.token = "";
      S.lastTs = 0;
      persist();
      setStatus("off", "未开启");
    },

    // 测试用
    _test: { mergeStates, sha256hex, deriveKey, encryptJSON, decryptJSON, b64, unb64 },
  };

  window.OurSync = api;
})();
