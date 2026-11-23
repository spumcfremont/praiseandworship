/* FileImport: turn a chord-sheet file into song text.
   Text and ChordPro files are read as-is. Word files (.docx, e.g. from Google Docs) are unzipped
   and their paragraphs read. PDFs are read with pdf.js, and each
   line is rebuilt from where its words sit on the page, so chords stay over the right syllables.
   window.FileImport.read(blob, name) -> { title, text, source } */
(function () {
"use strict";
// pdf.js is kept in /vendor/pdfjs (no build step) and only loaded when a PDF is opened.
const PDFJS_URL = "/vendor/pdfjs/pdf.min.mjs";
const pdfWorkerUrl = "/vendor/pdfjs/pdf.worker.min.mjs";

const TEXT_EXT = /\.(txt|cho|chordpro|chopro|crd|pro|md|text|onsong)$/i;
// Files The songbook can't read, with what to do instead.
const CANT_READ = [
  [/\.doc$/i, "That's an older Word file (.doc). Open it in Word or Pages and save it as .docx or PDF, then import that."],
  [/\.(pages|key|numbers)$/i, "That's a Pages file. In Pages, choose Export To > PDF or Word, then import that."],
  [/\.(odt|xlsx?|pptx?|csv)$/i, "The songbook can't read that kind of file. Save it as PDF, Word (.docx) or text, then import that."],
  [/\.(jpe?g|png|heic|gif|webp|tiff?)$/i, "That's a picture, and the songbook can only read typed text. Copy the chords and words in instead."],
];

// The file's name without folder or extension; nothing for throwaway names ("lyrics_tmp",
// "download (2)", "document"), which are worse than an empty title.
const baseName = (name) => {
  const base = String(name || "").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")
    .replace(/\s*\(\d+\)$/, "").replace(/\s+(chords?|lyrics|tabs?)(\s+\d+)?$/i, "").trim();
  return /^(lyrics?( tmp)?|tmp|temp|download|file|document|untitled|print|export|tab|chords?|sheet)(\s*\(?\d+\)?)?$/i.test(base) ? "" : base;
};

// Lines that are about the song rather than its name: "Capo: 2nd fret", "Key: G", "[Intro]",
// a chord line, "Tuning: Standard", a URL, "Page 1".
const META_LINE = /^(\{|\[|capo|key|tuning|tempo|time|bpm|artist|author|difficulty|strumming|page\b|https?:|www\.|by\s|chords?\b|tab\b|verse|chorus|intro|bridge|outro)/i;
const CHORDS_ONLY = /^[\s|\-x\d()]*([A-G][#b]?(m|maj|min|sus|dim|aug|add)?\d*(\/[A-G][#b]?)?[\s|\-x\d()]*)+$/;

function kindOf(blob, name) {
  const type = (blob && blob.type) || "";
  if (/\.pdf$/i.test(name) || type === "application/pdf") return "pdf";
  if (/\.docx$/i.test(name) || /wordprocessingml/.test(type)) return "docx";
  if (/\.rtf$/i.test(name) || /rtf/.test(type)) return "rtf";
  if (CANT_READ.some(([re]) => re.test(name))) return "";
  if (TEXT_EXT.test(name) || type.startsWith("text/") || !type) return "text";
  return "";
}

// ---------- .docx: a zip holding word/document.xml ----------
async function unzipEntry(buf, wanted) {
  const v = new DataView(buf);
  // Find the end-of-central-directory record, then walk the central directory.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That Word file looks damaged.");
  let p = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const fileName = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    if (fileName === wanted) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = new Uint8Array(buf, start, size);
      if (method === 0) return dec.decode(data);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("That doesn't look like a Word document.");
}

async function readDocx(blob) {
  const xml = await unzipEntry(await blob.arrayBuffer(), "word/document.xml");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const lines = [];
  for (const para of doc.getElementsByTagNameNS(W, "p")) {
    let line = "";
    for (const node of para.getElementsByTagNameNS(W, "*")) {
      if (node.localName === "t") line += node.textContent;
      else if (node.localName === "tab") line += "\t";
      else if (node.localName === "br" && node.getAttributeNS(W, "type") === "page") line += "\n\f\n";
      else if (node.localName === "br" || node.localName === "cr") line += "\n";
    }
    lines.push(line.replace(/\t/g, "    "));
  }
  return lines.join("\n");
}

// ---------- .pdf: rebuild lines from text positions ----------
let pdfjs = null;
async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import(PDFJS_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
  return pdfjs;
}

async function readPdf(blob) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    // "W a l a": a letter-spaced heading comes through with a space between each letter.
    const unspace = (t) => (/^(\S ){2,}\S$/.test(t) ? t.replace(/ /g, "") : t);
    const words = items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: unspace(it.str), x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || 10 }));
    if (!words.length) continue;
    // Width of one character: chord sheets are usually in a fixed-width font.
    const widths = words.filter((w) => w.s.length >= 3).map((w) => w.w / w.s.length).sort((a, b) => a - b);
    const cw = widths.length ? widths[Math.floor(widths.length / 2)] : 6;
    const left = Math.min(...words.map((w) => w.x));
    // Group words into lines by height on the page (top to bottom), then place by column.
    const rows = [];
    for (const w of words.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.find((r) => Math.abs(r.y - w.y) < w.h * 0.4);
      if (row) row.words.push(w); else rows.push({ y: w.y, h: w.h, words: [w] });
    }
    let prevY = null;
    const out = [];
    for (const row of rows) {
      if (prevY !== null && prevY - row.y > row.h * 2.2) out.push(""); // a visible gap: blank line
      prevY = row.y;
      let line = "";
      let prev = null;
      for (const w of row.words.sort((a, b) => a.x - b.x)) {
        // Touching the piece before it (a title drawn one letter at a time): same word.
        if (prev && w.x - (prev.x + prev.w) < w.h * 0.12) { line += w.s; prev = w; continue; }
        const col = Math.max(0, Math.round((w.x - left) / cw));
        if (line.length < col) line += " ".repeat(col - line.length);
        else if (line && !line.endsWith(" ")) line += " ";
        line += w.s;
        prev = w;
      }
      out.push(line.replace(/\s+$/, ""));
    }
    pages.push(out.join("\n"));
  }
  // A form feed between pages: a new page is where a new song most often starts (see splitSongs).
  const text = pages.join("\n\f\n").trim();
  if (!text) throw new Error("That PDF has no text to read (it may be a scan or photo). Copy the chords in instead.");
  return text;
}

// ---------- .rtf (TextEdit, WordPad): drop the formatting codes, keep the text ----------
function readRtf(src) {
  let out = "";
  const skip = []; // per group: is this a group to leave out (fonts, colors, pictures)?
  let skipping = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") {
      skip.push(skipping);
      const head = src.slice(i + 1, i + 14);
      if (/^\\(\*|fonttbl|colortbl|stylesheet|info|pict|expandedcolortbl|listtable|header|footer)/.test(head)) skipping = true;
    } else if (c === "}") {
      skipping = skip.length ? skip.pop() : false;
    } else if (c === "\\") {
      const m = /^\\(?:([a-z]+)(-?\d+)? ?|'([0-9a-f]{2})|([\\{}])|(\r?\n))/i.exec(src.slice(i));
      if (!m) continue;
      i += m[0].length - 1;
      if (skipping) continue;
      if (m[3]) out += new TextDecoder("windows-1252").decode(new Uint8Array([parseInt(m[3], 16)]));
      else if (m[4]) out += m[4];
      else if (m[5]) out += "\n";
      else if (m[1] === "par" || m[1] === "line") out += "\n";
      else if (m[1] === "page") out += "\n\f\n";
      else if (m[1] === "tab") out += "    ";
      else if (m[1] === "u") { out += String.fromCharCode((parseInt(m[2], 10) + 65536) % 65536); if (src[i + 1] === "?") i++; }
    } else if (!skipping && c !== "\r" && c !== "\n") {
      out += c;
    }
  }
  return out;
}

