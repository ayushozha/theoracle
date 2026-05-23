# AgentBazaar — browser-use backend

A small FastAPI service that runs a real Chromium session via
[`browser-use`](https://github.com/browser-use/browser-use) and streams every
navigation, action, screenshot, and extraction over a WebSocket. The React
chat picks the stream up and renders the agent's browsing inline.

## One-time setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

## Run

The server reads `GEMINI_API_KEY` (falls back to `VITE_GEMINI_API_KEY`) from
the environment. The repo `.env` already has it — load it inline:

```bash
set -a; source ../.env; set +a
uvicorn browser_use_server:app --port 8765 --host 0.0.0.0
```

Or just:

```bash
GEMINI_API_KEY=... uvicorn browser_use_server:app --port 8765
```

Watch the live browser window during dev by overriding the headless flag:

```bash
HEADLESS=0 uvicorn browser_use_server:app --port 8765
```

## Research Sources

The default demo path is public-only and does not need marketplace accounts:

- Buyer demand: Craigslist wanted posts, Reddit `r/appleswap` WTB search, Reddit `r/hardwareswap` WTB search.
- Price comps: Craigslist for-sale search, eBay sold listings, Swappa search, Back Market search.
- Optional actor fallback: Facebook Marketplace and OfferUp can run through Apify when `APIFY_TOKEN` is set. Override actors with `APIFY_FACEBOOK_MARKETPLACE_ACTOR_ID` and `APIFY_OFFERUP_ACTOR_ID`.

Guardrails are enforced in code: no login, no DMs/messages, no posting, no checkout/payment, no captcha bypass, and no private buyer contact scraping.

## Protocol

WebSocket endpoint: `ws://localhost:8765/ws/research`

Client sends one JSON message and then listens:

```jsonc
// → server
{ "task": "Where should I sell my MacBook Pro M3 18/512 with $725 floor?" }

// ← server (one JSON object per frame)
{ "type": "status",     "message": "browser spawned" }
{ "type": "navigate",   "url": "https://swappa.com/macbook" }
{ "type": "screenshot", "data": "<base64 PNG>", "url": "https://swappa.com/macbook" }
{ "type": "action",     "description": "click_element" }
{ "type": "extract",    "text": "Median sold price: $815" }
{ "type": "done",       "report": "## Top recommendation: Swappa..." }
{ "type": "error",      "message": "..." }
```

The frontend (`src/browser/browserClient.ts`) treats this as an async
generator of typed events.

## Frontend wiring

Set `VITE_BROWSER_USE_WS_URL` in the project root `.env` if you change the
port or host. Default: `ws://localhost:8765/ws/research`.
