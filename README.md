# Oracle

Barter matchmaking against real Craigslist listings. Drop a photo (or chat) about something
you want to trade; the Oracle finds a multi-hop ring of trades that gets you what you want,
no money involved.

Built at the Google I/O Hackathon 2026 (Cerebral Valley + DeepMind).

- `index.html` — single-page app, runs in browser
- `seed.json` — 222 structured listings scraped + extracted from sfbay.craigslist.org/search/bar
- `seed_embedded.json` — same listings with `gemini-embedding-001` vectors (legacy, unused by current chat flow)
- `archive/v1-listing-grid/` — pre-pivot snapshot, see archive/README.md

## Run

Static page, no build. Serve the dir:
```
python3 -m http.server 8766
```
Open http://localhost:8766/.

## Stack

- Gemini 3.5 Flash (`generateContent` + `streamGenerateContent`) for chat, vision, and ring matching
- Function calling for the search tool
- Speculative pre-fetch: after every user turn, predict the likely tool call and run the
  matcher in the background so it's hot when the Oracle decides to invoke it
- No backend; API key is embedded for hackathon convenience