// Drop site boilerplate that rides along in PDFs and pages (page numbers, URLs, "Page 1/2").
function tidy(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*(page\s*\d+\s*(\/|of)\s*\d+|\d+\s*\/\s*\d+|https?:\/\/\S+|www\.\S+)\s*$/i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const noPages = (t) => t.replace(/\n?\f\n?/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();

// A first line that's plainly a title (short, not chords, not a "Capo:" or "Key:" line)
// beats the file name. Otherwise the file's name, if it means anything.
function titleOf(text) {
  const first = (text.split("\n").find((l) => l.trim()) || "").replace(/\s+/g, " ").trim();
  const dir = /^\{\s*(?:t|title)\s*:\s*(.+?)\s*\}$/i.exec(first);
  if (dir) return dir[1];
  return titleLike(first) ? first.replace(/\s+(chords|lyrics)$/i, "") : "";
}

function titleLike(line) {
  const t = String(line || "").replace(/\s+/g, " ").trim();
  const CP = window.ChordPro;
  return t.length >= 2 && t.length <= 60 && /[a-z]{2,}/i.test(t) && !META_LINE.test(t) && !CHORDS_ONLY.test(t) &&
    !CP.isChordLine(t) && !CP.isSectionLabel(t) && !/[,;]$/.test(t) && !/\[[A-G]/.test(t);
}

// ---------- One file, several songs ----------
// A songbook or a week's set in one file. Returns [{ title, text }]: one entry per song found,
// or a single entry when it's one song. ChordPro marks songs plainly ({new_song}, or a {title}
// for each); other files are split where a title-like line is followed by a "Key:" or "Capo:"
// line, a section name ("Verse 1", "[Intro]"), or starts a new page. The user is asked before a
// file is split (see app.js), so a wrong guess costs one tap.
const SONG_META = /^\s*((key|capo|tempo|time|bpm|ccli|artist|author|words|music|words and music|written by)\s*[:\-]|key\s+(of\s+)?[A-G][#b]?m?\s*$|capo\s+\d|ccli\b)/i;
function splitSongs(all) {
  const CP = window.ChordPro;
  const lines = all.split("\n");
  const hasChords = (part) => part.split("\n").some((l) => CP.isChordLine(l) || /\[[A-G][^\]]*\]/.test(l));
  let starts = [];
  if (/^\s*\{\s*(new_song|ns)\s*\}\s*$/im.test(all)) {
    lines.forEach((l, i) => { if (/^\s*\{\s*(new_song|ns)\s*\}\s*$/i.test(l)) starts.push(i); });
  } else if ((all.match(/^\s*\{\s*(t|title)\s*:/gim) || []).length > 1) {
    lines.forEach((l, i) => { if (/^\s*\{\s*(t|title)\s*:/i.test(l)) starts.push(i); });
  } else {
    const section = (l) => CP.isSectionLabel(l) || /^\s*\[[A-Za-z][^\]]*\]\s*:?\s*$/.test(l) && !CP.isChord(l.trim().slice(1, -1));
    const nextText = (i) => { while (i < lines.length && !lines[i].trim()) i++; return i; };
    lines.forEach((l, i) => {
      if (!titleLike(l)) return;
      const prev = i === 0 ? "" : lines[i - 1].trim();
      // Titles follow a gap or a new page. Right before "Key:" it's a title anyway (PDFs can lose
      // their blank lines), unless it sits under a line of chords (then it's words to a song).
      if (prev && !(SONG_META.test(lines[i + 1] || "") && !CP.isChordLine(prev))) return;
      const j = nextText(i + 1);
      const after = lines[j] || "";
      const k = nextText(j + 1);
      // Title, then Key/Capo or the first part of a song (Intro, Verse 1): a Chorus or Verse 2 there
      // more likely follows a line of words. Or title, a writer's name, then Key/Capo.
      const titleCase = /^([A-Z0-9][^\s]*|a|an|and|as|at|for|in|is|of|on|the|to)( ([A-Z0-9][^\s]*|a|an|and|as|at|for|in|is|of|on|the|to))+$/.test(l.replace(/\s+/g, " ").trim()) && l.trim().split(/\s+/).length >= 2;
      const opens = (l) => titleCase && section(l) || section(l) && /^\s*[\[(]?\s*(intro|verse\s*1?|v\s*1|part\s*1)\s*[\])]?\s*:?\s*$/i.test(l);
      if (SONG_META.test(after) || opens(after) || (j === i + 1 && titleLike(after) && SONG_META.test(lines[k] || ""))) {
        // "Title / Writer / Key:": the writer's line isn't a second song.
        if (starts.length && i - starts[starts.length - 1] <= 2) return;
        starts.push(i);
      }
    });
  }
  if (!starts.length || starts[0] !== 0) starts.unshift(0);
  const parts = starts.map((s, n) => noPages(lines.slice(s, starts[n + 1] ?? lines.length).join("\n").replace(/^\s*\{\s*(new_song|ns)\s*\}\s*/i, "")))
    .filter((t) => t.trim());
  // A piece without any chords: a heading of a line or two ("Sunday set, March 3") is left out;
  // anything longer joins the song after it, or the one before if it's last.
  const pieces = parts.map((text) => ({ title: titleOf(text), text }));
  const merged = [];
  for (let n = 0; n < pieces.length; n++) {
    const p = pieces[n];
    if (!hasChords(p.text)) {
      if (pieces.length > 1 && p.text.split("\n").filter((l) => l.trim()).length <= 3) continue;
      if (n + 1 < pieces.length) { pieces[n + 1].text = p.text + "\n\n" + pieces[n + 1].text; continue; }
      if (merged.length) { merged[merged.length - 1].text += "\n\n" + p.text; continue; }
    }
    merged.push(p);
  }
  // A song that runs onto a second page often repeats its title there: put the pages back together.
  const out = [];
  const key = (t) => t.toLowerCase().replace(/\s*\(?(cont(inued|'d|\.)?|page \d+)\)?\s*$/i, "").replace(/\s+/g, " ").trim();
  for (const p of merged) {
    const last = out[out.length - 1];
    if (last && p.title && key(last.title) === key(p.title)) {
      const rows = p.text.split("\n");
      last.text += "\n\n" + rows.slice(rows.findIndex((l) => l.trim()) + 1).join("\n");
      continue;
    }
    out.push(p);
  }
  return out.map((s) => ({ title: s.title, text: s.text.replace(/\n{3,}/g, "\n\n").trim() }));
}

window.FileImport = {
  // Can this file be imported?
  supports: (name, type) => !!kindOf({ type }, name),
  accept: ".pdf,.docx,.rtf,.txt,.cho,.chordpro,.chopro,.crd,.pro,.md,.onsong,text/plain,text/rtf,application/rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  splitSongs,
  async read(blob, name = "") {
    const kind = kindOf(blob, name);
    if (!kind) {
      const why = CANT_READ.find(([re]) => re.test(name));
      throw new Error(why ? why[1] : "The songbook can read PDF, Word (.docx), RTF, ChordPro and text files.");
    }
    let raw;
    if (kind === "pdf") raw = await readPdf(blob);
    else if (kind === "docx") raw = await readDocx(blob);
    else {
      raw = await blob.text();
      if (kind === "rtf" || /^\{\\rtf/.test(raw)) raw = readRtf(raw);
      // Not text after all (an old Word file renamed, a picture): say so instead of importing gibberish.
      else if (/[\u0000-\u0008\u000e-\u001a]/.test(raw.slice(0, 2000)) || /\ufffd.*\ufffd.*\ufffd/.test(raw.slice(0, 500))) {
        throw new Error("That file isn't plain text. Save it as PDF, Word (.docx) or text, then import that.");
      }
    }
    const all = tidy(raw);
    const text = noPages(all);
    if (!text) throw new Error("That file is empty.");
    const fallback = baseName(name);
    const songs = splitSongs(all).map((part, n) => ({ text: part.text, title: part.title || (n === 0 ? titleOf(part.text) || fallback : "") }));
    return { title: titleOf(text) || fallback, text, source: "a file", kind, songs: songs.length > 1 ? songs : [] };
  },
};
})();
