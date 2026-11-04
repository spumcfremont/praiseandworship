// Set lists: shared helpers, including "settling" sets whose date has passed.
import { getStore } from "@netlify/blobs";

export const TIME_ZONE = "America/Los_Angeles"; // the church's local time decides when a Sunday is over

export const setStore = () => getStore({ name: "setlists", consistency: "strong" });
export const songStore = () => getStore({ name: "songs", consistency: "strong" });

export function todayLocal() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function allSetlists() {
  const store = setStore();
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
}

// Once a set's date has passed: add that date to every song in it ("last sung"),
// then mark the set done so it drops off the dashboard. Safe to run repeatedly.
export async function settlePastSetlists() {
  const today = todayLocal();
  const sets = setStore();
  const songs = songStore();
  const all = await allSetlists();
  for (const set of all) {
    if (set.done || !set.date || set.date >= today) continue;
    for (const item of set.items || []) {
      const song = await songs.get(item.songId, { type: "json" });
      if (!song) continue;
      const sung = new Set(song.sung || []);
      if (sung.has(set.date)) continue;
      sung.add(set.date);
      song.sung = [...sung].sort().reverse();
      song.updatedAt = new Date().toISOString();
      await songs.setJSON(song.id, song);
    }
    set.done = true;
    set.settledAt = new Date().toISOString();
    await sets.setJSON(set.id, set);
  }
  return all;
}
