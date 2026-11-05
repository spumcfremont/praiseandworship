/* Chord cheat sheet: tap a chord name to see how to play it on piano or guitar. */
(function (root) {
  "use strict";

  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const LETTERS = "CDEFGAB";

  // [semitones above the root, scale degree] so notes can be spelled properly (Bb–D–F, not A#–D–F).
  const R = [0, 1], m2 = [1, 2], M2 = [2, 2], m3 = [3, 3], M3 = [4, 3], P4 = [5, 4], d5 = [6, 5], P5 = [7, 5],
    A5 = [8, 5], M6 = [9, 6], d7 = [9, 7], m7 = [10, 7], M7 = [11, 7], N9 = [14, 9], N11 = [17, 11], N13 = [21, 13];

  // [pattern for what follows the root, code, name, intervals] — first match wins.
  const QUALITIES = [
    [/^(maj7|M7|Δ7?|\^7?|ma7)$/, "maj7", "major 7th", [R, M3, P5, M7]],
    [/^(maj9|M9|Δ9)$/, "maj9", "major 9th", [R, M3, P5, M7, N9]],
    [/^(m7b5|min7b5|-7b5|ø7?)$/, "m7b5", "half-diminished", [R, m3, d5, m7]],
    [/^(dim7|°7|o7)$/, "dim7", "diminished 7th", [R, m3, d5, d7]],
    [/^(dim|°|o)$/, "dim", "diminished", [R, m3, d5]],
    [/^(aug|\+|\+5|#5)$/, "aug", "augmented", [R, M3, A5]],
    [/^(m|min|-)(maj7|M7)$/, "mmaj7", "minor-major 7th", [R, m3, P5, M7]],
    [/^(m7|min7|-7)$/, "m7", "minor 7th", [R, m3, P5, m7]],
    [/^(m9|min9|-9)$/, "m9", "minor 9th", [R, m3, P5, m7, N9]],
    [/^(m11|min11)$/, "m11", "minor 11th", [R, m3, P5, m7, N11]],
    [/^(m6|min6)$/, "m6", "minor 6th", [R, m3, P5, M6]],
    [/^(madd9|madd2|m2|minadd9)$/, "madd9", "minor add 9", [R, m3, P5, N9]],
    [/^(m|min|-)$/, "m", "minor", [R, m3, P5]],
    [/^(7sus4?|7sus)$/, "7sus4", "7th, suspended 4th", [R, P4, P5, m7]],
    [/^(sus2|2)$/, "sus2", "suspended 2nd", [R, M2, P5]],
    [/^(sus4?|4)$/, "sus4", "suspended 4th", [R, P4, P5]],
    [/^(add9|add2)$/, "add9", "add 9", [R, M3, P5, N9]],
    [/^(6\/9|69)$/, "69", "6/9", [R, M3, P5, M6, N9]],
    [/^6$/, "6", "6th", [R, M3, P5, M6]],
    [/^7$/, "7", "dominant 7th", [R, M3, P5, m7]],
    [/^9$/, "9", "dominant 9th", [R, M3, P5, m7, N9]],
    [/^11$/, "11", "11th", [R, P5, m7, N9, N11]],
    [/^13$/, "13", "13th", [R, M3, P5, m7, N9, N13]],
    [/^5$/, "5", "power chord", [R, P5]],
    [/^(maj|M)?$/, "", "major", [R, M3, P5]],
  ];

  function parse(name) {
    const clean = String(name).trim().replace(/^\((.*)\)$/, "$1");
    const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(clean);
    if (!m) return null;
    const rootName = m[1] + m[2];
    const rootPc = (PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
    const suffix = m[3].replace(/[()]/g, "");
    let q = QUALITIES.find(([re]) => re.test(suffix));
    let simplified = false;
    if (!q) {
      // Unusual extensions (maj7#11, 7b9…): show the closest basic chord.
      simplified = true;
      q = /^(maj7|M7)/.test(suffix) ? QUALITIES[0]
        : /^(m7|min7)/.test(suffix) ? QUALITIES.find((x) => x[1] === "m7")
        : /^(m|min)(?!aj)/.test(suffix) ? QUALITIES.find((x) => x[1] === "m")
        : /^7/.test(suffix) ? QUALITIES.find((x) => x[1] === "7")
        : QUALITIES.find((x) => x[1] === "");
    }
    const bass = m[4] ? { name: m[4] + m[5], pc: (PC[m[4]] + (m[5] === "#" ? 1 : m[5] === "b" ? -1 : 0) + 12) % 12 } : null;
    return { name: clean, rootName, rootPc, code: q[1], quality: q[2], intervals: q[3], bass, simplified };
  }

  // Spell a note by scale degree so letters don't repeat (Bb major = Bb–D–F).
  function spell(rootName, semis, degree) {
    const letter = LETTERS[(LETTERS.indexOf(rootName[0]) + degree - 1) % 7];
    const rootPc = (PC[rootName[0]] + (rootName[1] === "#" ? 1 : rootName[1] === "b" ? -1 : 0) + 12) % 12;
    const target = (rootPc + semis) % 12;
    const diff = ((target - PC[letter] + 18) % 12) - 6;
    return letter + ({ "-2": "bb", "-1": "b", 0: "", 1: "#", 2: "##" })[diff];
  }

  // ---------- Guitar shapes ----------
  // Common open shapes by root pitch class + code ("x" = don't play the string), low E → high E.
  const OPEN = {
    "0": "x32010", "0maj7": "x32000", "07": "x32310", "0add9": "x32030", "0sus2": "x30013", "0sus4": "x33011", "06": "x32210",
    "2": "xx0232", "2m": "xx0231", "27": "xx0212", "2maj7": "xx0222", "2m7": "xx0211", "2sus2": "xx0230", "2sus4": "xx0233", "26": "xx0202", "2add9": "xx0230",
    "4": "022100", "4m": "022000", "47": "020100", "4m7": "022030", "4maj7": "021100", "4sus4": "022200", "45": "022xxx", "4add9": "024100", "47sus4": "020200",
    "5": "133211", "5m": "133111", "57": "131211", "5maj7": "xx3210",
    "7": "320003", "77": "320001", "7maj7": "320002", "7sus4": "3x0013", "76": "320000", "7add9": "3x0203", "7sus2": "300033",
    "9": "x02220", "9m": "x02210", "97": "x02020", "9m7": "x02010", "9maj7": "x02120", "9sus2": "x02200", "9sus4": "x02230",
    "96": "x02222", "97sus4": "x02030", "9add9": "x02420",
    "117": "x21202", "11m7": "x20202",
    // slash chords: root/bass
    "7/11": "x20003", "2/6": "200232", "0/7": "332010", "0/4": "032010", "5/0": "x33211", "9/1": "x4222x",
    "9m/7": "3x2210", "5/9": "x03211", "9/4": "002220", "2/9": "x00232", "0/2": "x30010",
  };
  // Movable barre shapes: frets relative to the root on string 6 (E shape) or string 5 (A shape).
  const E_SHAPE = {
    "": [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
    maj7: [0, null, 1, 1, 0, null], sus4: [0, 2, 2, 2, 0, 0], 5: [0, 2, 2, null, null, null], "7sus4": [0, 2, 0, 2, 0, 0],
  };
  const A_SHAPE = {
    "": [null, 0, 2, 2, 2, 0], m: [null, 0, 2, 2, 1, 0], 7: [null, 0, 2, 0, 2, 0], m7: [null, 0, 2, 0, 1, 0],
    maj7: [null, 0, 2, 1, 2, 0], sus2: [null, 0, 2, 2, 0, 0], sus4: [null, 0, 2, 2, 3, 0], dim: [null, 0, 1, 2, 1, null],
    m7b5: [null, 0, 1, 0, 1, null], dim7: [null, 0, 1, 2, 1, 2], aug: [null, 0, 3, 2, 2, 1], 6: [null, 0, 2, 2, 2, 2],
    m6: [null, 0, 2, 2, 1, 2], 9: [null, 0, -1, 0, 0, 0], 5: [null, 0, 2, 2, null, null], "7sus4": [null, 0, 2, 0, 3, 0],
    add9: [null, 0, 2, 4, 2, 0],
  };
  const SIMPLER = { add9: "", maj9: "maj7", m9: "m7", m11: "m7", madd9: "m", 69: "6", 9: "7", 11: "7sus4", 13: "7", mmaj7: "m" };

  const toFrets = (s) => [...s].map((c) => (c === "x" ? null : Number(c)));

  function guitarShape(chord) {
    const tryCode = (code) => {
      if (chord.bass && chord.bass.pc !== chord.rootPc) {
        const slash = OPEN[`${chord.rootPc}${code}/${chord.bass.pc}`];
        if (slash) return { frets: toFrets(slash), exact: true };
      }
      const open = OPEN[`${chord.rootPc}${code}`];
      if (open) return { frets: toFrets(open) };
      const options = [];
      if (E_SHAPE[code]) options.push({ base: (chord.rootPc - 4 + 12) % 12, shape: E_SHAPE[code] });
      if (A_SHAPE[code]) options.push({ base: (chord.rootPc - 9 + 12) % 12, shape: A_SHAPE[code] });
      const usable = options
        .map((o) => ({ ...o, base: o.base === 0 && o.shape.some((f) => f !== null && f < 0) ? 12 : o.base }))
        .sort((a, b) => a.base - b.base);
      if (!usable.length) return null;
      const { base, shape } = usable[0];
      return { frets: shape.map((f) => (f === null ? null : f + base)) };
    };
    let shape = tryCode(chord.code);
    let note = "";
    if (!shape && SIMPLER[chord.code] !== undefined) {
      shape = tryCode(SIMPLER[chord.code]);
      if (shape) note = "Simplified shape; the extra note is optional on guitar.";
    }
    if (shape && chord.bass && chord.bass.pc !== chord.rootPc && !shape.exact) {
      note = `Bass player takes the ${chord.bass.name}. On guitar, play this shape (or add ${chord.bass.name} as the lowest note).`;
    }
    return shape ? { ...shape, note } : null;
  }

  // ---------- Drawing ----------
  function guitarSvg(frets) {
    const played = frets.filter((f) => f !== null && f > 0);
    const maxF = played.length ? Math.max(...played) : 0;
    const minF = played.length ? Math.min(...played) : 0;
    const base = maxF <= 4 ? 1 : minF;
    const X0 = 30, DX = 24, Y0 = 36, DY = 28, N = 5;
    let g = "";
    for (let i = 0; i <= N; i++) {
      const y = Y0 + i * DY;
      g += `<line x1="${X0}" y1="${y}" x2="${X0 + 5 * DX}" y2="${y}" class="gs-fret"${i === 0 && base === 1 ? ' stroke-width="5"' : ""}/>`;
    }
    for (let s = 0; s < 6; s++) g += `<line x1="${X0 + s * DX}" y1="${Y0}" x2="${X0 + s * DX}" y2="${Y0 + N * DY}" class="gs-string"/>`;
    if (base > 1) g += `<text x="${X0 + 5 * DX + 10}" y="${Y0 + DY / 2 + 5}" class="gs-pos">${base}fr</text>`;
    // Barre: same lowest fret across 3+ strings starting from the lowest played string.
    if (base > 1 || frets.filter((f) => f === minF && f > 0).length >= 3) {
      const at = frets.map((f, i) => (f === minF && minF > 0 ? i : -1)).filter((i) => i >= 0);
      const first = frets.findIndex((f) => f !== null);
      if (at.length >= 3 && at[0] === first) {
        const y = Y0 + (minF - base + 0.5) * DY;
        g += `<rect x="${X0 + at[0] * DX - 9}" y="${y - 9}" width="${(at[at.length - 1] - at[0]) * DX + 18}" height="18" rx="9" class="gs-dot"/>`;
      }
    }
    frets.forEach((f, s) => {
      const x = X0 + s * DX;
      if (f === null) g += `<text x="${x}" y="${Y0 - 10}" class="gs-mark">×</text>`;
      else if (f === 0) g += `<circle cx="${x}" cy="${Y0 - 15}" r="6" class="gs-open"/>`;
      else g += `<circle cx="${x}" cy="${Y0 + (f - base + 0.5) * DY}" r="9" class="gs-dot"/>`;
    });
    return `<svg viewBox="0 0 190 ${Y0 + N * DY + 14}" class="guitar-svg" role="img" aria-label="Guitar chord chart">${g}</svg>`;
  }

  // Just the keys around the chord: left hand (bass) within the octave below, right hand from the root.
  function pianoSvg(chord, spelled) {
    const rootMidi = 12 + chord.rootPc;
    const rh = chord.intervals.map(([s], i) => ({ midi: rootMidi + s, label: spelled[i] }));
    const bassPc = chord.bass ? chord.bass.pc : chord.rootPc;
    const lhMidi = rootMidi - (((chord.rootPc - bassPc + 12) % 12) || 12);
    const lh = { midi: lhMidi, label: chord.bass ? chord.bass.name : spelled[0] };
    const isBlack = (n) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);
    // Start on a white key a little left of the bass note; end a little right of the top note.
    let lo = lhMidi - 2;
    while (isBlack(lo)) lo--;
    let hi = Math.max(...rh.map((n) => n.midi)) + 2;
    while (isBlack(hi)) hi++;
    const W = 22, H = 110, BW = 14, BH = 68;
    const whites = [];
    for (let n = lo; n <= hi; n++) if (!isBlack(n)) whites.push(n);
    const xOf = {};
    whites.forEach((n, i) => { xOf[n] = i * W; });
    for (let n = lo; n <= hi; n++) if (isBlack(n)) xOf[n] = xOf[n - 1] + W - BW / 2;
    const on = new Map(rh.map((n) => [n.midi, { cls: "pk-rh", label: n.label }]));
    on.set(lh.midi, { cls: "pk-lh", label: lh.label });
    let g = "";
    for (const n of whites) {
      const hit = on.get(n);
      g += `<rect x="${xOf[n]}" y="0" width="${W}" height="${H}" rx="3" class="pk-white${hit ? " " + hit.cls : ""}"/>`;
      if (hit) g += `<text x="${xOf[n] + W / 2}" y="${H - 10}" class="pk-label">${hit.label}</text>`;
    }
    for (let n = lo; n <= hi; n++) {
      if (!isBlack(n)) continue;
      const hit = on.get(n);
      g += `<rect x="${xOf[n]}" y="0" width="${BW}" height="${BH}" rx="2" class="pk-black${hit ? " " + hit.cls : ""}"/>`;
      if (hit) g += `<text x="${xOf[n] + BW / 2}" y="${BH - 8}" class="pk-label pk-label-on-black">${hit.label}</text>`;
    }
    return `<svg viewBox="-1 -1 ${whites.length * W + 2} ${H + 2}" class="piano-svg" role="img" aria-label="Piano keys for ${chord.name}">${g}</svg>`;
  }

  // ---------- Pop-up ----------
  function open(name) {
    const chord = parse(name);
    if (!chord) return false;
    const spelled = chord.intervals.map(([s, d]) => spell(chord.rootName, s, d));
    let inst = "piano";
    try { inst = localStorage.getItem("pw-chord-inst") || "piano"; } catch {}
    const shape = guitarShape(chord);

    let dlg = document.getElementById("chord-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "chord-dialog";
      dlg.className = "chord-dialog";
      document.body.appendChild(dlg);
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // tap outside closes
    }
    const title = `${chord.rootName} ${chord.quality}${chord.bass && chord.bass.pc !== chord.rootPc ? ` over ${chord.bass.name}` : ""}`;
    const draw = () => {
      const body = inst === "piano"
        ? `${pianoSvg(chord, spelled)}
           <p class="cd-hands"><span class="cd-key pk-rh-sw"></span>Right hand: <b>${spelled.join(" – ")}</b></p>
           <p class="cd-hands"><span class="cd-key pk-lh-sw"></span>Left hand: <b>${chord.bass ? chord.bass.name : spelled[0]}</b>${chord.bass && chord.bass.pc !== chord.rootPc ? " (the bass note)" : " (the root)"}</p>`
        : shape
          ? `${guitarSvg(shape.frets)}${shape.note ? `<p class="cd-note">${shape.note}</p>` : ""}`
          : `<p class="cd-note">No common guitar shape for this one. Notes: <b>${spelled.join(" – ")}</b></p>`;
      dlg.innerHTML = `
        <form method="dialog">
          <div class="cd-head">
            <div><h2>${chord.name}</h2><p>${title}</p></div>
            <button class="btn icon ghost" value="close" aria-label="Close">✕</button>
          </div>
          <div class="cd-tabs" role="tablist">
            <button type="button" role="tab" data-inst="piano" aria-selected="${inst === "piano"}">Piano</button>
            <button type="button" role="tab" data-inst="guitar" aria-selected="${inst === "guitar"}">Guitar</button>
          </div>
          <div class="cd-body">${body}</div>
          <p class="cd-notes">Notes: ${spelled.join(" · ")}${chord.simplified ? " <span>(basic version of this chord)</span>" : ""}</p>
        </form>`;
      dlg.querySelectorAll("[data-inst]").forEach((b) =>
        b.addEventListener("click", () => {
          inst = b.dataset.inst;
          try { localStorage.setItem("pw-chord-inst", inst); } catch {}
          draw();
        })
      );
    };
    draw();
    if (!dlg.open) dlg.showModal();
    return true;
  }

  root.ChordHelp = { open, parse, spell, guitarShape };
})(window);
