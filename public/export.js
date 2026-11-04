/* Lyrics-only export for slides / teleprompter: copy for Google Docs, or download a Word file. */
(function (root) {
  "use strict";
  const CP = root.ChordPro;
  const esc = CP.esc;

  // One song -> [{ label, lines[] }] blocks, words only (no chords, tabs or comments).
  function lyricBlocks(song) {
    const blocks = [];
    let cur = null;
    const start = (label) => { cur = { label, lines: [] }; blocks.push(cur); };
    for (const it of CP.parse(song.body).items) {
      if (it.type === "section") start(it.label);
      else if (it.type === "start" && it.label) start(it.label);
      else if (it.type === "blank") { if (cur && cur.lines.length) start(""); }
      else if (it.type === "line") {
        const text = it.segments.map((s) => s.text).join("");
        // Sheets copied from two-column PDFs put two phrases on one line with a wide gap: split them.
        for (const part of text.split(/\s{3,}/)) {
          const line = part.replace(/\s+/g, " ").trim();
          if (line) { if (!cur) start(""); cur.lines.push(line); }
        }
      }
    }
    // Sections with no words (Intro, Instrumental…) don't belong on slides.
    return blocks.filter((b) => b.lines.length);
  }

  function plainText(songs, heading) {
    const out = [];
    if (heading) out.push(heading, "");
    songs.forEach((song, i) => {
      if (i) out.push("", "");
      out.push(song.title.toUpperCase());
      if (song.artist) out.push(song.artist);
      for (const b of lyricBlocks(song)) {
        out.push("");
        if (b.label) out.push(`[${b.label}]`);
        out.push(...b.lines);
      }
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }

  function html(songs, heading) {
    let h = heading ? `<h1>${esc(heading)}</h1>` : "";
    songs.forEach((song, i) => {
      if (i) h += `<hr style="page-break-before:always;break-before:page">`;
      h += `<h2>${esc(song.title)}</h2>`;
      if (song.artist) h += `<p><i>${esc(song.artist)}</i></p>`;
      for (const b of lyricBlocks(song)) {
        if (b.label) h += `<p><b>${esc(b.label)}</b></p>`;
        if (b.lines.length) h += `<p>${b.lines.map(esc).join("<br>")}</p>`;
      }
    });
    return `<meta charset="utf-8">${h}`;
  }

  // ---------- Minimal .docx writer (stored zip, no compression library needed) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, content] of files) {
      const nameB = enc.encode(name);
      const data = enc.encode(content);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nameB.length, true);
      parts.push(new Uint8Array(local.buffer), nameB, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameB);
      offset += 30 + nameB.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

  const x = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const para = (text, style, opts = {}) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}` +
    (opts.pageBreak ? `<w:r><w:br w:type="page"/></w:r>` : "") +
    (Array.isArray(text)
      ? `<w:r>${opts.bold ? "<w:rPr><w:b/></w:rPr>" : ""}${text.map((t, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${x(t)}</w:t>`).join("")}</w:r>`
      : `<w:r>${opts.bold ? "<w:rPr><w:b/></w:rPr>" : opts.italic ? "<w:rPr><w:i/></w:rPr>" : ""}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`) +
    `</w:p>`;

  function docx(songs, heading) {
    let body = heading ? para(heading, "Title") : "";
    songs.forEach((song, i) => {
      body += para(song.title, "Heading1", { pageBreak: i > 0 || !!heading });
      if (song.artist) body += para(song.artist, "", { italic: true });
      for (const b of lyricBlocks(song)) {
        if (b.label) body += para(b.label, "", { bold: true });
        if (b.lines.length) body += para(b.lines);
      }
    });
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const style = (id, name, size, extra = "") =>
      `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/>${extra}</w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    return zip([
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
      ["word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${style("Title", "Title", 40)}${style("Heading1", "heading 1", 32, '<w:outlineLvl w:val="0"/>')}</w:styles>`],
      ["word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`],
    ]);
  }

  // ---------- Dialog ----------
  function open(songs, { heading = "", filename = "lyrics", toast = () => {} } = {}) {
    let dlg = document.getElementById("lyrics-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "lyrics-dialog";
      dlg.className = "lyrics-dialog";
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
      <form method="dialog">
        <h2>Lyrics only</h2>
        <p class="hint">${songs.length === 1 ? "This song's" : `All ${songs.length} songs'`} words without chords, with section labels, ready for slides or the teleprompter.</p>
        <button class="btn primary" type="button" data-x="copy">Copy for Google Docs</button>
        <p class="fine">Then open a Google Doc and paste. Each song starts on a new page.</p>
        <button class="btn" type="button" data-x="docx">Download Word file (.docx)</button>
        <p class="fine">Upload to Google Drive and open with Google Docs, or open in Word or Pages.</p>
        <button class="btn" type="button" data-x="txt">Download plain text (.txt)</button>
        <button class="btn ghost" value="close">Close</button>
      </form>`;
    const save = (blob, ext) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${filename}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    dlg.onclick = async (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      if (b.dataset.x === "copy") {
        try {
          if (root.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
            await navigator.clipboard.write([new ClipboardItem({
              "text/html": new Blob([html(songs, heading)], { type: "text/html" }),
              "text/plain": new Blob([plainText(songs, heading)], { type: "text/plain" }),
            })]);
          } else {
            await navigator.clipboard.writeText(plainText(songs, heading));
          }
          toast("Lyrics copied. Paste them into a Google Doc.");
          dlg.close();
        } catch {
          toast("Couldn't copy here. Use the Word file instead.");
        }
      } else if (b.dataset.x === "docx") {
        save(docx(songs, heading), "docx");
        toast("Word file downloaded.");
      } else if (b.dataset.x === "txt") {
        save(new Blob([plainText(songs, heading)], { type: "text/plain;charset=utf-8" }), "txt");
        toast("Text file downloaded.");
      }
    };
    dlg.showModal();
  }

  root.LyricsExport = { open, lyricBlocks, plainText, html, docx };
})(window);
