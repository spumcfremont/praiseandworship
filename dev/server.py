"""Local stand-in for the Netlify backend, for testing without Node.

Run from the project folder:  python3 dev/server.py
Then open http://127.0.0.1:8787 and sign in with the password "test".

Mirrors netlify/edge-functions/gate.js, netlify/functions/{login,logout,songs,lookup}.mjs.
Songs are saved to dev/songs.json (not committed) so they survive restarts.
"""
import csv, datetime, html, io, json, os, re, urllib.parse, urllib.request, uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
PASSWORD = "test"
TOKEN = "local-dev-session"  # fixed so restarts don't sign you out (local only)
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "songs.json")
SONGS = json.load(open(DATA)) if os.path.exists(DATA) else {}


SETS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "setlists.json")
SETS = json.load(open(SETS_FILE)) if os.path.exists(SETS_FILE) else {}
SET_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def save():
    write_json(DATA, SONGS)
    write_json(SETS_FILE, SETS)


def today_local():
    # Mirrors setlists.mjs: the church's time zone decides when a Sunday is over.
    from zoneinfo import ZoneInfo
    return datetime.datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d")


def settle_past_setlists():
    today, changed = today_local(), False
    for st in SETS.values():
        if st.get("done") or not st.get("date") or st["date"] >= today:
            continue
        for item in st.get("items", []):
            song = SONGS.get(item["songId"])
            if song and st["date"] not in (song.get("sung") or []):
                song["sung"] = sorted(set(song.get("sung") or []) | {st["date"]}, reverse=True)
                song["updatedAt"] = now()
        st.update(done=True, settledAt=now())
        changed = True
    if changed:
        save()


def clean_set(d):
    items = d.get("items") if isinstance(d.get("items"), list) else []
    return {
        "date": d["date"] if DATE_RE.match(str(d.get("date") or "")) else "",
        "title": str(d.get("title") or "").strip()[:120],
        "notes": str(d.get("notes") or "").strip()[:2000],
        "items": [{"songId": i["songId"], "shift": max(-11, min(11, i["shift"])) if isinstance(i.get("shift"), int) else 0}
                  for i in items if isinstance(i, dict) and SET_ID.match(str(i.get("songId") or ""))][:40],
    }
OPEN = {"/login", "/login.html", "/login.js", "/api/login", "/styles.css", "/favicon.svg", "/robots.txt",
        "/manifest.webmanifest", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png",
        "/praise-team.png", "/saint-paul-logo.png", "/favicon-32.png",
        "/install", "/install.html", "/install.js", "/sw.js"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# ---------- lookup (mirror of lookup.mjs) ----------
HOSTS = {"www.ultimate-guitar.com", "tabs.ultimate-guitar.com", "ultimate-guitar.com", "hymnary.org"}
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
           "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}


def allowed(url):
    try:
        u = urllib.parse.urlparse(url)
    except Exception:
        return None
    return u if u.scheme == "https" and u.hostname in HOSTS else None


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=10) as r:
        if not allowed(r.geturl()):
            raise Exception("Unexpected redirect")
        return r.read().decode("utf-8", "replace")


def ug_store(h):
    m = re.search(r"""class=['"]js-store['"][^>]*data-content=['"]([^'"]+)['"]""", h)
    if not m:
        raise Exception("Ultimate Guitar didn't return a song page")
    return json.loads(html.unescape(m[1]))


def search_ug(q):
    res = ug_store(fetch("https://www.ultimate-guitar.com/search.php?title=%s&type=300" % urllib.parse.quote(q)))["store"]["page"]["data"].get("results") or []
    res = [r for r in res if r.get("type") == "Chords" and not r.get("marketing_type") and allowed(r.get("tab_url", ""))]
    res.sort(key=lambda r: -(r.get("votes") or 0))
    out = []
    for r in res[:8]:
        detail = [f"Version {r['version']}" if (r.get("version") or 0) > 1 else "", f"{r['votes']} ratings" if r.get("votes") else ""]
        out.append({"source": "Ultimate Guitar", "title": r["song_name"], "artist": r["artist_name"], "key": r.get("tonality_name") or "",
                    "detail": " · ".join(x for x in detail if x), "url": r["tab_url"]})
    return out


