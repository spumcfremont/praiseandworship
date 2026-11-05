/* ChordPro helpers: parse, render, transpose, and convert "chords over lyrics" sheets. */
(function (root) {
  "use strict";

  const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const INDEX = {
    C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5, F: 5,
    "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11,
  };
  const MAJOR_KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const MINOR_KEYS = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

  const CHORD_RE = /^([A-G][#b]?)((?:maj|min|dim|aug|sus|add|m|M|\+|-|°|ø|Δ|\^|\d|#|b|\(|\))*)(?:\/([A-G][#b]?))?$/;
  const NEUTRAL_RE = /^(\|+|\/|-+|->|x\d+|\d+x|\(x?\d+x?\)|%|\.{2,}|…)$/i;
  const SECTION_WORDS =
    "intro|verse|pre[- ]?chorus|chorus|post[- ]?chorus|bridge|tag|outro|interlude|instrumental|" +
    "ending|turnaround|refrain|vamp|coda|hook|breakdown|solo";
  const SECTION_RE = new RegExp(
    `^\\s*[\\[(]?\\s*((?:repeat\\s+)?(?:${SECTION_WORDS})(?:\\s*\\d+[a-z]?)?` +
      `(?:\\s*[\\[(]?\\s*(?:x\\s*\\d+|\\d+\\s*x)\\s*[\\])]?)?)\\s*[\\])]?\\s*:?\\s*$`,
    "i"
  );
  const LEAD_IN_RE = new RegExp(`^\\s*[\\[(]?((?:${SECTION_WORDS})(?:\\s*\\d+)?)[\\])]?\\s*:\\s*(.+)$`, "i");
  const DIRECTIVE_RE = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function stripParens(t) {
    const m = /^\((.*)\)$/.exec(t);
    return m ? m[1] : t;
  }

  function isChord(tok) {
    if (!tok) return false;
    const t = stripParens(tok.trim());
    return /^N\.?C\.?$/i.test(t) || CHORD_RE.test(t);
  }

  function shiftNote(note, n, flats) {
    const i = INDEX[note];
    if (i === undefined) return note;
    return (flats ? FLATS : SHARPS)[(((i + n) % 12) + 12) % 12];
  }

  function transposeChord(chord, n, flats) {
    if (!n || !CHORD_RE.test(stripParens(chord.trim()))) return chord;
    return chord
      .replace(/^(\(?)([A-G][#b]?)/, (_, p, r) => p + shiftNote(r, n, flats))
      .replace(/\/([A-G][#b]?)/, (_, r) => "/" + shiftNote(r, n, flats));
  }

  function parseKey(key) {
    const m = /^\s*([A-G][#b]?)\s*(m|min|minor)?\s*$/i.exec(key || "");
    if (!m) return null;
    const root = m[1][0].toUpperCase() + m[1].slice(1);
    if (INDEX[root] === undefined) return null;
    return { index: INDEX[root], minor: !!m[2] };
  }

  function transposeKey(key, n) {
    const k = parseKey(key);
    if (!k) return key || "";
    if (!n) return key;
    const i = (((k.index + n) % 12) + 12) % 12;
    return (k.minor ? MINOR_KEYS : MAJOR_KEYS)[i];
  }

  function prefersFlats(key) {
    return /^[A-G]b/.test(key || "") || ["F", "Dm", "Gm", "Cm", "Fm"].includes(key);
  }

  function isSectionLabel(line) {
    return SECTION_RE.test(line);
  }

  function isChordLine(line) {
    const toks = String(line).trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return false;
    let chords = 0;
    for (const t of toks) {
      if (isChord(t)) chords++;
      else if (!NEUTRAL_RE.test(t)) return false;
    }
    return chords > 0;
  }

  function segment(line) {
    const segs = [];
    const re = /\[([^\]]+)\]/g;
    let last = 0;
    let chord = null;
    let m;
    while ((m = re.exec(line))) {
      const text = line.slice(last, m.index);
      if (chord !== null || text) segs.push({ chord, text });
      chord = m[1].trim();
      last = re.lastIndex;
    }
    const tail = line.slice(last);
    if (chord !== null || tail) segs.push({ chord, text: tail });
    return segs;
  }

  function parse(text) {
    const meta = {};
    const items = [];
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    let inTab = false;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      const d = DIRECTIVE_RE.exec(line);
      if (d) {
        const name = d[1].toLowerCase();
        const val = (d[2] || "").trim();
        const start = /^start_of_(\w+)$/.exec(name);
        if (start || ["soc", "sov", "sob", "sot"].includes(name)) {
          const kind = start ? start[1] : { soc: "chorus", sov: "verse", sob: "bridge", sot: "tab" }[name];
          const fallback = kind === "chorus" ? "Chorus" : kind === "bridge" ? "Bridge" : "";
          items.push({ type: "start", kind, label: val || fallback });
          if (kind === "tab") inTab = true;
          continue;
        }
        if (/^end_of_\w+$/.test(name) || ["eoc", "eov", "eob", "eot"].includes(name)) {
          inTab = false;
          items.push({ type: "end" });
          continue;
        }
        switch (name) {
          case "t": case "title": meta.title = val; break;
          case "st": case "subtitle": case "artist": case "composer": meta.artist = meta.artist || val; break;
          case "key": meta.key = val; break;
          case "tempo": meta.tempo = val; break;
          case "time": meta.time = val; break;
          case "capo": meta.capo = val; break;
          case "c": case "comment": case "ci": case "comment_italic": case "cb": case "comment_box": case "highlight":
            items.push({ type: "comment", text: val });
            break;
          case "chorus": items.push({ type: "section", label: val || "Chorus" }); break;
          default: break;
        }
        continue;
      }
      if (inTab) { items.push({ type: "tab", text: line }); continue; }
      if (!line.trim()) { items.push({ type: "blank" }); continue; }
      if (/^\s*#/.test(line)) continue;
      const sec = SECTION_RE.exec(line);
      if (sec) { items.push({ type: "section", label: sec[1].trim() }); continue; }
      // A line that is only "[Something]" and not a chord is a section heading, e.g. "[Break]".
      const bracket = /^\s*\[([^\]]+)\]\s*:?\s*$/.exec(line);
      if (bracket && !isChord(bracket[1]) && !NEUTRAL_RE.test(bracket[1].trim())) {
        items.push({ type: "section", label: bracket[1].trim() });
        continue;
      }
      items.push({ type: "line", segments: segment(line) });
    }
    return { meta, items };
  }

  function renderLine(segs, n, flats) {
    const hasChords = segs.some((s) => s.chord !== null);
    if (!hasChords) return `<div class="line lyrics-only">${esc(segs.map((s) => s.text).join(""))}</div>`;
    const chordOnly = segs.every((s) => !s.text.trim());
    let out = "";
    for (const s of segs) {
      const words = s.text.match(/\s*\S+\s*|\s+/g) || [""];
      words.forEach((w, i) => {
        const ch = i === 0 && s.chord !== null ? esc(transposeChord(s.chord, n, flats)) : "";
        out += `<span class="seg"><span class="ch">${ch}</span><span class="ly">${esc(w)}</span></span>`;
      });
    }
    return `<div class="line${chordOnly ? " chords-only" : ""}">${out}</div>`;
  }

  function render(text, opts = {}) {
    const { items } = parse(text);
    const n = opts.transpose || 0;
    const flats = !!opts.flats;
    let html = "";
    let open = 0;
    let prev = "";
    for (const it of items) {
      const type = it.type;
      switch (type) {
        case "blank": if (prev !== "section" && prev !== "blank") html += `<div class="gap"></div>`; break;
        case "section": html += `<div class="section-label">${esc(it.label)}</div>`; break;
        case "comment": html += `<div class="comment">${esc(it.text)}</div>`; break;
        case "start":
          html += `<div class="block block-${esc(it.kind)}">` +
            (it.label ? `<div class="section-label">${esc(it.label)}</div>` : "");
          open++;
          break;
        case "end": if (open > 0) { html += "</div>"; open--; } break;
        case "tab": html += `<pre class="tab">${esc(it.text)}</pre>`; break;
        case "line": html += renderLine(it.segments, n, flats); break;
      }
      prev = type;
    }
    return html + "</div>".repeat(open);
  }

  function plainText(text) {
    return parse(text).items
      .map((it) => (it.type === "line" ? it.segments.map((s) => s.text).join("") : it.type === "section" ? it.label : ""))
      .join("\n");
  }

  function expandTabs(s) {
    let out = "";
    for (const c of s) out += c === "\t" ? " ".repeat(4 - (out.length % 4)) : c;
    return out;
  }

  function looksLikeChordsOverLyrics(text) {
    for (const m of String(text).matchAll(/\[([^\]]+)\]/g)) if (isChord(m[1])) return false;
    let chordLines = 0;
    for (const l of String(text).split(/\r?\n/)) if (isChordLine(l)) chordLines++;
    return chordLines >= 2;
  }

  // Turns a sheet with chords on their own line above the words into inline ChordPro.
  function toChordPro(text) {
    const lines = String(text).replace(/ /g, " ").replace(/\r\n?/g, "\n").split("\n").map(expandTabs);
    const out = [];
    const chordTokens = (line) => [...line.matchAll(/\S+/g)].map((m) => ({ pos: m.index, tok: m[0] }));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lead = LEAD_IN_RE.exec(line);
      if (lead && isChordLine(lead[2])) {
        out.push(lead[1].trim(), chordTokens(lead[2]).map((c) => `[${c.tok}]`).join(" "));
        continue;
      }
      if (!isChordLine(line)) { out.push(line.replace(/\s+$/, "")); continue; }
      const chords = chordTokens(line);
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && !isChordLine(next) && !isSectionLabel(next) && !DIRECTIVE_RE.test(next)) {
        const maxPos = Math.max(...chords.map((c) => c.pos));
        let lyric = next.length < maxPos ? next.padEnd(maxPos, " ") : next;
        for (const c of [...chords].reverse()) lyric = lyric.slice(0, c.pos) + `[${c.tok}]` + lyric.slice(c.pos);
        out.push(lyric.replace(/\s+$/, ""));
        i++;
      } else {
        out.push(chords.map((c) => `[${c.tok}]`).join(" "));
      }
    }
    return out.join("\n");
  }

  // Rewrite every [chord] in a sheet n half steps up (section labels like [Verse] are left alone).
  function transposeText(text, n, flats) {
    return String(text).replace(/\[([^\]]+)\]/g, (m, c) => (isChord(c) ? `[${transposeChord(c.trim(), n, flats)}]` : m));
  }

  // Best guess at the key the chords are written in: scores every key by how well the chords
  // fit its scale, with extra weight on the first and last chord (songs usually start/end on "home").
  function guessKey(text) {
    const chords = [];
    for (const it of parse(text).items) {
      if (it.type !== "line") continue;
      for (const s of it.segments) {
        if (!s.chord) continue;
        const m = /^\(?([A-G][#b]?)([^/]*)/.exec(s.chord.trim());
        if (!m || INDEX[m[1]] === undefined || !CHORD_RE.test(stripParens(s.chord.trim()))) continue;
        chords.push({ root: INDEX[m[1]], minor: /^(m|min|-)(?!aj)/.test(m[2]) && !/^maj/.test(m[2]), dim: /dim|°|ø/.test(m[2]) });
      }
    }
    if (chords.length < 2) return "";
    const MAJ = [0, 5, 7], MIN = [2, 4, 9];
    let best = null;
    for (let k = 0; k < 12; k++) {
      let score = 0;
      for (const c of chords) {
        const d = (c.root - k + 12) % 12;
        if ((!c.minor && MAJ.includes(d)) || (c.minor && MIN.includes(d))) score += 2;
        else if (MAJ.includes(d) || MIN.includes(d) || (d === 11 && c.dim)) score += 1;
        else score -= 1;
        if (d === 0 && !c.minor) score += 1;
      }
      const first = chords[0], last = chords[chords.length - 1];
      if ((first.root - k + 12) % 12 === 0) score += 3;
      if ((last.root - k + 12) % 12 === 0) score += 3;
      if (!best || score > best.score) best = { k, score };
    }
    // Minor key if the song clearly lives on the relative minor (vi) chord.
    const rel = (best.k + 9) % 12;
    const f = chords[0], l = chords[chords.length - 1];
    if (f.root === rel && f.minor && l.root === rel && l.minor) return MINOR_KEYS[rel];
    return MAJOR_KEYS[best.k];
  }

  // Same key center? (G and Em count as the same set of chords.)
  function keyCenter(key) {
    const k = parseKey(key);
    return k ? (k.minor ? (k.index + 3) % 12 : k.index) : null;
  }
  function sameKey(a, b) {
    const x = keyCenter(a), y = keyCenter(b);
    return x !== null && x === y;
  }

  root.ChordPro = {
    parse, render, plainText, transposeChord, transposeKey, prefersFlats, parseKey,
    isChord, isChordLine, isSectionLabel, looksLikeChordsOverLyrics, toChordPro,
    MAJOR_KEYS, MINOR_KEYS, esc, transposeText, guessKey, keyCenter, sameKey,
  };
})(typeof window !== "undefined" ? window : globalThis);
