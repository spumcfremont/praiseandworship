// Finds songs online (Ultimate Guitar for chords, Hymnary.org for hymn texts).
// GET /api/lookup?q=title  -> search results
// GET /api/lookup?url=...  -> one song's text, as chords over lyrics
// Runs behind the edge gate, and only ever fetches the hosts listed here.
const HOSTS = new Set(["www.ultimate-guitar.com", "tabs.ultimate-guitar.com", "ultimate-guitar.com", "hymnary.org"]);
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const json = (data, status = 200) => Response.json(data, { status });

function allowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOSTS.has(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!allowed(res.url)) throw new Error("Unexpected redirect");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&rsquo;/g, "’").replace(/&lsquo;/g, "‘")
    .replace(/&amp;/g, "&");
}

// ---------- Ultimate Guitar ----------
function ugStore(html) {
  const m = /class=['"]js-store['"][^>]*data-content=['"]([^'"]+)['"]/.exec(html);
  if (!m) throw new Error("Ultimate Guitar didn't return a song page");
  return JSON.parse(decodeEntities(m[1]));
}

async function searchUG(q) {
  const store = ugStore(await fetchText(`https://www.ultimate-guitar.com/search.php?title=${encodeURIComponent(q)}&type=300`));
  const results = store?.store?.page?.data?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r) => r.type === "Chords" && !r.marketing_type && allowed(r.tab_url))
    .sort((a, b) => (b.votes || 0) - (a.votes || 0))
    .slice(0, 8)
    .map((r) => ({
      source: "Ultimate Guitar",
      title: r.song_name,
      artist: r.artist_name,
      key: r.tonality_name || "",
      detail: [r.version > 1 ? `Version ${r.version}` : "", r.votes ? `${r.votes} ratings` : ""].filter(Boolean).join(" · "),
      url: r.tab_url,
    }));
}

function cleanUG(content) {
  return content
    .replace(/\r\n?/g, "\n")
    .replace(/\[\/?(ch|tab)\]/gi, "")
    .split("\n")
    // Drop "Artist:/Song:" headers and chord-fingering lines like "Bsus4/E  024400".
    .filter((l) => !/^\s*(artist|song)\s*:/i.test(l) && !/^\s*\S+\s+[0-9xX]{6}\s*$/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function getUG(url) {
  const data = ugStore(await fetchText(url))?.store?.page?.data;
  const content = data?.tab_view?.wiki_tab?.content;
  if (!content) throw new Error("That page doesn't have a chord sheet we can read");
  return {
    source: "Ultimate Guitar",
    title: data.tab?.song_name || "",
    artist: data.tab?.artist_name || "",
    key: data.tab?.tonality_name || "",
    capo: Math.max(0, Math.min(11, parseInt(data.tab_view?.meta?.capo, 10) || 0)),
    text: decodeEntities(cleanUG(content)),
    url,
  };
}

// ---------- Hymnary.org ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function searchHymnary(q) {
  const csv = await fetchText(`https://hymnary.org/search?qu=${encodeURIComponent(` textTitle:${q} media:text in:texts`)}&export=csv`);
  const [head, ...rows] = parseCsv(csv);
  if (!head) return [];
  const col = (name) => head.indexOf(name);
  const [title, slug, authors, langs, count] = ["displayTitle", "textAuthNumber", "authors", "languages", "totalInstances"].map(col);
  return rows
    .filter((r) => r[slug])
    .sort((a, b) => Number(b[count] || 0) - Number(a[count] || 0))
    .slice(0, 5)
    .map((r) => ({
      source: "Hymnary",
      title: r[title],
      artist: r[authors] || "",
      key: "",
      detail: ["Words only", r[langs]].filter(Boolean).join(" · "),
      url: `https://hymnary.org/text/${encodeURIComponent(r[slug])}`,
    }));
}

async function getHymnary(url) {
  const html = await fetchText(url);
  const m = /<div property=['"]text['"]>([\s\S]*?)<\/div>\s*<\/div>/.exec(html) || /<div property=['"]text['"]>([\s\S]*?)<\/div>/.exec(html);
  if (!m) throw new Error("Hymnary doesn't have the full words for that hymn");
  const stanzas = m[1]
    .split(/<\/p>/i)
    .map((p) => decodeEntities(p.replace(/<br\s*\/?>\s*/gi, "\n").replace(/<[^>]+>/g, "")).trim())
    .filter(Boolean)
    .map((p) => {
      const n = /^(\d+)\.?\s+/.exec(p);
      return n ? `Verse ${n[1]}\n${p.slice(n[0].length)}` : p;
    });
  const title = /<title>([^<|]+)/.exec(html);
  return {
    source: "Hymnary",
    title: title ? decodeEntities(title[1]).trim() : "",
    artist: "",
    key: "",
    text: stanzas.join("\n\n"),
    url,
  };
}

export default async (req) => {
  const params = new URL(req.url).searchParams;
  const link = params.get("url");
  if (link) {
    const u = allowed(link);
    if (!u) return json({ error: "Links from Ultimate Guitar or Hymnary.org only, for now." }, 400);
    try {
      return json({ song: u.hostname === "hymnary.org" ? await getHymnary(u.href) : await getUG(u.href) });
    } catch (err) {
      return json({ error: `Couldn't read that page (${err.message}). You can copy the chord sheet and paste it instead.` }, 502);
    }
  }

  const q = (params.get("q") || "").trim().slice(0, 120);
  if (!q) return json({ error: "Type a song title to search." }, 400);
  const [ug, hymnary] = await Promise.allSettled([searchUG(q), searchHymnary(q)]);
  const errors = [];
  if (ug.status === "rejected") errors.push("Ultimate Guitar didn't answer. It sometimes blocks requests; try again later or paste the sheet.");
  if (hymnary.status === "rejected") errors.push("Hymnary.org didn't answer.");
  return json({
    results: [...(ug.status === "fulfilled" ? ug.value : []), ...(hymnary.status === "fulfilled" ? hymnary.value : [])],
    errors,
  });
};

export const config = { path: "/api/lookup" };