def clean_ug(c):
    c = re.sub(r"\[/?(ch|tab)\]", "", c.replace("\r\n", "\n").replace("\r", "\n"), flags=re.I)
    lines = [l for l in c.split("\n") if not re.match(r"^\s*(artist|song)\s*:", l, re.I) and not re.match(r"^\s*\S+\s+[0-9xX]{6}\s*$", l)]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def get_ug(url):
    d = ug_store(fetch(url))["store"]["page"]["data"]
    c = ((d.get("tab_view") or {}).get("wiki_tab") or {}).get("content")
    if not c:
        raise Exception("That page doesn't have a chord sheet we can read")
    t = d.get("tab") or {}
    try:
        capo = max(0, min(11, int((d.get("tab_view") or {}).get("meta", {}).get("capo") or 0)))
    except (TypeError, ValueError):
        capo = 0
    return {"source": "Ultimate Guitar", "title": t.get("song_name", ""), "artist": t.get("artist_name", ""),
            "key": t.get("tonality_name") or "", "capo": capo, "text": html.unescape(clean_ug(c)), "url": url}


def search_hymnary(q):
    text = fetch("https://hymnary.org/search?qu=%s&export=csv" % urllib.parse.quote(f" textTitle:{q} media:text in:texts"))
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return []
    head, rows = rows[0], rows[1:]
    c = {n: head.index(n) for n in ["displayTitle", "textAuthNumber", "authors", "languages", "totalInstances"]}
    rows = [r for r in rows if len(r) == len(head) and r[c["textAuthNumber"]]]
    rows.sort(key=lambda r: -int(r[c["totalInstances"]] or 0))
    return [{"source": "Hymnary", "title": r[c["displayTitle"]], "artist": r[c["authors"]], "key": "",
             "detail": " · ".join(x for x in ["Words only", r[c["languages"]]] if x),
             "url": "https://hymnary.org/text/" + urllib.parse.quote(r[c["textAuthNumber"]])} for r in rows[:5]]


def get_hymnary(url):
    h = fetch(url)
    m = re.search(r"""<div property=['"]text['"]>([\s\S]*?)</div>\s*</div>""", h) or re.search(r"""<div property=['"]text['"]>([\s\S]*?)</div>""", h)
    if not m:
        raise Exception("Hymnary doesn't have the full words for that hymn")
    out = []
    for p in re.split(r"</p>", m[1], flags=re.I):
        p = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>\s*", "\n", p, flags=re.I))).strip()
        if not p:
            continue
        n = re.match(r"^(\d+)\.?\s+", p)
        out.append(f"Verse {n[1]}\n{p[n.end():]}" if n else p)
    t = re.search(r"<title>([^<|]+)", h)
    return {"source": "Hymnary", "title": html.unescape(t[1]).strip() if t else "", "artist": "", "key": "", "text": "\n\n".join(out), "url": url}


def lookup(qs):
    link = (qs.get("url") or [""])[0]
    if link:
        u = allowed(link)
        if not u:
            return 400, {"error": "Links from Ultimate Guitar or Hymnary.org only, for now."}
        try:
            return 200, {"song": get_hymnary(link) if u.hostname == "hymnary.org" else get_ug(link)}
        except Exception as e:
            return 502, {"error": f"Couldn't read that page ({e}). You can copy the chord sheet and paste it instead."}
    q = (qs.get("q") or [""])[0].strip()[:120]
    if not q:
        return 400, {"error": "Type a song title to search."}
    results, errors = [], []
    try:
        results += search_ug(q)
    except Exception:
        errors.append("Ultimate Guitar didn't answer. It sometimes blocks requests; try again later or paste the sheet.")
    try:
        results += search_hymnary(q)
    except Exception:
        errors.append("Hymnary.org didn't answer.")
    return 200, {"results": results, "errors": errors}


