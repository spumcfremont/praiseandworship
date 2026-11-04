"""Download the worship team's song files from a Google Drive folder.

Usage (from the project folder):
    python3 dev/drive_import.py --client /path/to/client_secret.json --folder <folder id>

Opens a Google sign-in page in your browser; sign in as the account that owns
the folder and approve read-only access. Files are saved as plain text in
dev/drive-import/ (not committed), ready for "Import chord files" in the app.

Uses only the Python standard library. The access token stays in memory and is
never written to disk.
"""
import argparse, base64, hashlib, http.server, json, os, re, secrets, sys, threading
import urllib.parse, urllib.request, webbrowser, zipfile, io
from xml.etree import ElementTree

SCOPE = "https://www.googleapis.com/auth/drive.readonly"
API = "https://www.googleapis.com/drive/v3"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "drive-import")
TEXT_TYPES = ("text/", "application/x-chordpro")
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
GDOC = "application/vnd.google-apps.document"
FOLDER = "application/vnd.google-apps.folder"


def load_client(path):
    data = json.load(open(path))
    c = data.get("installed") or data.get("web")
    if not c:
        sys.exit("That file doesn't look like a Google OAuth client file.")
    return c


def sign_in(client):
    """OAuth loopback flow with PKCE. Returns an access token."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    result = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" not in q and "error" not in q:
                self.send_response(404); self.end_headers(); return
            result.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            msg = "Signed in. You can close this tab and go back to Claude." if "code" in q else "Sign-in was cancelled."
            self.wfile.write(f"<p style='font:18px system-ui;margin:40px'>{msg}</p>".encode())
            threading.Thread(target=self.server.shutdown, daemon=True).start()

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    redirect = f"http://127.0.0.1:{server.server_port}/"
    url = client["auth_uri"] + "?" + urllib.parse.urlencode({
        "client_id": client["client_id"], "redirect_uri": redirect, "response_type": "code",
        "scope": SCOPE, "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
        "access_type": "online", "prompt": "select_account",
    })
    print("\nOpening Google sign-in in your browser. Sign in as the folder's owner.")
    print("If nothing opens, paste this link into your browser:\n" + url + "\n", flush=True)
    webbrowser.open(url)
    server.serve_forever()

    if result.get("error"):
        sys.exit(f"Google sign-in failed: {result['error']}")
    if result.get("state") != state:
        sys.exit("Sign-in response didn't match this request; stopping.")
    body = urllib.parse.urlencode({
        "code": result["code"], "client_id": client["client_id"], "client_secret": client.get("client_secret", ""),
        "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier,
    }).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(client["token_uri"], data=body)) as r:
            return json.load(r)["access_token"]
    except urllib.error.HTTPError as e:
        sys.exit(f"Couldn't finish sign-in: {e.read().decode()[:300]}")


def get(token, url, raw=False):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read() if raw else json.load(r)


def list_folder(token, folder_id, path=""):
    page = None
    while True:
        q = {"q": f"'{folder_id}' in parents and trashed = false", "pageSize": 1000,
             "fields": "nextPageToken, files(id, name, mimeType, modifiedTime)",
             "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}
        if page:
            q["pageToken"] = page
        data = get(token, f"{API}/files?" + urllib.parse.urlencode(q))
        for f in data.get("files", []):
            if f["mimeType"] == FOLDER:
                yield from list_folder(token, f["id"], os.path.join(path, f["name"]))
            else:
                f["path"] = path
                yield f
        page = data.get("nextPageToken")
        if not page:
            return


def docx_text(blob):
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    root = ElementTree.fromstring(zipfile.ZipFile(io.BytesIO(blob)).read("word/document.xml"))
    lines = []
    for p in root.iter(f"{{{ns['w']}}}p"):
        parts = []
        for node in p.iter():
            tag = node.tag.split("}")[1]
            if tag == "t":
                parts.append(node.text or "")
            elif tag == "tab":
                parts.append("\t")
            elif tag in ("br", "cr"):
                parts.append("\n")
        lines.append("".join(parts))
    return "\n".join(lines)


def safe_name(name):
    return re.sub(r'[\\/:*?"<>|]+', "-", name).strip() or "untitled"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", required=True, help="OAuth client JSON downloaded from Google Cloud Console")
    ap.add_argument("--folder", required=True, help="Drive folder ID")
    args = ap.parse_args()

    token = sign_in(load_client(args.client))
    os.makedirs(OUT, exist_ok=True)
    report = {"saved": [], "skipped": []}
    for f in list_folder(token, args.folder):
        label = os.path.join(f["path"], f["name"])
        try:
            mt = f["mimeType"]
            if mt == GDOC:
                text = get(token, f"{API}/files/{f['id']}/export?mimeType=text/plain", raw=True).decode("utf-8-sig")
            elif mt == DOCX:
                text = docx_text(get(token, f"{API}/files/{f['id']}?alt=media&supportsAllDrives=true", raw=True))
            elif mt.startswith(TEXT_TYPES) or re.search(r"\.(cho|chordpro|chopro|crd|pro|txt)$", f["name"], re.I):
                text = get(token, f"{API}/files/{f['id']}?alt=media&supportsAllDrives=true", raw=True).decode("utf-8-sig", "replace")
            else:
                report["skipped"].append({"file": label, "type": mt})
                print(f"  skipped  {label}  ({mt})")
                continue
            base = safe_name(re.sub(r"\.(docx?|txt|cho|chordpro|chopro|crd|pro)$", "", f["name"], flags=re.I))
            out = os.path.join(OUT, base + ".txt")
            n = 2
            while os.path.exists(out):
                out = os.path.join(OUT, f"{base} ({n}).txt"); n += 1
            open(out, "w").write(text.replace("\r\n", "\n"))
            report["saved"].append({"file": label, "saved_as": os.path.basename(out), "type": mt})
            print(f"  saved    {label}")
        except Exception as e:
            report["skipped"].append({"file": label, "type": f.get("mimeType"), "error": str(e)})
            print(f"  failed   {label}  ({e})")
    json.dump(report, open(os.path.join(OUT, "_report.json"), "w"), indent=1)
    print(f"\nDone: {len(report['saved'])} saved, {len(report['skipped'])} skipped. Files are in dev/drive-import/")


if __name__ == "__main__":
    main()
