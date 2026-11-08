(() => {
  "use strict";
  const CP = window.ChordPro;
  const esc = CP.esc;
  const $app = document.getElementById("app");
  const state = { songs: null, setlists: null, query: "", tag: "", sort: "title", dirty: false, hash: location.hash };

  // ---------- Small helpers ----------
  const prefs = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
    },
  };

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function niceDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  // Who's holding this phone: "keys" (keys, bass, vocals) or "guitar". Guitarists see capo shapes.
  const role = () => prefs.get("pw-role", "");
  const isGuitar = () => role() === "guitar";
  // The banner a guitarist sees on a capo song: "Capo 4 · play G shapes".
  function capoBanner(song, shift) {
    const o = chordOpts(song, shift, true);
    if (!o.songCapo) return "";
    const moved = shift && o.capo !== o.songCapo;
    return `<div class="capo-banner"><span class="cb-icon" aria-hidden="true">🎸</span>
      <span><b>${o.capo ? `Capo ${o.capo}` : "No capo"}</b>${o.shapeKey ? ` · play <b>${esc(o.shapeKey)}</b> shapes` : ""}</span>
      ${o.target ? `<small>sounds in ${esc(o.target)}${moved ? ` (capo moved for the new key; the sheet says capo ${o.songCapo} in ${esc(o.base)})` : ""}</small>` : ""}</div>`;
  }
  // Quiet note for everyone else.
  const capoNote = (song) => (song.capo ? `<span class="pill pill-quiet">Guitar uses capo ${song.capo}</span>` : "");

  // How to draw a song's chords. The sheet may be written in capo shapes: "key" is what the band
  // sounds in, "capo" says how far the written shapes sit below it. By default everyone sees the
  // real chords (piano, bass); guitarists can switch to the capo shapes.
  // Easy open-chord shapes for guitar: G, C, D, A, E (Em, Am… count as their relative majors).
  const EASY_SHAPES = [7, 0, 2, 9, 4];
  function bestCapo(targetKey, preferred) {
    const kc = CP.keyCenter(targetKey);
    if (kc === null) return preferred;
    const easy = (c) => EASY_SHAPES.includes((kc - c + 12) % 12);
    if (easy(preferred)) return preferred;
    for (let c = 0; c <= 7; c++) if (easy(c)) return c;
    return preferred;
  }

  function chordOpts(song, shift, shapes) {
    const base = song.key || CP.parse(song.body).meta.key || "";
    const songCapo = song.capo || 0;
    const target = CP.transposeKey(base, shift);
    const showShapes = !!(shapes && songCapo);
    // Transposed? Move the capo so guitar keeps easy shapes (e.g. capo 2 song moved to C = no capo, C shapes).
    const capo = showShapes && shift && target ? bestCapo(target, songCapo) : songCapo;
    const shapeKey = songCapo && target ? CP.transposeKey(target, -capo) : "";
    const shown = showShapes ? shapeKey : target;
    const flats = base ? CP.prefersFlats(shown) : /[A-G]b/.test(song.body);
    return { base, target, capo, songCapo, showShapes, shapeKey, flats, transpose: shift + songCapo - (showShapes ? capo : 0) };
  }

  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

  function shortDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const opts = { month: "short", day: "numeric" };
    if (y !== new Date().getFullYear()) opts.year = "numeric";
    return date.toLocaleDateString(undefined, opts);
  }

  function longDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function daysAgo(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const then = new Date(y, m - 1, d);
    const now = new Date();
    return Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - then) / 86400000);
  }

  // Every date anything was sung, newest first, with the songs sung that day.
  function services(songs) {
    const byDate = new Map();
    for (const s of songs) for (const d of s.sung || []) {
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(s);
    }
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, list]) => ({ date, songs: list.sort(byTitle) }));
  }

  const CHURCH_PLATE = `
    <a class="church-plate" href="https://www.belongatstpaul.org" target="_blank" rel="noopener">
      <img src="/saint-paul-logo.png" alt="Saint Paul United Methodist Church">
    </a>`;

  function setNav(name) {
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      state.dirty = false;
      location.href = "/login?next=" + encodeURIComponent("/" + location.hash);
      throw new Error("Signed out");
    }
    const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
    if (!res.ok) {
      const err = new Error((data && data.error) || `Something went wrong (${res.status}).`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function loadSongs(force) {
    if (!state.songs || force) state.songs = (await api("/api/songs")).songs.sort(byTitle);
    return state.songs;
  }

  function upsert(song) {
    const i = state.songs.findIndex((s) => s.id === song.id);
    if (i >= 0) state.songs[i] = song;
    else state.songs.push(song);
    state.songs.sort(byTitle);
    haystacks.delete(song.id);
  }

  const haystacks = new Map();
  function haystack(s) {
    let h = haystacks.get(s.id);
    if (!h || h.at !== s.updatedAt) {
      h = { at: s.updatedAt, text: [s.title, s.artist, (s.tags || []).join(" "), CP.plainText(s.body)].join("\n").toLowerCase() };
      haystacks.set(s.id, h);
    }
    return h.text;
  }

  // Sticky bars sit right under the header, whatever its real height (status bar, font size).
  const topbar = document.querySelector(".topbar");
  const syncTopbar = () => {
    if (topbar) document.documentElement.style.setProperty("--topbar-full", `${topbar.getBoundingClientRect().height}px`);
  };
  syncTopbar();
  window.addEventListener("resize", syncTopbar);
  window.addEventListener("orientationchange", syncTopbar);
  if (topbar && "ResizeObserver" in window) new ResizeObserver(syncTopbar).observe(topbar);

  // Tap a chord name in any song to see how to play it.
  document.addEventListener("click", (e) => {
    const ch = e.target.closest(".sheet .ch");
    if (!ch || !ch.textContent.trim() || !window.ChordHelp) return;
    if (String(window.getSelection && window.getSelection()).trim()) return; // selecting text, not tapping
    if (window.ChordHelp.open(ch.textContent.trim())) e.stopPropagation();
  }, true);

  // ---------- "I play" ----------
  const roleBtn = document.getElementById("role");
  function drawRole() {
    if (!roleBtn) return;
    const g = isGuitar();
    roleBtn.innerHTML = `<span aria-hidden="true">${g ? "🎸" : "🎹"}</span><span class="role-label">${g ? "Guitar" : "Keys"}</span>`;
    roleBtn.title = g ? "Showing chords for guitar (capo shapes). Tap to switch to keys." : "Showing chords for keys, bass and vocals. Tap to switch to guitar.";
    roleBtn.setAttribute("aria-label", `I play ${g ? "guitar" : "keys, bass or vocals"}. Tap to switch.`);
  }
  function setRole(r, quiet) {
    prefs.set("pw-role", r);
    drawRole();
    if (!quiet) toast(r === "guitar" ? "Guitar view: capo songs show the shapes you play." : "Keys view: real chords for keys, bass and vocals.");
    if (!state.dirty) route();
  }
  if (roleBtn) {
    drawRole();
    roleBtn.addEventListener("click", () => setRole(isGuitar() ? "keys" : "guitar"));
  }
  // Ask once, the first time this phone opens a song (or set) that uses a capo.
  function askRoleIfNeeded(hasCapo) {
    if (!hasCapo || role()) return;
    let dlg = document.getElementById("role-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "role-dialog";
      dlg.className = "lyrics-dialog role-dialog";
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
      <form method="dialog">
        <h2>What do you play?</h2>
        <p class="hint">Some songs are written for guitar with a capo. We'll show you the right chords.</p>
        <button class="btn primary" type="button" data-role="keys">🎹 Keys, bass or vocals</button>
        <p class="fine">You'll see the real chords for the key.</p>
        <button class="btn" type="button" data-role="guitar">🎸 Guitar</button>
        <p class="fine">You'll see the capo and the shapes to play.</p>
        <p class="fine">Change it anytime with the 🎹 / 🎸 button at the top.</p>
      </form>`;
    dlg.onclick = (e) => {
      const b = e.target.closest("[data-role]");
      if (!b) return;
      dlg.close();
      setRole(b.dataset.role, true);
    };
    dlg.addEventListener("cancel", () => setRole("keys", true), { once: true });
    dlg.showModal();
  }

  // ---------- Theme & sign out ----------
  const themeBtn = document.getElementById("theme");
  const THEME_ICONS = { auto: "◐", light: "☀", dark: "☾" };
  function applyTheme(t) {
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    themeBtn.textContent = THEME_ICONS[t];
    themeBtn.title = `Theme: ${t === "auto" ? "match device" : t}`;
  }
  let theme = (() => { try { return localStorage.getItem("pw-theme") || "light"; } catch { return "light"; } })();
  applyTheme(theme);
  themeBtn.addEventListener("click", () => {
    theme = { light: "dark", dark: "auto", auto: "light" }[theme] || "light";
    try { localStorage.setItem("pw-theme", theme); } catch {}
    applyTheme(theme);
  });

  document.getElementById("logout").addEventListener("click", async () => {
    if (state.dirty && !confirm("You have unsaved changes. Sign out anyway?")) return;
    state.dirty = false;
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    location.href = "/login";
  });

  // ---------- Screen wake lock (keeps phones/iPads awake on a song) ----------
  let wakeLock = null;
  let wantWake = false;
  async function setWake(on) {
    wantWake = on;
    try {
      if (on && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      wantWake = false;
    }
    return !!wakeLock;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wantWake && !wakeLock) setWake(true);
  });

  // ---------- Fullscreen "stage" view for phones and tablets ----------
  const stage = { on: false, fs: false, wakeBefore: false, timer: null };
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;

  function showStageBar() {
    const bar = document.getElementById("stagebar");
    if (!bar) return;
    bar.classList.remove("faded");
    clearTimeout(stage.timer);
    stage.timer = setTimeout(() => bar.classList.add("faded"), 4000);
  }

  async function setStage(on) {
    if (on === stage.on) return;
    stage.on = on;
    document.body.classList.toggle("stage", on);
    const root = document.documentElement;
    if (on) {
      stage.wakeBefore = !!wakeLock;
      const request = root.requestFullscreen || root.webkitRequestFullscreen;
      // Don't wait on the browser: some (iPhone Safari, embedded views) never settle or refuse.
      if (request && !fsElement()) {
        try {
          stage.fs = true;
          Promise.resolve(request.call(root)).catch(() => { stage.fs = false; });
        } catch { stage.fs = false; }
      }
      setWake(true);
      window.scrollTo(0, 0);
      showStageBar();
    } else {
      clearTimeout(stage.timer);
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (stage.fs && fsElement() && exit) { try { await exit.call(document); } catch {} }
      stage.fs = false;
      if (!stage.wakeBefore) setWake(false);
    }
  }

  // Leaving browser fullscreen (Esc, system gesture) also leaves the stage view.
  for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) {
    document.addEventListener(ev, () => { if (!fsElement() && stage.on && stage.fs) { stage.fs = false; setStage(false); } });
  }

  // ---------- Autoscroll ----------
  // ctx = { key(): which song is on screen, estimate(): px/second that plays that song in about its length }
  const auto = { on: false, raf: 0, last: 0, acc: 0, ctx: null, wakeBefore: false };
  const ctl = document.createElement("div");
  ctl.className = "scroll-ctl no-print";
  ctl.hidden = true;
  document.body.appendChild(ctl);

  // Default speed: a song lasts about 4 minutes, scaled by its tempo if we know it.
  function estimateSpeed(el, song) {
    const h = el ? el.getBoundingClientRect().height : 1500;
    const bpm = parseInt(song && song.tempo, 10);
    const secs = bpm > 30 && bpm < 240 ? Math.min(360, Math.max(150, (240 * 72) / bpm)) : 240;
    return Math.min(120, Math.max(6, (h - window.innerHeight * 0.4) / secs));
  }
  const autoKey = () => (auto.ctx ? `pw-scroll-${auto.ctx.key()}` : "");
  const autoSpeed = () => (auto.ctx ? prefs.get(autoKey(), 0) || auto.ctx.estimate() : 0);

  function drawCtl() {
    if (!auto.ctx) { ctl.hidden = true; return; }
    const mult = autoSpeed() / auto.ctx.estimate();
    ctl.hidden = false;
    ctl.classList.toggle("playing", auto.on);
    ctl.innerHTML = `
      <button type="button" class="btn icon" data-auto="slower" aria-label="Scroll slower">−</button>
      <button type="button" class="btn icon sc-play" data-auto="toggle" aria-label="${auto.on ? "Pause autoscroll" : "Start autoscroll"}">${auto.on ? "❚❚" : "▶"}</button>
      <button type="button" class="btn icon" data-auto="faster" aria-label="Scroll faster">+</button>
      <span class="sc-speed" aria-live="polite">${mult.toFixed(1)}×</span>
      ${auto.on ? "" : `<button type="button" class="btn icon ghost" data-auto="close" aria-label="Hide autoscroll">✕</button>`}`;
  }

  function tick(ts) {
    if (!auto.on) return;
    // Hold still while a chord pop-up or the lyrics dialog is open.
    if (auto.last && !document.querySelector("dialog[open]")) {
      const dt = Math.min(0.1, (ts - auto.last) / 1000);
      auto.acc += autoSpeed() * dt;
      const step = Math.floor(auto.acc);
      if (step >= 1) { auto.acc -= step; window.scrollBy(0, step); }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        stopAuto();
        toast("That's the end.");
        return;
      }
    }
    auto.last = ts;
    auto.raf = requestAnimationFrame(tick);
  }

  function startAuto(ctx) {
    if (ctx) auto.ctx = ctx;
    if (!auto.ctx || auto.on) return;
    auto.on = true;
    auto.last = 0;
    auto.acc = 0;
    auto.wakeBefore = !!wakeLock;
    setWake(true);
    drawCtl();
    auto.raf = requestAnimationFrame(tick);
  }

  function stopAuto(hide) {
    if (auto.on) {
      auto.on = false;
      cancelAnimationFrame(auto.raf);
      if (!auto.wakeBefore && !stage.on) setWake(false);
    }
    if (hide) auto.ctx = null;
    drawCtl();
  }

  ctl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-auto]");
    if (!b || !auto.ctx) return;
    const act = b.dataset.auto;
    if (act === "toggle") return auto.on ? stopAuto() : startAuto();
    if (act === "close") return stopAuto(true);
    const next = Math.min(150, Math.max(3, autoSpeed() * (act === "faster" ? 1.15 : 1 / 1.15)));
    prefs.set(autoKey(), next); // remembered for this song on this phone
    drawCtl();
  });

  // Space bar (or a Bluetooth page-turner set to space) starts/pauses when a song or set is open.
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.repeat || !auto.ctx) return;
    if (e.target.closest && e.target.closest("input, textarea, select, button, [contenteditable]")) return;
    e.preventDefault();
    auto.on ? stopAuto() : startAuto();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && auto.on) stopAuto(); });

  // ---------- Router ----------
  async function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    if (stage.on) await setStage(false);
    stopAuto(true);
    if (parts[0] !== "song") setWake(false);
    try {
      setNav(!parts.length || parts[0] === "song" || parts[0] === "set" ? "songs" : parts[0] === "stats" ? "stats" : "");
      if (!parts.length) await renderList();
      else if (parts[0] === "stats") await renderStats();
      else if (parts[0] === "set" && parts[1] && parts[2] === "edit") await renderSetEditor(parts[1]);
      else if (parts[0] === "set" && parts[1]) await renderSet(parts[1], { print: parts[2] === "print", jump: Number(parts[2]) || 0 });
      else if (parts[0] === "song" && parts[1]) await renderSong(parts[1]);
      else if (parts[0] === "new") await renderEditor(null);
      else if (parts[0] === "edit" && parts[1]) await renderEditor(parts[1]);
      else location.hash = "#/";
    } catch (e) {
      if (e.message === "Signed out") return;
      $app.innerHTML = `<div class="empty"><h2>Hmm.</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back to all songs</a></div>`;
    }
  }

  window.addEventListener("hashchange", () => {
    if (state.dirty) {
      if (!confirm("You have unsaved changes. Leave without saving?")) {
        history.replaceState(null, "", state.hash || "#/");
        return;
      }
      state.dirty = false;
    }
    state.hash = location.hash;
    window.scrollTo(0, 0);
    route();
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------- List ----------
  async function renderList() {
    if (!state.songs) $app.innerHTML = `<div class="loading">Loading songs…</div>`;
    await loadAll();
    const songs = state.songs;
    $app.onclick = null;
    document.title = "Praise & Worship · St. Paul UMC";
    const [next, ...later] = upcomingSets();
    const setSection = next
      ? setCardHtml(next, songs) + (later.length ? `<p class="later-sets">Also planned: ${later.map((x) => `<a href="#/set/${encodeURIComponent(x.id)}">${esc(shortDate(x.date))}</a>`).join(" · ")}</p>` : "")
      : `<button class="plan-set no-print" type="button" id="plan-set"><span>+ Plan the next set</span><small>Pick songs for a Sunday</small></button>`;

    if (!songs.length) {
      $app.innerHTML = `
        <div class="empty">
          <p class="eyebrow">St. Paul UMC · Praise &amp; Worship</p>
          <h2>Our songbook is ready</h2>
          <p>Add the first song. You can paste a chord sheet straight from anywhere and it will line the chords up for you.</p>
          <a class="btn primary" href="#/new">+ Add a song</a>
        </div>`;
      return;
    }

    const tags = [...new Set(songs.flatMap((s) => s.tags || []))].sort((a, b) => a.localeCompare(b));
    if (state.tag && !tags.includes(state.tag)) state.tag = "";
    $app.innerHTML = `
      ${setSection}
      <section class="list-head">
        <div>
          <p class="eyebrow">St. Paul UMC · Praise &amp; Worship</p>
          <h1>Our songs</h1>
        </div>
        <div class="head-actions no-print">
          <button class="btn" type="button" id="print-list">Print list</button>
          <a class="btn primary" href="#/new">+ Add a song</a>
        </div>
      </section>
      ${(() => {
        const last = services(songs)[0];
        if (!last) return `<p class="last-service empty-ls">Open a song and add the dates you sang it. The most recent one shows up here.</p>`;
        return `<a class="last-service" href="#/stats">
          <span class="ls-label">Last sang</span>
          <span class="ls-date">${esc(longDate(last.date))}</span>
          <span class="ls-songs">${last.songs.map((s) => esc(s.title)).join(" · ")}</span>
          <span class="ls-more no-print">See stats →</span>
        </a>`;
      })()}
      <div class="filters no-print">
        <input type="search" id="q" placeholder="Search titles, artists, lyrics…" value="${esc(state.query)}" autocomplete="off" aria-label="Search songs">
        <select id="sort" aria-label="Sort songs">
          <option value="title">A–Z</option>
          <option value="sung">Recently sung</option>
          <option value="most">Most sung</option>
          <option value="added">Recently added</option>
        </select>
      </div>
      ${tags.length ? `<div class="chips no-print">${tags.map((t) => `<button type="button" class="chip${state.tag === t ? " on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
      <p class="count" id="count"></p>
      <ul class="song-list" id="list"></ul>
      <footer class="list-foot no-print">
        <button type="button" class="link" id="export">Download a backup of every song</button>
        <span aria-hidden="true"> · </span>
        <button type="button" class="link" id="import">Import chord files or a backup</button>
        <span aria-hidden="true"> · </span>
        <a class="link" href="/install">Put this on your phone</a>
        <input type="file" id="import-files" multiple accept=".cho,.chordpro,.chopro,.crd,.pro,.txt,.json,text/plain,application/json" hidden>
        ${CHURCH_PLATE}
      </footer>`;

    const $q = document.getElementById("q");
    const $sort = document.getElementById("sort");
    $sort.value = state.sort;

    function draw() {
      const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
      let list = songs.filter((s) => (!state.tag || (s.tags || []).includes(state.tag)) && terms.every((t) => haystack(s).includes(t)));
      if (state.sort === "sung") list = [...list].sort((a, b) => ((b.sung || [])[0] || "").localeCompare((a.sung || [])[0] || "") || byTitle(a, b));
      if (state.sort === "most") list = [...list].sort((a, b) => (b.sung || []).length - (a.sung || []).length || byTitle(a, b));
      if (state.sort === "added") list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      document.getElementById("count").textContent =
        list.length === songs.length ? `${songs.length} song${songs.length === 1 ? "" : "s"}` : `${list.length} of ${songs.length} songs`;
      document.getElementById("list").innerHTML = list.length
        ? list.map((s) => {
            const last = (s.sung || [])[0];
            const times = (s.sung || []).length;
            return `<li><a href="#/song/${encodeURIComponent(s.id)}">
              <span class="t">${esc(s.title)}</span>
              <span class="a">${esc(s.artist)}</span>
              <span class="when${last ? "" : " never"}">${last
                ? `<small>Last sung</small>${esc(shortDate(last))}${state.sort === "most" ? ` · ${times}×` : ""}`
                : "Not sung yet"}</span>
              <span class="k" title="Our key">${esc(s.key)}</span></a></li>`;
          }).join("")
        : `<li class="empty">No songs match that search.</li>`;
    }

    $q.addEventListener("input", () => { state.query = $q.value; draw(); });
    $sort.addEventListener("change", () => { state.sort = $sort.value; draw(); });
    $app.querySelectorAll(".chip").forEach((b) =>
      b.addEventListener("click", () => {
        state.tag = state.tag === b.dataset.tag ? "" : b.dataset.tag;
        $app.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.tag === state.tag));
        draw();
      })
    );
    document.getElementById("export").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), songs, setlists: state.setlists || [] }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `praise-and-worship-songs-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    document.getElementById("print-list").addEventListener("click", () => window.print());
    const planBtn = document.getElementById("plan-set");
    if (planBtn) planBtn.addEventListener("click", () => planSet().catch((err) => toast(err.message)));
    const $files = document.getElementById("import-files");
    document.getElementById("import").addEventListener("click", () => $files.click());
    $files.addEventListener("change", async () => {
      const files = [...$files.files];
      $files.value = "";
      if (!files.length) return;
      const existing = new Set(songs.map((s) => s.title.trim().toLowerCase()));
      let added = 0;
      const skipped = [];
      toast(`Importing ${files.length} file${files.length === 1 ? "" : "s"}…`);
      const titleToId = new Map(songs.map((s) => [s.title.trim().toLowerCase(), s.id]));
      const backups = [];
      for (const file of files) {
        try {
          if (/\.json$/i.test(file.name)) {
            // A backup from "Download a backup of every song": restore songs (with their dates) and upcoming sets.
            const data = JSON.parse(await file.text());
            if (!Array.isArray(data.songs)) throw new Error("not a songbook backup");
            const idMap = new Map();
            for (const old of data.songs) {
              const key = String(old.title || "").trim().toLowerCase();
              if (!key) continue;
              if (titleToId.has(key)) { idMap.set(old.id, titleToId.get(key)); skipped.push(`${old.title} (already in the songbook)`); continue; }
              const { song } = await api("/api/songs", {
                method: "POST",
                body: {
                  title: old.title, artist: old.artist, key: old.key, tempo: old.tempo, time: old.time, capo: old.capo,
                  tags: old.tags, link: old.link, notes: old.notes, body: old.body, sung: old.sung,
                },
              });
              upsert(song);
              titleToId.set(key, song.id);
              idMap.set(old.id, song.id);
              added++;
            }
            backups.push({ data, idMap });
            continue;
          }
          let body = await file.text();
          if (CP.looksLikeChordsOverLyrics(body)) body = CP.toChordPro(body);
          const meta = CP.parse(body).meta;
          const title = (meta.title || file.name.replace(/\.[^.]+$/, "")).trim();
          if (existing.has(title.toLowerCase())) { skipped.push(`${title} (already in the songbook)`); continue; }
          const { song } = await api("/api/songs", {
            method: "POST",
            body: { title, artist: meta.artist || "", key: meta.key || "", tempo: meta.tempo || "", time: meta.time || "", capo: parseInt(meta.capo, 10) || 0, body },
          });
          upsert(song);
          existing.add(title.toLowerCase());
          titleToId.set(title.toLowerCase(), song.id);
          added++;
        } catch (err) {
          if (err.message === "Signed out") return;
          skipped.push(`${file.name} (${err.message})`);
        }
      }
      let setsAdded = 0;
      if (backups.length) {
        const current = await loadSetlists(true);
        const t = today();
        for (const { data, idMap } of backups) {
          for (const old of data.setlists || []) {
            if (!old.date || old.date < t || old.done) continue;
            if (current.some((x) => x.date === old.date)) { skipped.push(`Set for ${old.date} (one already exists for that date)`); continue; }
            const items = (old.items || []).filter((it) => idMap.has(it.songId)).map((it) => ({ songId: idMap.get(it.songId), shift: it.shift || 0 }));
            try {
              const { setlist } = await api("/api/setlists", { method: "POST", body: { date: old.date, title: old.title, notes: old.notes, items } });
              upsertSet(setlist);
              setsAdded++;
            } catch (err) { skipped.push(`Set for ${old.date} (${err.message})`); }
          }
        }
      }
      await renderList();
      toast(`Imported ${added} song${added === 1 ? "" : "s"}${setsAdded ? ` and ${setsAdded} set${setsAdded === 1 ? "" : "s"}` : ""}${skipped.length ? `, skipped ${skipped.length}` : ""}.`);
      if (skipped.length) alert(`These weren't imported:\n\n${skipped.join("\n")}`);
    });
    draw();
  }

  // ---------- Song view ----------
  async function findSong(id) {
    let song = (await loadSongs()).find((s) => s.id === id);
    if (!song) song = (await loadSongs(true)).find((s) => s.id === id);
    if (!song) throw new Error("We couldn't find that song. It may have been deleted.");
    return song;
  }

  async function renderSong(id) {
    if (!state.songs) $app.innerHTML = `<div class="loading">Loading…</div>`;
    let song = await findSong(id);
    const view = prefs.get("pw-view", { size: 19, chords: true, cols: false });
    let shift = prefs.get(`pw-tr-${id}`, 0);
    await loadSetlists().catch(() => {});
    const setBtn = () => {
      const next = upcomingSets()[0];
      if (!next) return "";
      const inSet = next.items.some((it) => it.songId === song.id);
      return inSet
        ? `<a class="btn" href="#/set/${encodeURIComponent(next.id)}" title="Open that set">✓ In ${esc(shortDate(next.date))} set</a>`
        : `<button class="btn" data-act="addset" type="button">+ Add to ${esc(shortDate(next.date))} set</button>`;
    };
    const opts = () => chordOpts(song, shift, isGuitar());

    function sheetHtml() {
      const o = opts();
      return CP.render(song.body, { transpose: o.transpose, flats: o.flats });
    }

    function keyLabel() {
      const o = opts();
      const key = o.base;
      const shapes = o.showShapes ? ` <small>${esc(o.shapeKey)} shapes</small>` : "";
      if (!shift) return key ? `<small>Key</small>${esc(key)}${shapes}` : `<small>Transpose</small>0`;
      const sign = shift > 0 ? `+${shift}` : `${shift}`;
      // Changed from the original: say what it was, and that a tap brings it back.
      return key
        ? `<small>was ${esc(key)} ↺</small>${esc(o.target)}${shapes}`
        : `<small>was 0 ↺</small>${sign}`;
    }
    const keyBtn = (extra = "") =>
      `<button type="button" class="keyout${shift ? " changed" : ""}" data-act="reset" ${shift ? "" : "disabled"} ${extra}
        aria-label="${shift ? `Transposed from the original key. Tap to go back to ${esc(opts().base || "the original")}` : "Original key"}">${keyLabel()}</button>`;

    function draw() {
      document.title = `${song.title} · Praise & Worship`;
      const sung = song.sung || [];
      const meta = [
        song.key && `<span class="pill">Our key <b>${esc(song.key)}</b></span>`,
        !isGuitar() && capoNote(song),
        song.tempo && `<span class="pill">Tempo <b>${esc(song.tempo)}</b></span>`,
        song.time && `<span class="pill">Time <b>${esc(song.time)}</b></span>`,
        ...(song.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`),
        song.link && `<span class="pill"><a href="${esc(song.link)}" target="_blank" rel="noopener noreferrer">Listen / reference ↗</a></span>`,
      ].filter(Boolean).join("");
      const wakeSupported = "wakeLock" in navigator;
      const sungPanel = `
        <details class="sung no-print" id="sungpanel"${sungOpen ? " open" : ""}>
          <summary>
            <span class="sung-last">${sung.length ? `Last sung <b>${esc(niceDate(sung[0]))}</b>` : "Not sung yet"}</span>
            ${sung.length ? `<span class="sung-count">${sung.length} time${sung.length === 1 ? "" : "s"}</span>` : ""}
            <span class="sung-add">+ Add a date</span>
          </summary>
          <div class="sung-body">
            <form class="sung-form" id="sungform">
              <label for="sung-date">Date we sang it</label>
              <div class="sung-row">
                <input type="date" id="sung-date" value="${today()}" max="${today()}" required>
                <button class="btn primary" type="submit">Add date</button>
                ${sung[0] === today() ? "" : `<button class="btn" data-act="sung" type="button">Today</button>`}
              </div>
            </form>
            ${sung.length ? `<ul class="sung-dates">${sung.map((d) => `<li><span>${esc(longDate(d))}</span><button class="link" type="button" data-remove="${d}">Remove</button></li>`).join("")}</ul>` : ""}
          </div>
        </details>`;

      $app.innerHTML = `
        <a class="back" href="#/">← All songs</a>
        <header class="song-head">
          <h1>${esc(song.title)}</h1>
          ${song.artist ? `<p class="by">${esc(song.artist)}</p>` : ""}
          ${isGuitar() ? `<div id="capobanner">${capoBanner(song, shift)}</div>` : ""}
          ${meta ? `<div class="meta">${meta}</div>` : ""}
          ${sungPanel}
        </header>
        <div class="toolbar">
          <div class="toolgroup" role="group" aria-label="Transpose">
            <button class="btn icon" data-act="down" type="button" aria-label="Transpose down a half step">−</button>
            ${keyBtn('aria-live="polite"')}
            <button class="btn icon" data-act="up" type="button" aria-label="Transpose up a half step">+</button>
          </div>
          <div class="toolgroup" role="group" aria-label="Text size">
            <button class="btn icon" data-act="smaller" type="button" aria-label="Smaller text">A−</button>
            <button class="btn icon" data-act="bigger" type="button" aria-label="Bigger text">A+</button>
          </div>
          <button class="btn" data-act="chords" type="button" aria-pressed="${view.chords}">Chords</button>
          <button class="btn hide-sm" data-act="cols" type="button" aria-pressed="${view.cols}" title="Two columns on wide screens">Columns</button>
          ${wakeSupported ? `<button class="btn" data-act="wake" type="button" aria-pressed="${!!wakeLock}" title="Stop the screen from dimming">Keep awake</button>` : ""}
          <div class="spacer"></div>
          <button class="btn" data-act="autoscroll" type="button" title="Scroll the song by itself (space bar works too)">▶ Autoscroll</button>
          <button class="btn primary" data-act="stage" type="button" title="Fill the screen with just the song">⛶ Fullscreen</button>
          <button class="btn" data-act="print" type="button">Print</button>
          <button class="btn" data-act="lyrics" type="button">Lyrics only</button>
          ${setBtn()}
          <a class="btn" href="#/edit/${encodeURIComponent(song.id)}">Edit</a>
        </div>
        ${song.notes ? `<div class="notes"><strong>Arrangement notes</strong>${esc(song.notes)}</div>` : ""}
        <article class="sheet${view.chords ? "" : " hide-chords"}${view.cols ? " cols" : ""}" id="sheet" style="--size:${view.size}px">${sheetHtml()}</article>

        <div class="stage-bar" id="stagebar" role="toolbar" aria-label="Fullscreen controls">
          <button class="btn icon" data-act="down" type="button" aria-label="Transpose down">−</button>
          ${keyBtn()}
          <button class="btn icon" data-act="up" type="button" aria-label="Transpose up">+</button>
          <span class="sep" aria-hidden="true"></span>
          <button class="btn icon" data-act="smaller" type="button" aria-label="Smaller text">A−</button>
          <button class="btn icon" data-act="bigger" type="button" aria-label="Bigger text">A+</button>
          <span class="sep" aria-hidden="true"></span>
          <button class="btn icon" data-act="autoscroll" type="button" aria-label="Autoscroll">▶</button>
          <button class="btn" data-act="stage" type="button">Exit</button>
        </div>`;
    }

    let sungOpen = false;
    function wireSung() {
      const panel = document.getElementById("sungpanel");
      panel.addEventListener("toggle", () => { sungOpen = panel.open; });
      document.getElementById("sungform").addEventListener("submit", async (e) => {
        e.preventDefault();
        const date = document.getElementById("sung-date").value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast("Pick a date first.");
        if ((song.sung || []).includes(date)) return toast(`${niceDate(date)} is already on the list.`);
        try {
          await patch({ addSung: date });
          toast(`Added ${niceDate(date)}.`);
        } catch (err) { toast(err.message); }
      });
    }

    function redrawSheet() {
      document.getElementById("sheet").innerHTML = sheetHtml();
      const cb = document.getElementById("capobanner");
      if (cb) cb.innerHTML = capoBanner(song, shift);
      document.querySelectorAll(".keyout").forEach((o) => {
        o.innerHTML = keyLabel();
        o.classList.toggle("changed", !!shift);
        o.disabled = !shift;
        o.setAttribute("aria-label", shift ? `Transposed from the original key. Tap to go back to ${opts().base || "the original"}` : "Original key");
      });
    }

    async function patch(body) {
      song = (await api(`/api/songs/${encodeURIComponent(song.id)}`, { method: "PATCH", body })).song;
      upsert(song);
      draw();
      wireSung();
    }

    $app.onclick = async (e) => {
      if (stage.on) showStageBar();
      const btn = e.target.closest("[data-act], [data-remove]");
      if (!btn) return;
      const sheet = document.getElementById("sheet");
      switch (btn.dataset.act) {
        case "autoscroll":
          if (auto.on) stopAuto();
          else startAuto({ key: () => song.id, estimate: () => estimateSpeed(document.getElementById("sheet"), song) });
          break;
        case "reset":
          if (!shift) break;
          shift = 0;
          prefs.set(`pw-tr-${id}`, 0);
          redrawSheet();
          toast(`Back to the original key${opts().base ? `, ${opts().base}` : ""}.`);
          break;
        case "up": case "down":
          shift = (((shift + (btn.dataset.act === "up" ? 1 : -1)) % 12) + 12) % 12;
          if (shift > 6) shift -= 12;
          prefs.set(`pw-tr-${id}`, shift);
          redrawSheet();
          break;
        case "smaller": case "bigger":
          view.size = Math.min(34, Math.max(13, view.size + (btn.dataset.act === "bigger" ? 2 : -2)));
          sheet.style.setProperty("--size", `${view.size}px`);
          prefs.set("pw-view", view);
          break;
        case "chords":
          view.chords = !view.chords;
          sheet.classList.toggle("hide-chords", !view.chords);
          btn.setAttribute("aria-pressed", view.chords);
          prefs.set("pw-view", view);
          break;
        case "cols":
          view.cols = !view.cols;
          sheet.classList.toggle("cols", view.cols);
          btn.setAttribute("aria-pressed", view.cols);
          prefs.set("pw-view", view);
          break;
        case "wake": {
          const on = await setWake(!wakeLock);
          btn.setAttribute("aria-pressed", on);
          toast(on ? "Screen will stay on while this song is open." : "Screen can sleep normally again.");
          break;
        }
        case "print": window.print(); break;
        case "lyrics":
          LyricsExport.open([song], { filename: `lyrics-${song.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, toast });
          break;
        case "stage": await setStage(!stage.on); break;
        case "addset": {
          const next = upcomingSets()[0];
          if (!next) break;
          next.items.push({ songId: song.id, shift });
          try {
            await saveSet(next);
            toast(`Added to the ${fullDate(next.date)} set${shift ? " in the key you're viewing" : ""}.`);
            btn.outerHTML = setBtn();
          } catch (err) { next.items.pop(); toast(err.message); }
          break;
        }
        case "sung":
          btn.disabled = true;
          try { await patch({ addSung: today() }); toast("Added today."); }
          catch (err) { btn.disabled = false; toast(err.message); }
          break;
        default:
          if (btn.dataset.remove && confirm(`Remove ${niceDate(btn.dataset.remove)} from this song's history?`)) {
            try { await patch({ removeSung: btn.dataset.remove }); } catch (err) { toast(err.message); }
          }
      }
    };
    draw();
    wireSung();
    askRoleIfNeeded(!!song.capo);
    if (shift && opts().base) {
      toast(`Showing in ${opts().target}, the key you moved it to last time (original ${opts().base}). Tap the key to go back.`);
    }
  }

  // ---------- Set lists ----------
  async function loadSetlists(force) {
    if (!state.setlists || force) state.setlists = (await api("/api/setlists")).setlists;
    return state.setlists;
  }

  // Songs first: loading them also settles past sets on the server (adds "last sung" dates).
  async function loadAll(force) {
    await loadSongs(force);
    await loadSetlists(force);
  }

  function upcomingSets() {
    const t = today();
    return (state.setlists || []).filter((s) => s.date >= t).sort((a, b) => a.date.localeCompare(b.date));
  }

  function upsertSet(set) {
    const list = state.setlists || (state.setlists = []);
    const i = list.findIndex((s) => s.id === set.id);
    if (i >= 0) list[i] = set;
    else list.push(set);
  }

  async function saveSet(set) {
    const { setlist } = await api(`/api/setlists/${encodeURIComponent(set.id)}`, {
      method: "PUT",
      body: { date: set.date, title: set.title, notes: set.notes, items: set.items },
    });
    upsertSet(setlist);
    return setlist;
  }

  function nextSunday() {
    const d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function fullDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const opts = { weekday: "long", month: "long", day: "numeric" };
    if (y !== new Date().getFullYear()) opts.year = "numeric";
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
  }

  function whenLabel(iso) {
    const n = -daysAgo(iso);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n < 0) return "Past";
    return `In ${n} days`;
  }

  function keyFor(song, shift) {
    return chordOpts(song, shift, false);
  }

  async function planSet() {
    const { setlist } = await api("/api/setlists", { method: "POST", body: { date: nextSunday(), items: [] } });
    upsertSet(setlist);
    location.hash = `#/set/${encodeURIComponent(setlist.id)}/edit`;
  }

  function setCardHtml(set, songs) {
    const byId = new Map(songs.map((s) => [s.id, s]));
    const items = set.items.map((it, i) => ({ ...it, i, song: byId.get(it.songId) })).filter((x) => x.song);
    const sid = encodeURIComponent(set.id);
    return `
      <section class="setcard" aria-label="Next set list">
        <div class="sc-top">
          <p class="sc-eyebrow">Next set · ${esc(whenLabel(set.date))}</p>
          <h2 class="sc-date">${esc(fullDate(set.date))}</h2>
          ${set.title ? `<p class="sc-title">${esc(set.title)}</p>` : ""}
        </div>
        ${items.length ? `
          <ol class="sc-songs">
            ${items.map((x, n) => `
              <li><a href="#/set/${sid}/${x.i + 1}">
                <span class="sc-n">${n + 1}</span>
                <span class="sc-t">${esc(x.song.title)}${x.song.artist ? `<small>${esc(x.song.artist)}</small>` : ""}</span>
                <span class="sc-k">${esc(keyFor(x.song, x.shift).target || "")}${isGuitar() && x.song.capo ? `<small>capo ${x.song.capo}</small>` : ""}</span>
              </a></li>`).join("")}
          </ol>` : `<p class="sc-empty">No songs picked yet.</p>`}
        <div class="sc-actions">
          ${items.length ? `<a class="btn sc-main" href="#/set/${sid}">Open set</a>
          <a class="btn" href="#/set/${sid}/print">Print all</a>` : ""}
          <a class="btn${items.length ? "" : " sc-main"}" href="#/set/${sid}/edit">${items.length ? "Edit" : "+ Add songs"}</a>
        </div>
      </section>`;
  }

  async function renderSet(id, opts = {}) {
    if (!state.songs || !state.setlists) $app.innerHTML = `<div class="loading">Loading set…</div>`;
    await loadAll();
    let set = state.setlists.find((s) => s.id === id);
    if (!set) {
      await loadSetlists(true);
      set = state.setlists.find((s) => s.id === id);
    }
    if (!set) throw new Error("That set list is gone. Sets clear off once their date has passed.");
    const view = prefs.get("pw-view", { size: 19, chords: true, cols: false });
    const sid = encodeURIComponent(set.id);
    let saveTimer;

    const songOf = (it) => state.songs.find((s) => s.id === it.songId);
    const keyHtml = (song, shift) => {
      const k = keyFor(song, shift);
      if (!shift) return k.base ? `<small>Key</small>${esc(k.base)}` : `<small>Transpose</small>0`;
      return k.base ? `<small>was ${esc(k.base)} ↺</small>${esc(k.target)}` : `<small>was 0 ↺</small>${shift > 0 ? "+" : ""}${shift}`;
    };
    const setKeyLabel = (song, shift) =>
      shift ? `Set key changed from the original. Tap to go back to ${keyFor(song, 0).base || "the original"} for everyone` : "Original key";
    const sheetHtml = (song, shift) => {
      const o = chordOpts(song, shift, isGuitar());
      return CP.render(song.body, { transpose: o.transpose, flats: o.flats });
    };
    const anyCapo = () => set.items.some((it) => (songOf(it) || {}).capo);

    function draw() {
      document.title = `${fullDate(set.date)} set · Praise & Worship`;
      const sheetClass = `sheet${view.chords ? "" : " hide-chords"}`;
      $app.innerHTML = `
        <a class="back" href="#/">← All songs</a>
        <header class="set-head">
          <p class="eyebrow">Set list · ${esc(whenLabel(set.date))}</p>
          <h1>${esc(fullDate(set.date))}</h1>
          ${set.title ? `<p class="by">${esc(set.title)}</p>` : ""}
        </header>
        ${set.notes ? `<div class="notes"><strong>Notes for this service</strong>${esc(set.notes)}</div>` : ""}
        <div class="set-tools no-print">
          <button class="btn" data-act="autoscroll" type="button" title="Scroll through the set by itself (space bar works too)">▶ Autoscroll</button>
          <button class="btn primary" data-act="stage" type="button">⛶ Fullscreen</button>
          <button class="btn" data-act="print" type="button">Print all</button>
          <button class="btn" data-act="lyrics" type="button">Lyrics only</button>
          <a class="btn" href="#/set/${sid}/edit">Edit set</a>
          <div class="toolgroup" role="group" aria-label="Text size">
            <button class="btn icon" data-act="smaller" type="button" aria-label="Smaller text">A−</button>
            <button class="btn icon" data-act="bigger" type="button" aria-label="Bigger text">A+</button>
          </div>
          <button class="btn" data-act="chords" type="button" aria-pressed="${view.chords}">Chords</button>
        </div>
        ${set.items.length ? `
          <nav class="set-jump no-print" aria-label="Songs in this set">
            ${set.items.map((it, i) => { const s = songOf(it); return `<a href="#" data-jump="${i}">${i + 1}. ${esc(s ? s.title : "Removed song")}</a>`; }).join("")}
          </nav>
          <ol class="print-order">
            ${set.items.map((it) => { const s = songOf(it); return s ? `<li>${esc(s.title)}${keyFor(s, it.shift).target ? ` <span>(${esc(keyFor(s, it.shift).target)})</span>` : ""}</li>` : ""; }).join("")}
          </ol>` : `<div class="empty"><p>No songs in this set yet.</p><a class="btn primary" href="#/set/${sid}/edit">+ Add songs</a></div>`}
        ${set.items.map((it, i) => {
          const song = songOf(it);
          if (!song) {
            return `<section class="set-song missing" id="s-${i}"><p>Song ${i + 1} was deleted from the songbook.</p>
              <button class="btn" data-act="remove" data-i="${i}" type="button">Remove from set</button></section>`;
          }
          return `
            <section class="set-song" id="s-${i}">
              <header class="ss-head">
                <span class="ss-n">${i + 1}</span>
                <div class="ss-title">
                  <h2><a href="#/song/${encodeURIComponent(song.id)}">${esc(song.title)}</a></h2>
                  ${song.artist || (song.capo && !isGuitar()) ? `<p>${esc([song.artist, song.capo && !isGuitar() && `Guitar uses capo ${song.capo}`].filter(Boolean).join(" · "))}</p>` : ""}
                </div>
                <span class="ss-printkey">${keyFor(song, it.shift).target ? `Key: ${esc(keyFor(song, it.shift).target)}` : ""}${song.capo ? ` · guitar ${chordOpts(song, it.shift, true).capo ? `capo ${chordOpts(song, it.shift, true).capo}` : "no capo"}` : ""}</span>
              </header>
              ${isGuitar() ? `<div id="cb-${i}">${capoBanner(song, it.shift)}</div>` : ""}
              <div class="ss-tools no-print">
                <div class="toolgroup" role="group" aria-label="Key for this set">
                  <button class="btn icon" data-act="down" data-i="${i}" type="button" aria-label="Transpose down">−</button>
                  <button type="button" class="ss-key keyout${it.shift ? " changed" : ""}" id="k-${i}" data-act="reset" data-i="${i}" ${it.shift ? "" : "disabled"} aria-label="${esc(setKeyLabel(song, it.shift))}">${keyHtml(song, it.shift)}</button>
                  <button class="btn icon" data-act="up" data-i="${i}" type="button" aria-label="Transpose up">+</button>
                </div>
                <a class="btn" href="#/edit/${encodeURIComponent(song.id)}">Edit</a>
                <button class="btn ghost danger" data-act="remove" data-i="${i}" type="button">Remove</button>
              </div>
              ${song.notes ? `<div class="notes"><strong>Arrangement notes</strong>${esc(song.notes)}</div>` : ""}
              <article class="${sheetClass}" id="sheet-${i}" style="--size:${view.size}px">${sheetHtml(song, it.shift)}</article>
            </section>`;
        }).join("")}
        <div class="stage-bar" id="stagebar" role="toolbar" aria-label="Fullscreen controls">
          <button class="btn icon" data-act="prev" type="button" aria-label="Previous song">‹</button>
          <button class="btn icon" data-act="next" type="button" aria-label="Next song">›</button>
          <span class="sep" aria-hidden="true"></span>
          <button class="btn icon" data-act="smaller" type="button" aria-label="Smaller text">A−</button>
          <button class="btn icon" data-act="bigger" type="button" aria-label="Bigger text">A+</button>
          <span class="sep" aria-hidden="true"></span>
          <button class="btn icon" data-act="autoscroll" type="button" aria-label="Autoscroll">▶</button>
          <button class="btn" data-act="stage" type="button">Exit</button>
        </div>`;
    }

    function currentIndex() {
      const secs = [...document.querySelectorAll(".set-song")];
      let idx = 0;
      secs.forEach((s, i) => { if (s.getBoundingClientRect().top < 140) idx = i; });
      return idx;
    }
    function jump(i) {
      const el = document.getElementById(`s-${i}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function queueSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveSet(set).then((s) => { set = s; }).catch((err) => toast(err.message)), 500);
    }

    $app.onclick = async (e) => {
      if (stage.on) showStageBar();
      const j = e.target.closest("[data-jump]");
      if (j) { e.preventDefault(); return jump(Number(j.dataset.jump)); }
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const i = Number(btn.dataset.i);
      switch (btn.dataset.act) {
        case "autoscroll": {
          if (auto.on) { stopAuto(); break; }
          // Each song in the set keeps its own speed; it switches as you scroll into the next song.
          const cur = () => songOf(set.items[currentIndex()] || set.items[0]) || {};
          startAuto({
            key: () => cur().id || "set",
            estimate: () => estimateSpeed(document.getElementById(`sheet-${currentIndex()}`), cur()),
          });
          break;
        }
        case "reset": {
          const it = set.items[i];
          if (!it || !it.shift) break;
          it.shift = 0;
          const song = songOf(it);
          document.getElementById(`sheet-${i}`).innerHTML = sheetHtml(song, 0);
          const cb0 = document.getElementById(`cb-${i}`);
          if (cb0) cb0.innerHTML = capoBanner(song, 0);
          const kb = document.getElementById(`k-${i}`);
          kb.innerHTML = keyHtml(song, 0);
          kb.classList.remove("changed");
          kb.disabled = true;
          queueSave();
          toast(`${song.title} is back in ${keyFor(song, 0).base || "its original key"} for this set.`);
          break;
        }
        case "up": case "down": {
          const it = set.items[i];
          let shift = (((it.shift + (btn.dataset.act === "up" ? 1 : -1)) % 12) + 12) % 12;
          if (shift > 6) shift -= 12;
          it.shift = shift;
          const song = songOf(it);
          document.getElementById(`sheet-${i}`).innerHTML = sheetHtml(song, shift);
          const cbx = document.getElementById(`cb-${i}`);
          if (cbx) cbx.innerHTML = capoBanner(song, shift);
          const kb = document.getElementById(`k-${i}`);
          kb.innerHTML = keyHtml(song, shift);
          kb.classList.toggle("changed", !!shift);
          kb.disabled = !shift;
          kb.setAttribute("aria-label", setKeyLabel(song, shift));
          queueSave();
          break;
        }
        case "remove": {
          const song = songOf(set.items[i]);
          if (!confirm(`Remove ${song ? `"${song.title}"` : "this song"} from the ${fullDate(set.date)} set?`)) return;
          set.items.splice(i, 1);
          draw();
          try { set = await saveSet(set); toast("Removed from the set."); } catch (err) { toast(err.message); }
          break;
        }
        case "smaller": case "bigger":
          view.size = Math.min(34, Math.max(13, view.size + (btn.dataset.act === "bigger" ? 2 : -2)));
          document.querySelectorAll(".set-song .sheet").forEach((el) => el.style.setProperty("--size", `${view.size}px`));
          prefs.set("pw-view", view);
          break;
        case "chords":
          view.chords = !view.chords;
          document.querySelectorAll(".set-song .sheet").forEach((el) => el.classList.toggle("hide-chords", !view.chords));
          btn.setAttribute("aria-pressed", view.chords);
          prefs.set("pw-view", view);
          break;
        case "lyrics": {
          const list = set.items.map(songOf).filter(Boolean);
          if (!list.length) return toast("Add songs to the set first.");
          LyricsExport.open(list, {
            heading: `${fullDate(set.date)}${set.title ? ` · ${set.title}` : ""}`,
            filename: `lyrics-${set.date}`,
            toast,
          });
          break;
        }
        case "prev": jump(Math.max(0, currentIndex() - 1)); break;
        case "next": jump(Math.min(set.items.length - 1, currentIndex() + 1)); break;
        case "print": window.print(); break;
        case "stage": await setStage(!stage.on); break;
      }
    };

    draw();
    askRoleIfNeeded(anyCapo());
    if (opts.jump) setTimeout(() => jump(opts.jump - 1), 50);
    if (opts.print) {
      history.replaceState(null, "", `#/set/${sid}`);
      state.hash = location.hash;
      setTimeout(() => window.print(), 400);
    }
  }

  async function renderSetEditor(id) {
    if (!state.songs || !state.setlists) $app.innerHTML = `<div class="loading">Loading set…</div>`;
    await loadAll();
    let set = state.setlists.find((s) => s.id === id);
    if (!set) throw new Error("That set list is gone. Sets clear off once their date has passed.");
    const sid = encodeURIComponent(set.id);
    $app.onclick = null;
    let query = "";

    function save(msg) {
      const status = document.getElementById("set-status");
      if (status) status.textContent = "Saving…";
      return saveSet(set)
        .then((s) => { set = s; const el = document.getElementById("set-status"); if (el) el.textContent = msg || "Saved ✓"; })
        .catch((err) => { toast(err.message); const el = document.getElementById("set-status"); if (el) el.textContent = "Not saved"; });
    }

    function drawItems() {
      const byId = new Map(state.songs.map((s) => [s.id, s]));
      document.getElementById("set-count").textContent = set.items.length ? `(${set.items.length})` : "";
      document.getElementById("set-items").innerHTML = set.items.length
        ? set.items.map((it, i) => {
            const s = byId.get(it.songId);
            const k = s ? keyFor(s, it.shift).target : "";
            return `<li>
              <span class="si-n">${i + 1}</span>
              <span class="si-t">${s ? esc(s.title) : "Removed song"}<small>${esc([s && s.artist, k && `Key ${k}`].filter(Boolean).join(" · "))}</small></span>
              <span class="si-btns">
                <button type="button" class="btn icon" data-move="-1" data-i="${i}" aria-label="Move up"${i === 0 ? " disabled" : ""}>↑</button>
                <button type="button" class="btn icon" data-move="1" data-i="${i}" aria-label="Move down"${i === set.items.length - 1 ? " disabled" : ""}>↓</button>
                <button type="button" class="btn icon danger" data-drop="${i}" aria-label="Remove from set">✕</button>
              </span>
            </li>`;
          }).join("")
        : `<li class="si-empty">No songs yet. Add some below.</li>`;
      drawPicker();
    }

    function drawPicker() {
      const inSet = new Set(set.items.map((it) => it.songId));
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const list = state.songs.filter((s) => !inSet.has(s.id) && terms.every((t) => haystack(s).includes(t)));
      document.getElementById("pick").innerHTML = list.length
        ? list.map((s) => `<li><button type="button" data-add="${esc(s.id)}">
            <span class="pk-t">${esc(s.title)}<small>${esc([s.artist, s.key && `Key ${s.key}`, (s.sung || [])[0] && `Last sung ${shortDate(s.sung[0])}`].filter(Boolean).join(" · "))}</small></span>
            <span class="pk-plus" aria-hidden="true">+</span></button></li>`).join("")
        : `<li class="si-empty">${terms.length ? "No matching songs." : "Every song is already in this set."}</li>`;
    }

    document.title = "Edit set · Praise & Worship";
    $app.innerHTML = `
      <a class="back" href="#/set/${sid}">← Back to set</a>
      <div class="editor-head"><h1>Edit set</h1><span class="hint" id="set-status" aria-live="polite"></span></div>
      <div class="set-fields">
        <div><label for="set-date">Date</label><input type="date" id="set-date" value="${esc(set.date)}" required></div>
        <div><label for="set-title">Service or theme <span class="opt">(optional)</span></label><input id="set-title" maxlength="120" value="${esc(set.title)}" placeholder="Advent 1, Communion Sunday…"></div>
        <div class="full"><label for="set-notes">Notes for the team <span class="opt">(optional)</span></label><textarea id="set-notes" maxlength="2000" placeholder="Call time 8:30, run-through after first service…">${esc(set.notes)}</textarea></div>
      </div>
      <h2 class="set-h2">Songs in this set <span id="set-count"></span></h2>
      <ol class="set-items" id="set-items"></ol>
      <h2 class="set-h2">Add songs</h2>
      <input type="search" id="set-q" placeholder="Search songs to add…" autocomplete="off" aria-label="Search songs to add">
      <ul class="pick" id="pick"></ul>
      <div class="actions">
        <a class="btn primary" href="#/set/${sid}">Done</a>
        <div class="spacer"></div>
        <button class="btn danger" type="button" id="delete-set">Delete set</button>
      </div>`;
    drawItems();

    document.getElementById("set-date").addEventListener("change", (e) => {
      if (!e.target.value) return;
      set.date = e.target.value;
      save(e.target.value < today() ? "Saved. That date has passed, so this set will clear and mark its songs as sung." : undefined);
    });
    for (const [elId, field] of [["set-title", "title"], ["set-notes", "notes"]]) {
      document.getElementById(elId).addEventListener("change", (e) => { set[field] = e.target.value.trim(); save(); });
    }
    document.getElementById("set-q").addEventListener("input", (e) => { query = e.target.value; drawPicker(); });
    document.getElementById("set-items").addEventListener("click", (e) => {
      const mv = e.target.closest("[data-move]");
      const drop = e.target.closest("[data-drop]");
      if (mv) {
        const i = Number(mv.dataset.i), j = i + Number(mv.dataset.move);
        if (j < 0 || j >= set.items.length) return;
        [set.items[i], set.items[j]] = [set.items[j], set.items[i]];
      } else if (drop) {
        set.items.splice(Number(drop.dataset.drop), 1);
      } else return;
      drawItems();
      save();
    });
    document.getElementById("pick").addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      if (!add) return;
      set.items.push({ songId: add.dataset.add, shift: 0 });
      drawItems();
      save("Added ✓");
    });
    document.getElementById("delete-set").addEventListener("click", async () => {
      if (!confirm(`Delete the ${fullDate(set.date)} set? Songs stay in the songbook.`)) return;
      try {
        await api(`/api/setlists/${sid}`, { method: "DELETE" });
        state.setlists = state.setlists.filter((s) => s.id !== set.id);
        toast("Set deleted.");
        location.hash = "#/";
      } catch (err) { toast(err.message); }
    });
  }

  // ---------- Stats ----------
  async function renderStats() {
    if (!state.songs) $app.innerHTML = `<div class="loading">Loading…</div>`;
    const songs = await loadSongs();
    $app.onclick = null;
    document.title = "Stats · Praise & Worship";
    const range = state.statsRange || "all";
    const RANGES = { all: ["All time", Infinity], year: ["This year", null], "12m": ["Last 12 months", 365], "3m": ["Last 3 months", 91] };
    const inRange = (d) => {
      if (range === "year") return d.startsWith(String(new Date().getFullYear()));
      return daysAgo(d) <= RANGES[range][1];
    };
    const counted = songs.map((s) => ({ song: s, dates: (s.sung || []).filter(inRange) }));
    const ranked = counted.filter((c) => c.dates.length).sort((a, b) => b.dates.length - a.dates.length || b.dates[0].localeCompare(a.dates[0]) || byTitle(a.song, b.song));
    const svc = services(songs).filter((x) => inRange(x.date));
    const top = ranked.length ? ranked.filter((c) => c.dates.length === ranked[0].dates.length) : [];
    const max = ranked.length ? ranked[0].dates.length : 1;
    const totalPlays = ranked.reduce((n, c) => n + c.dates.length, 0);
    const neverSung = songs.filter((s) => !(s.sung || []).length).sort(byTitle);
    const resting = songs
      .filter((s) => (s.sung || []).length && daysAgo(s.sung[0]) > 90)
      .sort((a, b) => a.sung[0].localeCompare(b.sung[0]));
    const songLink = (s) => `<a href="#/song/${encodeURIComponent(s.id)}">${esc(s.title)}</a>`;

    $app.innerHTML = `
      <section class="list-head">
        <div>
          <p class="eyebrow">St. Paul UMC · Praise &amp; Worship</p>
          <h1>Song stats</h1>
        </div>
        <div class="head-actions no-print">
          <select id="range" aria-label="Time period">
            ${Object.entries(RANGES).map(([k, [label]]) => `<option value="${k}"${k === range ? " selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="btn" type="button" id="print-stats">Print</button>
        </div>
      </section>

      ${top.length ? `
        <section class="hero-stat">
          <p class="eyebrow">Our most sung song${top.length > 1 ? "s" : ""}</p>
          ${top.map((c) => `
            <a class="hero-song" href="#/song/${encodeURIComponent(c.song.id)}">
              <span class="hs-title">${esc(c.song.title)}</span>
              ${c.song.artist ? `<span class="hs-artist">${esc(c.song.artist)}</span>` : ""}
              <span class="hs-meta"><b>${c.dates.length}</b> time${c.dates.length === 1 ? "" : "s"} · last sung ${esc(niceDate(c.dates[0]))}${c.song.key ? ` · key of ${esc(c.song.key)}` : ""}</span>
            </a>`).join("")}
        </section>` : `
        <section class="hero-stat empty-hero">
          <p class="eyebrow">Our most sung song</p>
          <p>Nothing logged ${range === "all" ? "yet" : "in this period"}. Open a song and use <b>+ Add a date</b> to record when we sang it.</p>
        </section>`}

      <div class="stat-cards">
        <div class="stat-card"><b>${svc.length}</b><span>Services logged</span></div>
        <div class="stat-card"><b>${totalPlays}</b><span>Total times sung</span></div>
        <div class="stat-card"><b>${ranked.length}</b><span>Different songs</span></div>
        <div class="stat-card"><b>${svc[0] ? esc(shortDate(svc[0].date)) : "—"}</b><span>Last sang</span></div>
      </div>

      ${ranked.length ? `
        <section class="stat-block">
          <h2>Most sung</h2>
          <ol class="bars">
            ${ranked.slice(0, 10).map((c) => `
              <li>
                <a href="#/song/${encodeURIComponent(c.song.id)}">
                  <span class="bar-label">${esc(c.song.title)}</span>
                  <span class="bar-track"><span class="bar" style="width:${Math.max(6, (c.dates.length / max) * 100)}%"></span></span>
                  <span class="bar-n">${c.dates.length}</span>
                </a>
              </li>`).join("")}
          </ol>
        </section>` : ""}

      ${svc.length ? `
        <section class="stat-block">
          <h2>Recent services</h2>
          <ul class="services">
            ${svc.slice(0, 8).map((x) => `
              <li><span class="svc-date">${esc(longDate(x.date))}</span><span class="svc-songs">${x.songs.map(songLink).join(" · ")}</span></li>`).join("")}
          </ul>
        </section>` : ""}

      <div class="stat-split">
        ${resting.length ? `
          <section class="stat-block">
            <h2>Haven't sung in a while</h2>
            <p class="hint">Last sung more than 3 months ago.</p>
            <ul class="plain">${resting.slice(0, 12).map((s) => `<li>${songLink(s)} <span class="muted">· ${esc(shortDate(s.sung[0]))}</span></li>`).join("")}</ul>
          </section>` : ""}
        ${neverSung.length ? `
          <section class="stat-block">
            <h2>Not sung yet</h2>
            <ul class="plain">${neverSung.map((s) => `<li>${songLink(s)}</li>`).join("")}</ul>
          </section>` : ""}
      </div>`;

    document.getElementById("range").addEventListener("change", (e) => { state.statsRange = e.target.value; renderStats(); });
    document.getElementById("print-stats").addEventListener("click", () => window.print());
  }

  // ---------- Editor ----------
  const KEYS = [...CP.MAJOR_KEYS, "C#", "Gb", ...CP.MINOR_KEYS];
  const EXAMPLE = `{title: Amazing Grace}
{artist: John Newton}

Verse 1
A[G]mazing [G7]grace, how [C]sweet the [G]sound
That [G]saved a wretch like [D]me
I [G]once was [G7]lost, but [C]now am [G]found
Was [Em]blind but [D]now I [G]see`;

  async function renderEditor(id) {
    const song = id ? await findSong(id) : null;
    const s = song || { title: "", artist: "", key: "", tempo: "", time: "", tags: [], link: "", notes: "", body: "", sung: [] };
    document.title = `${song ? "Edit" : "New song"} · Praise & Worship`;
    $app.onclick = null;

    $app.innerHTML = `
      <a class="back" href="${song ? `#/song/${encodeURIComponent(song.id)}` : "#/"}">← ${song ? "Back to song" : "All songs"}</a>
      <div class="editor-head">
        <h1>${song ? "Edit song" : "Add a song"}</h1>
      </div>
      <details class="finder no-print"${song ? "" : " open"}>
        <summary>${song ? "Replace from online or a file" : "Find it online or open a file"}</summary>
        <form id="finder" class="finder-bar" role="search">
          <input id="find-q" type="search" placeholder="Song title, or paste an Ultimate Guitar or Hymnary link" autocomplete="off" aria-label="Find a song online">
          <button class="btn primary" type="submit">Find</button>
          <button class="btn" type="button" id="open-file">Open a file</button>
          <input type="file" id="file" accept=".cho,.chordpro,.chopro,.crd,.pro,.txt,text/plain" hidden>
        </form>
        <p class="hint">Searches Ultimate Guitar (chords) and Hymnary.org (hymn words). Files can be ChordPro (from SongSelect) or plain text. Always double-check chords and key before Sunday.</p>
        <div id="find-results" aria-live="polite"></div>
      </details>
      <form id="form" novalidate>
        <div class="grid">
          <div class="f-title"><label for="f-title">Title *</label><input id="f-title" name="title" required maxlength="200" value="${esc(s.title)}"></div>
          <div class="f-artist"><label for="f-artist">Artist / writer</label><input id="f-artist" name="artist" maxlength="200" value="${esc(s.artist)}"></div>
          <div class="f-key"><label for="f-key">Our key</label><input id="f-key" name="key" list="keys" maxlength="12" value="${esc(s.key)}" placeholder="G"></div>
          <div class="f-tempo"><label for="f-tempo">Tempo</label><input id="f-tempo" name="tempo" maxlength="20" value="${esc(s.tempo)}" placeholder="72 bpm"></div>
          <div class="f-time"><label for="f-time">Time</label><input id="f-time" name="time" maxlength="12" value="${esc(s.time)}" placeholder="4/4"></div>
          <div class="f-capo"><label for="f-capo">Guitar capo</label><select id="f-capo" name="capo">
            ${Array.from({ length: 10 }, (_, n) => `<option value="${n}"${(s.capo || 0) === n ? " selected" : ""}>${n ? `Capo ${n}` : "No capo"}</option>`).join("")}
          </select></div>
          <div class="f-tags"><label for="f-tags">Tags</label><input id="f-tags" name="tags" value="${esc((s.tags || []).join(", "))}" placeholder="Advent, Communion, Upbeat"><p class="hint">Separate with commas.</p></div>
          <div class="f-link"><label for="f-link">Reference link</label><input id="f-link" name="link" type="url" maxlength="500" value="${esc(s.link)}" placeholder="https://youtube.com/…"></div>
          <div class="f-sung"><label for="f-sung">Dates we sang it</label><input id="f-sung" name="sung" value="${esc((s.sung || []).join(", "))}" placeholder="2026-10-26, 2026-09-14"><p class="hint">Year-month-day, separated with commas.</p></div>
          <div class="f-notes"><label for="f-notes">Arrangement notes</label><textarea id="f-notes" name="notes" maxlength="5000" placeholder="Intro x2, skip verse 3, end on the chorus a cappella…">${esc(s.notes)}</textarea></div>
        </div>
        <datalist id="keys">${KEYS.map((k) => `<option value="${k}">`).join("")}</datalist>

        <div class="compose">
          <div>
            <div class="compose-head">
              <label for="f-body">Lyrics &amp; chords</label>
              <button class="btn" type="button" id="convert" title="For sheets with the chords on their own line above the words">Line up chords</button>
            </div>
            <div class="keycheck" id="keycheck" hidden></div>
            <textarea id="f-body" name="body" spellcheck="false" placeholder="${esc(EXAMPLE)}">${esc(s.body)}</textarea>
            <details class="help">
              <summary>How to write chords</summary>
              <p><b>Easiest:</b> paste a chord sheet from anywhere, with chords on their own line above the words. It gets lined up automatically. If it didn't, press <b>Line up chords</b>.</p>
              <p>Or put each chord in square brackets right before the syllable it lands on: <code>A[G]mazing [C]grace</code>.</p>
              <p>Start a section with a line like <code>Verse 1</code>, <code>Chorus</code>, <code>Bridge</code> or <code>[Pre-Chorus]</code>.</p>
              <p>Optional extras:</p>
              <pre>{comment: Softly, keys only}
{start_of_chorus}
…chorus lines…
{end_of_chorus}</pre>
            </details>
          </div>
          <div>
            <div class="compose-head"><label>Preview</label></div>
            <div class="preview"><div class="sheet" id="preview"></div></div>
          </div>
        </div>

        <p class="error" id="err" role="alert" hidden></p>
        <div class="actions">
          <button class="btn primary" type="submit" id="save">${song ? "Save changes" : "Save song"}</button>
          <a class="btn" href="${song ? `#/song/${encodeURIComponent(song.id)}` : "#/"}">Cancel</a>
          <div class="spacer"></div>
          ${song ? `<button class="btn danger" type="button" id="delete">Delete song</button>` : ""}
        </div>
      </form>`;

    const form = document.getElementById("form");
    const F = form.elements;
    const $body = document.getElementById("f-body");
    const $preview = document.getElementById("preview");
    const $err = document.getElementById("err");
    let baseUpdatedAt = song && song.updatedAt;

    const preview = () => {
      $preview.innerHTML = $body.value.trim() ? CP.render($body.value) : `<p class="hint">Your chord sheet will show up here.</p>`;
      checkKey();
    };

    // Warn when the chords don't match "Our key" (e.g. a capo sheet), with one-tap fixes.
    const $check = document.getElementById("keycheck");
    function checkKey() {
      const key = F.key.value.trim();
      const capo = Number(F.capo.value) || 0;
      const written = CP.guessKey($body.value);
      const expected = key && CP.parseKey(key) ? CP.transposeKey(key, -capo) : "";
      if (!written || !expected || CP.sameKey(written, expected)) { $check.hidden = true; return; }
      const wc = CP.keyCenter(written), kc = CP.keyCenter(key);
      const capoFit = (kc - wc + 12) % 12;
      $check.hidden = false;
      $check.innerHTML = `
        <p>These chords look like they're in <b>${esc(written)}</b>, but Our key is <b>${esc(key)}</b>${capo ? ` with capo ${capo}` : ""}.
        Piano and bass would read the wrong chords.</p>
        <div class="kc-btns">
          <button type="button" class="btn" data-fix="rewrite">Rewrite chords in ${esc(expected)}</button>
          ${capoFit >= 1 && capoFit <= 9 ? `<button type="button" class="btn" data-fix="capo" data-n="${capoFit}">Guitar plays capo ${capoFit}</button>` : ""}
          <button type="button" class="btn" data-fix="key">Our key is ${esc(CP.transposeKey(written, capo))}</button>
        </div>`;
    }
    $check.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fix]");
      if (!b) return;
      const key = F.key.value.trim();
      const capo = Number(F.capo.value) || 0;
      const written = CP.guessKey($body.value);
      if (b.dataset.fix === "rewrite") {
        const expected = CP.transposeKey(key, -capo);
        const n = (CP.keyCenter(expected) - CP.keyCenter(written) + 12) % 12;
        $body.value = CP.transposeText($body.value, n > 6 ? n - 12 : n, CP.prefersFlats(expected));
        toast(`Chords rewritten in ${expected}.`);
      } else if (b.dataset.fix === "capo") {
        F.capo.value = b.dataset.n;
        toast(`Saved as capo ${b.dataset.n}. Everyone sees the real chords; guitar can switch to capo shapes.`);
      } else {
        F.key.value = CP.transposeKey(written, capo);
      }
      state.dirty = true;
      preview();
    });
    F.key.addEventListener("input", checkKey);
    F.capo.addEventListener("change", checkKey);
    preview();

    function fillFromMeta(text) {
      const { meta } = CP.parse(text);
      for (const f of ["title", "artist", "key", "tempo", "time"]) {
        if (meta[f] && !F[f].value.trim()) F[f].value = meta[f];
      }
      const capo = parseInt(meta.capo, 10);
      if (capo > 0 && capo < 10 && F.capo.value === "0") F.capo.value = String(capo);
    }

    form.addEventListener("input", () => { state.dirty = true; });
    $body.addEventListener("input", preview);
    $body.addEventListener("paste", (e) => {
      const text = e.clipboardData && e.clipboardData.getData("text/plain");
      if (!text || !CP.looksLikeChordsOverLyrics(text)) return;
      e.preventDefault();
      $body.setRangeText(CP.toChordPro(text), $body.selectionStart, $body.selectionEnd, "end");
      fillFromMeta($body.value);
      state.dirty = true;
      preview();
      toast("Chords lined up with the words.");
    });
    // Let Tab insert spaces so chord sheets can be lined up by hand.
    $body.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        $body.setRangeText("    ", $body.selectionStart, $body.selectionEnd, "end");
        preview();
      }
    });
    document.getElementById("convert").addEventListener("click", () => {
      const before = $body.value;
      const after = CP.toChordPro(before);
      if (after === before) return toast("Nothing to line up. Chords already look good.");
      $body.value = after;
      fillFromMeta(after);
      state.dirty = true;
      preview();
      toast("Chords lined up with the words.");
    });

    function applyImport(found) {
      if ($body.value.trim() && !confirm("Replace the lyrics and chords you have now?")) return false;
      const lines = found.text.replace(/\r\n?/g, "\n").split("\n");
      if (found.title && lines[0] && lines[0].trim().toLowerCase() === found.title.trim().toLowerCase()) lines.shift();
      let text = lines.join("\n").replace(/^\n+/, "");
      if (CP.looksLikeChordsOverLyrics(text)) text = CP.toChordPro(text);
      $body.value = text;
      if (found.capo) F.capo.value = String(found.capo);
      // The key the band sounds in = key of the written chords + capo.
      const written = CP.guessKey(text);
      const soundingKey = written ? CP.transposeKey(written, found.capo || 0) : found.key;
      for (const [f, v] of [["title", found.title], ["artist", found.artist], ["key", soundingKey], ["link", found.url]]) {
        if (v && !F[f].value.trim()) F[f].value = v;
      }
      fillFromMeta(text);
      state.dirty = true;
      preview();
      return true;
    }

    const $results = document.getElementById("find-results");
    const $findQ = document.getElementById("find-q");
    if (!song && state.query) $findQ.value = state.query;

    async function importLink(url, label) {
      $results.innerHTML = `<p class="hint">Getting ${esc(label || "that song")}…</p>`;
      try {
        const { song: found } = await api(`/api/lookup?url=${encodeURIComponent(url)}`);
        if (applyImport(found)) {
          $results.innerHTML = "";
          toast(`Imported from ${found.source}. Check the chords and key, then save.`);
          $body.scrollIntoView({ behavior: "smooth", block: "start" });
        } else $results.innerHTML = "";
      } catch (err) {
        $results.innerHTML = `<p class="error">${esc(err.message)}</p>`;
      }
    }

    document.getElementById("finder").addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = $findQ.value.trim();
      if (!q) return $findQ.focus();
      if (/^https?:\/\//i.test(q)) return importLink(q);
      $results.innerHTML = `<p class="hint">Searching…</p>`;
      try {
        const { results, errors } = await api(`/api/lookup?q=${encodeURIComponent(q)}`);
        const notes = errors.map((m) => `<p class="hint">${esc(m)}</p>`).join("");
        $results.innerHTML = results.length
          ? `<ul class="results">${results.map((r, i) => `
              <li><button type="button" data-i="${i}">
                <span class="r-title">${esc(r.title)}</span>
                <span class="r-sub">${esc([r.artist, r.key && `Key ${r.key}`, r.detail].filter(Boolean).join(" · "))}</span>
                <span class="r-src">${esc(r.source)}</span>
              </button></li>`).join("")}</ul>${notes}`
          : `<p class="hint">Nothing found for "${esc(q)}". Try fewer words, or paste the chord sheet below.</p>${notes}`;
        $results.querySelectorAll("button[data-i]").forEach((b) =>
          b.addEventListener("click", () => {
            const r = results[Number(b.dataset.i)];
            importLink(r.url, `"${r.title}"`);
          })
        );
      } catch (err) {
        $results.innerHTML = `<p class="error">${esc(err.message)}</p>`;
      }
    });

    const $file = document.getElementById("file");
    document.getElementById("open-file").addEventListener("click", () => $file.click());
    $file.addEventListener("change", async () => {
      const file = $file.files[0];
      $file.value = "";
      if (!file) return;
      const text = await file.text();
      const title = CP.parse(text).meta.title || file.name.replace(/\.[^.]+$/, "");
      if (applyImport({ text, title, artist: "", key: "", url: "" })) toast(`Opened ${file.name}. Check it over, then save.`);
    });

    function collect() {
      const v = (n) => F[n].value.trim();
      return {
        title: v("title"), artist: v("artist"), key: v("key"), tempo: v("tempo"), time: v("time"),
        capo: Number(F.capo.value) || 0,
        link: v("link"), notes: F.notes.value.trim(), body: $body.value,
        tags: v("tags").split(",").map((t) => t.trim()).filter(Boolean),
        sung: v("sung").split(/[,\s]+/).filter(Boolean),
      };
    }

    async function save(overwrite) {
      $err.hidden = true;
      const data = collect();
      if (!data.title) {
        $err.textContent = "Every song needs a title.";
        $err.hidden = false;
        F.title.focus();
        return;
      }
      const bad = data.sung.find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
      if (bad) {
        $err.textContent = `"${bad}" isn't a date like 2026-10-26.`;
        $err.hidden = false;
        F.sung.focus();
        return;
      }
      if (data.link && !/^https?:\/\//i.test(data.link)) data.link = "https://" + data.link;
      const btn = document.getElementById("save");
      btn.disabled = true;
      try {
        const res = song
          ? await api(`/api/songs/${encodeURIComponent(song.id)}`, { method: "PUT", body: { ...data, baseUpdatedAt: overwrite ? undefined : baseUpdatedAt } })
          : await api("/api/songs", { method: "POST", body: data });
        upsert(res.song);
        state.dirty = false;
        toast(song ? "Changes saved." : "Song added.");
        location.hash = `#/song/${encodeURIComponent(res.song.id)}`;
      } catch (err) {
        btn.disabled = false;
        if (err.status === 409) {
          if (confirm("Someone else saved changes to this song while you were editing.\n\nPress OK to replace their version with yours, or Cancel to keep editing (you can copy your text, then reload).")) {
            return save(true);
          }
          return;
        }
        $err.textContent = err.message;
        $err.hidden = false;
      }
    }

    form.addEventListener("submit", (e) => { e.preventDefault(); save(false); });

    const del = document.getElementById("delete");
    if (del) {
      del.addEventListener("click", async () => {
        if (!confirm(`Delete "${song.title}" for everyone? This can't be undone.`)) return;
        try {
          await api(`/api/songs/${encodeURIComponent(song.id)}`, { method: "DELETE" });
          state.songs = state.songs.filter((x) => x.id !== song.id);
          state.dirty = false;
          toast("Song deleted.");
          location.hash = "#/";
        } catch (err) {
          $err.textContent = err.message;
          $err.hidden = false;
        }
      });
    }
    if (!song) F.title.focus();
  }

  route();
})();
