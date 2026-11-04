# Praise & Worship — St. Paul UMC

The worship team's private song library with chords, at **praiseteam.belongatstpaul.org**.

- One shared team password, no usernames. Every page and API call is checked by a Netlify Edge Function (`netlify/edge-functions/gate.js`) before anything is served.
- Songs are stored in Netlify Blobs, so anyone on the team can add or edit songs from a phone, iPad or laptop.
- Paste chords from anywhere: sheets with chords on their own line above the words get converted to inline [ChordPro](https://www.chordpro.org/) automatically.
- **Find it online** (on Add a song): search Ultimate Guitar (chords) and Hymnary.org (hymn words), or paste a link from either, and the sheet drops into the editor with chords lined up. Ultimate Guitar sometimes blocks server requests; when it does, the app says so and you can paste the sheet instead.
- **Open a file / Import chord files**: ChordPro files (e.g. SongSelect downloads) or plain-text chord sheets, one at a time in the editor or many at once from the song list (titles already in the songbook are skipped).
- On each song: transpose up/down (remembered per device), text size, hide chords (for singers), two columns on wide screens, keep-screen-awake, print, and a "We sang this today" history.
- **Set lists**: the next set sits at the top of the dashboard. Each song in a set can be transposed (saved for the whole team), edited or removed, and **Print all** prints the whole set as one document. Once a set's date has passed (Pacific time) it clears itself and adds that date to each song's "last sung".
- **Stats** page: most sung song, top 10, recent services, songs not sung in a while.
- **Install on phones**: `/install` walks people through adding it to their home screen (no app store).
- "Download a backup of every song" saves songs and upcoming sets as JSON; "Import chord files or a backup" restores one (songs already in the songbook are skipped).

## Layout

```
public/                 static app (no build step)
  index.html, app.js    song list, song view, editor
  chordpro.js           chord parsing, transposing, chords-over-lyrics conversion
  login.html, login.js  password page
netlify/
  edge-functions/gate.js   blocks everything without a valid session
  functions/login.mjs      checks the password, sets a signed 30-day cookie (rate limited)
  functions/logout.mjs
  functions/songs.mjs      song CRUD in Netlify Blobs
  functions/lookup.mjs     online search/import (only fetches ultimate-guitar.com and hymnary.org)
  lib/session.mjs          shared signing/verification (Web Crypto)
```

## Deploying (one time)

1. **Push this folder to a GitHub repo** (private is fine).
2. **Netlify → Add new site → Import from Git**, pick the repo. Build command: leave empty. Publish directory: `public` (already set in `netlify.toml`).
3. **Site configuration → Environment variables**, add:
   - `SITE_PASSWORD`: the team password.
   - `SESSION_SECRET`: a long random string. Generate one with `openssl rand -base64 32`.
   Then trigger a redeploy.
4. **Domain management → Add a domain**: `praiseteam.belongatstpaul.org`. Netlify will show the target, e.g. `praiseteamspumc.netlify.app`.
5. **Squarespace → Domains → belongatstpaul.org → DNS settings → Add record**:
   - Type `CNAME`, Host `praiseteam`, Data `praiseteamspumc.netlify.app`
6. Back in Netlify, wait for the domain to verify; HTTPS is issued automatically (usually within an hour).

## Testing locally

No Node needed: `python3 dev/server.py`, then open http://127.0.0.1:8787 (password `test`). It mirrors the Netlify functions in Python and keeps its data in `dev/songs.json` and `dev/setlists.json` (not committed).

## Changing the password

Update `SITE_PASSWORD` in Netlify and redeploy. Everyone is signed out and will need the new password.
