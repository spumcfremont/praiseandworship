// Set lists for upcoming services. The edge gate has already checked the session.
import { allSetlists, setStore, settlePastSetlists } from "../lib/setlists.mjs";

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const json = (data, status = 200) => Response.json(data, { status });

function clean(input) {
  const items = Array.isArray(input.items) ? input.items : [];
  return {
    date: DATE_RE.test(input.date || "") ? input.date : "",
    title: typeof input.title === "string" ? input.title.trim().slice(0, 120) : "",
    notes: typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : "",
    items: items
      .filter((i) => i && typeof i.songId === "string" && ID_RE.test(i.songId))
      .slice(0, 40)
      .map((i) => ({ songId: i.songId, shift: Number.isInteger(i.shift) ? Math.max(-11, Math.min(11, i.shift)) : 0 })),
  };
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export default async (req, context) => {
  const store = setStore();
  const { id } = context.params;

  if (!id) {
    if (req.method === "GET") {
      await settlePastSetlists();
      const all = await allSetlists();
      return json({ setlists: all.filter((s) => !s.done).sort((a, b) => a.date.localeCompare(b.date)) });
    }
    if (req.method === "POST") {
      const input = await readBody(req);
      if (!input) return json({ error: "Invalid request" }, 400);
      const set = clean(input);
      if (!set.date) return json({ error: "Pick a date for this set." }, 400);
      const now = new Date().toISOString();
      Object.assign(set, { id: crypto.randomUUID(), done: false, createdAt: now, updatedAt: now });
      await store.setJSON(set.id, set);
      return json({ setlist: set }, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (!ID_RE.test(id)) return json({ error: "Set not found" }, 404);
  const existing = await store.get(id, { type: "json" });
  if (!existing) return json({ error: "Set not found" }, 404);

  switch (req.method) {
    case "GET":
      return json({ setlist: existing });
    case "PUT": {
      const input = await readBody(req);
      if (!input) return json({ error: "Invalid request" }, 400);
      const set = clean(input);
      if (!set.date) return json({ error: "Pick a date for this set." }, 400);
      Object.assign(set, { id, done: false, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
      await store.setJSON(id, set);
      return json({ setlist: set });
    }
    case "DELETE":
      await store.delete(id);
      return json({ ok: true });
    default:
      return json({ error: "Method not allowed" }, 405);
  }
};

export const config = { path: ["/api/setlists", "/api/setlists/:id"] };