# ---------- server ----------
def now():
    return datetime.datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def path_only(self):
        return urllib.parse.urlparse(self.path).path

    def json(self, data, code=200, headers=None):
        b = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return None

    def gate(self):
        p = self.path_only()
        if p in OPEN or f"pw_session={TOKEN}" in (self.headers.get("Cookie") or ""):
            return True
        if p.startswith("/api/"):
            self.json({"error": "Please sign in."}, 401)
        else:
            self.send_response(302)
            self.send_header("Location", "/login" + ("" if p == "/" else "?next=" + urllib.parse.quote(p)))
            self.end_headers()
        return False

    def song_id(self):
        m = re.match(r"^/api/songs/([A-Za-z0-9-]{1,64})$", self.path_only())
        return m[1] if m else None

    def set_id(self):
        m = re.match(r"^/api/setlists/([A-Za-z0-9-]{1,64})$", self.path_only())
        return m[1] if m else None

    def do_GET(self):
        if not self.gate():
            return
        p = self.path_only()
        if p == "/api/songs":
            settle_past_setlists()
            return self.json({"songs": list(SONGS.values())})
        if p == "/api/setlists":
            settle_past_setlists()
            return self.json({"setlists": sorted([x for x in SETS.values() if not x.get("done")], key=lambda x: x["date"])})
        if p.startswith("/api/setlists/"):
            i = self.set_id()
            return self.json({"setlist": SETS[i]}) if i in SETS else self.json({"error": "Set not found"}, 404)
        if p == "/dev/drive-import.json":  # local only: songs prepared by dev/pdf_chords.py
            f = os.path.join(os.path.dirname(os.path.abspath(__file__)), "drive-import", "songs.json")
            return self.json(json.load(open(f)) if os.path.exists(f) else [])
        if p == "/api/lookup":
            code, data = lookup(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))
            return self.json(data, code)
        if p.startswith("/api/songs/"):
            i = self.song_id()
            return self.json({"song": SONGS[i]}) if i in SONGS else self.json({"error": "Song not found"}, 404)
        if p == "/login":
            self.path = "/login.html"
        if p == "/install":
            self.path = "/install.html"
        super().do_GET()

    def do_HEAD(self):
        if self.gate():
            super().do_HEAD()

    def do_POST(self):
        if not self.gate():
            return
        p = self.path_only()
        if p == "/api/login":
            if (self.body() or {}).get("password") == PASSWORD:
                return self.json({"ok": True}, 200, {"Set-Cookie": f"pw_session={TOKEN}; Path=/; HttpOnly; SameSite=Lax"})
            return self.json({"error": "That password didn't work."}, 401)
        if p == "/api/logout":
            return self.json({"ok": True}, 200, {"Set-Cookie": "pw_session=; Path=/; Max-Age=0"})
        if p == "/api/setlists":
            d = self.body()
            if not d:
                return self.json({"error": "Invalid request"}, 400)
            st = clean_set(d)
            if not st["date"]:
                return self.json({"error": "Pick a date for this set."}, 400)
            st.update(id=str(uuid.uuid4()), done=False, createdAt=now(), updatedAt=now())
            SETS[st["id"]] = st
            save()
            return self.json({"setlist": st}, 201)
        if p == "/api/songs":
            d = self.body()
            if not d or not str(d.get("title", "")).strip():
                return self.json({"error": "Every song needs a title."}, 400)
            d.pop("baseUpdatedAt", None)
            d.update(id=str(uuid.uuid4()), createdAt=now(), updatedAt=now())
            SONGS[d["id"]] = d
            save()
            return self.json({"song": d}, 201)
        self.json({"error": "Not found"}, 404)

    def do_PUT(self):
        if not self.gate():
            return
        if self.path_only().startswith("/api/setlists/"):
            i, d = self.set_id(), self.body()
            if i not in SETS:
                return self.json({"error": "Set not found"}, 404)
            st = clean_set(d or {})
            if not st["date"]:
                return self.json({"error": "Pick a date for this set."}, 400)
            st.update(id=i, done=False, createdAt=SETS[i]["createdAt"], updatedAt=now())
            SETS[i] = st
            save()
            return self.json({"setlist": st})
        i, d = self.song_id(), self.body()
        if i not in SONGS:
            return self.json({"error": "Song not found"}, 404)
        if not d or not str(d.get("title", "")).strip():
            return self.json({"error": "Every song needs a title."}, 400)
        e = SONGS[i]
        if d.get("baseUpdatedAt") and d["baseUpdatedAt"] != e["updatedAt"]:
            return self.json({"error": "conflict", "song": e}, 409)
        d.pop("baseUpdatedAt", None)
        d.update(id=i, createdAt=e["createdAt"], updatedAt=now())
        SONGS[i] = d
        save()
        self.json({"song": d})

    def do_PATCH(self):
        if not self.gate():
            return
        i, d = self.song_id(), self.body() or {}
        if i not in SONGS:
            return self.json({"error": "Song not found"}, 404)
        e = SONGS[i]
        sung = set(e.get("sung") or [])
        if DATE_RE.match(d.get("addSung") or ""):
            sung.add(d["addSung"])
        if DATE_RE.match(d.get("removeSung") or ""):
            sung.discard(d["removeSung"])
        e.update(sung=sorted(sung, reverse=True), updatedAt=now())
        save()
        self.json({"song": e})

    def do_DELETE(self):
        if not self.gate():
            return
        if self.path_only().startswith("/api/setlists/"):
            SETS.pop(self.set_id(), None)
            save()
            return self.json({"ok": True})
        SONGS.pop(self.song_id(), None)
        save()
        self.json({"ok": True})


if __name__ == "__main__":
    print("Praise & Worship local copy: http://127.0.0.1:8787  (password: test)")
    ThreadingHTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
