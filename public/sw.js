// Service worker: makes the site installable as a phone app, and shows a friendly
// page when there's no connection. It deliberately caches nothing private: songs
// always come from the server behind the team password.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · Praise & Worship</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#170812;color:#f7ecf2;font:17px/1.5 system-ui;text-align:center;padding:24px">
<div><p style="font:600 13px system-ui;letter-spacing:.14em;text-transform:uppercase;color:#d8a2cf">Praise &amp; Worship</p>
<h1 style="font-weight:500;margin:.2em 0">No connection</h1>
<p style="color:#bba4b4">The songbook needs internet to load. Check Wi-Fi or data, then try again.</p>
<button onclick="location.reload()" style="font:600 16px system-ui;padding:12px 22px;border-radius:999px;border:0;background:#d8a2cf;color:#2b0c22">Try again</button></div>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
  );
});
