// Song storage. The edge gate has already checked the session before this runs.
import { getStore } from "@netlify/blobs";
import { settlePastSetlists } from "../lib/setlists.mjs";

const songs = () => getStore({ name: "songs", consistency: "strong" });
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LIMITS = { title: 200, artist: 200, key: 12, tempo: 20, time: 12, link: 500, notes: 5000, body: 60000 };

const json = (data, status = 200) => Response.json(data, { status });

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dates(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((d) => typeof d === "string" && DATE_RE.test(d)))].sort().reverse().slice(0, 500);
}

function clean(input) {
  const song = {};
  for (const [field, max] of Object.entries(LIMITS)) song[field] = text(input[field], max);
  song.body = typeof input.body === "string" ? input.body.replace(/\r\n?/g, "\n").slice(0, LIMITS.body) : "";
  song.tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map((t) => text(t, 40)).filter(Boolean))].slice(0, 30)
    : [];
  song.sung = dates(input.sung);
  if (song.link && !/^https?:\/\//i.test(song.link)) song.link = "";
  return song;
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export default async (req, context) => {
  const store = songs();
  const { id } = context.params;

  if (!id) {
    if (req.method === "GET") {
      await settlePastSetlists(); // past sets add their date to each song's "last sung"
      const { blobs } = await store.list();
      const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
      return json({ songs: all.filter(Boolean) });
    }
    if (req.method === "POST") {
      const input = await readBody(req);
      if (!input) return json({ error: "Invalid request" }, 400);
      const song = clean(input);
      if (!song.title) return json({ error: "Every song needs a title." }, 400);
      const now = new Date().toISOString();
      Object.assign(song, { id: crypto.randomUUID(), createdAt: now, updatedAt: now });
      await store.setJSON(song.id, song);
      return json({ song }, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (!ID_RE.test(id)) return json({ error: "Song not found" }, 404);
  const existing = await store.get(id, { type: "json" });
  if (!existing) return json({ error: "Song not found" }, 404);

  switch (req.method) {
    case "GET":
      return json({ song: existing });

    case "PUT": {
      const input = await readBody(req);
      if (!input) return json({ error: "Invalid request" }, 400);
      if (input.baseUpdatedAt && input.baseUpdatedAt !== existing.updatedAt) {
        return json({ error: "conflict", song: existing }, 409);
      }
      const song = clean(input);
      if (!song.title) return json({ error: "Every song needs a title." }, 400);
      Object.assign(song, { id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
      await store.setJSON(id, song);
      return json({ song });
    }

    // Small atomic-ish edits that shouldn't clobber someone else's open editor.
    case "PATCH": {
      const input = (await readBody(req)) || {};
      const sung = new Set(existing.sung || []);
      if (DATE_RE.test(input.addSung || "")) sung.add(input.addSung);
      if (DATE_RE.test(input.removeSung || "")) sung.delete(input.removeSung);
      const song = { ...existing, sung: dates([...sung]), updatedAt: new Date().toISOString() };
      await store.setJSON(id, song);
      return json({ song });
    }

    case "DELETE":
      await store.delete(id);
      return json({ ok: true });

    default:
      return json({ error: "Method not allowed" }, 405);
  }
};

export const config = { path: ["/api/songs", "/api/songs/:id"] };
