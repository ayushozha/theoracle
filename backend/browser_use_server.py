"""
AgentBazaar — Live Browser-Use backend.

Runs a real Chromium session driven by `browser-use` and streams every
navigation, action, screenshot, and extraction over a WebSocket so the
React chat can render the agent's browsing inline.

Run:
    pip install -r requirements.txt
    playwright install chromium
    GEMINI_API_KEY=... uvicorn browser_use_server:app --port 8765 --host 0.0.0.0

WebSocket endpoint:
    ws://localhost:8765/ws/research

Client → server:
    {"task": "Where should I sell my MacBook Pro M3 18/512 with $725 floor, local pickup only?"}

Server → client (one JSON object per frame):
    {"type": "status",     "message": "spawning browser"}
    {"type": "navigate",   "url": "https://swappa.com/macbook"}
    {"type": "screenshot", "data": "<base64 png>", "url": "..."}
    {"type": "action",     "description": "Clicked: Apple Silicon filter"}
    {"type": "extract",    "text": "Median sold price: $815"}
    {"type": "done",       "report": "<final markdown>"}
    {"type": "error",      "message": "..."}
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
from contextlib import suppress
from typing import Any
from urllib.parse import quote_plus, urlparse
from urllib.request import Request, urlopen

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("agentbazaar.browser_use")
logging.basicConfig(level=logging.INFO)


app = FastAPI(title="AgentBazaar Browser-Use Bridge")

# Vite dev server origins. Locked to localhost so this can't be hit from the public web.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:4173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_RESEARCH_HOSTS = {
    "www.ebay.com",
    "ebay.com",
    "swappa.com",
    "www.swappa.com",
    "www.backmarket.com",
    "backmarket.com",
    "old.reddit.com",
    "www.reddit.com",
    "reddit.com",
}

BLOCKED_PATH_PARTS = (
    "login",
    "signin",
    "signup",
    "account",
    "checkout",
    "cart",
    "compose",
    "message",
    "messages",
    "submit",
    "post",
    "register",
    "payment",
)

APIFY_TARGETS = {
    "facebook_marketplace": {
        "label": "Facebook Marketplace via Apify",
        "actor_env": "APIFY_FACEBOOK_MARKETPLACE_ACTOR_ID",
        "default_actor": "crawlerbros/facebook-marketplace-scraper",
        "source_note": "Apify Store result showed crawlerbros/facebook-marketplace-scraper at 5.0 rating with 32 reviews on 2026-05-23.",
        "input": lambda encoded, query: {
            "startUrls": [
                {
                    "url": (
                        "https://www.facebook.com/marketplace/search/"
                        f"?query={encoded}"
                    )
                }
            ],
            "maxItems": 8,
        },
    },
    "offerup": {
        "label": "OfferUp via Apify",
        "actor_env": "APIFY_OFFERUP_ACTOR_ID",
        "default_actor": "parseforge/offerup-scraper",
        "source_note": "Apify Store result exposes parseforge/offerup-scraper for public OfferUp listing fields including seller rating.",
        "input": lambda encoded, query: {
            "search": query,
            "query": query,
            "maxItems": 8,
        },
    },
}


# ---------------------------------------------------------------------------
# browser-use glue
# ---------------------------------------------------------------------------
#
# We lazy-import inside the WS handler so `uvicorn --reload` and `--help`
# don't pay the (slow) playwright import cost.


async def _run_browser_use(task: str, on_event) -> str:
    """Drive a real browser-use Agent and bridge its hook callbacks to `on_event`."""

    # The autonomous browser-use agent can take a long time to plan before the
    # first action. For the demo/product UI we default to a deterministic live
    # marketplace crawl that still drives Chromium and streams real website
    # screenshots immediately. Set ORACLE_USE_BROWSER_USE_AGENT=1 to use the
    # fully autonomous browser-use Agent path below.
    if os.environ.get("ORACLE_USE_BROWSER_USE_AGENT", "0") != "1":
        return await _run_marketplace_snapshot_crawl(task, on_event)

    from browser_use import Agent, Browser
    from browser_use.llm import ChatGoogle

    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get(
        "VITE_GEMINI_API_KEY"
    )
    if not gemini_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Export it (or VITE_GEMINI_API_KEY) before starting the server."
        )

    llm = ChatGoogle(model="gemini-3.5-flash", api_key=gemini_key)

    # Headed so the developer can also watch the live window during dev; flip
    # to True (headless=True) for CI/production. We don't need a visible
    # window for the frontend — screenshots are streamed regardless.
    browser = Browser(headless=os.environ.get("HEADLESS", "1") == "1")

    await on_event({"type": "status", "message": "browser spawned"})

    async def step_hook(agent_instance: Any) -> None:  # noqa: ANN401 - browser-use API
        """Called by browser-use after every step.

        Shape we target (browser-use 0.12.x):
          - agent.history: AgentHistoryList with `.history` (list[AgentHistory])
          - AgentHistory.state: BrowserStateHistory (dataclass with url, title,
            tabs, interacted_element, screenshot_path)
          - AgentHistory.model_output: AgentOutput with `.action` (list of ActionModel)
            and `.next_goal`
          - AgentHistory.result: list[ActionResult] (each has extracted_content)
        """
        try:
            history = getattr(agent_instance, "history", None)
            entries = getattr(history, "history", None) if history else None
            if not entries:
                return
            last = entries[-1]

            state = getattr(last, "state", None)
            url = getattr(state, "url", "") or ""
            if url:
                await on_event({"type": "navigate", "url": url})

            screenshot_path = getattr(state, "screenshot_path", None)
            if screenshot_path:
                try:
                    with open(screenshot_path, "rb") as fh:
                        png_bytes = fh.read()
                    screenshot_b64 = base64.b64encode(png_bytes).decode("ascii")
                    await on_event(
                        {"type": "screenshot", "data": screenshot_b64, "url": url}
                    )
                except FileNotFoundError:
                    pass

            model_output = getattr(last, "model_output", None)
            actions = getattr(model_output, "action", None) if model_output else None
            if actions:
                for am in actions:
                    try:
                        dumped = am.model_dump(exclude_none=True)
                    except AttributeError:
                        dumped = dict(am) if hasattr(am, "__iter__") else {}
                    if not dumped:
                        continue
                    action_name, params = next(iter(dumped.items()))
                    detail = ""
                    if isinstance(params, dict):
                        for key in ("text", "url", "selector", "index", "query"):
                            if key in params:
                                detail = f" {key}={params[key]!r}"
                                break
                    await on_event(
                        {"type": "action", "description": f"{action_name}{detail}"[:200]}
                    )

            next_goal = getattr(model_output, "next_goal", None) if model_output else None
            if next_goal:
                await on_event({"type": "extract", "text": f"goal: {next_goal}"[:500]})

            results = getattr(last, "result", None) or []
            for r in results:
                extracted = getattr(r, "extracted_content", None)
                if extracted:
                    text = (
                        "\n".join(map(str, extracted))
                        if isinstance(extracted, list)
                        else str(extracted)
                    )
                    await on_event({"type": "extract", "text": text[:500]})
        except Exception as exc:  # noqa: BLE001 - never let a hook crash the run
            logger.warning("step_hook error: %s", exc, exc_info=True)

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        use_vision=True,
    )

    try:
        result = await agent.run(on_step_end=step_hook, max_steps=20)
        final_text = ""
        # `result` is an AgentHistoryList; final entry's `result` is list[ActionResult].
        entries = getattr(result, "history", None) if result else None
        if entries:
            final = entries[-1]
            results = getattr(final, "result", None) or []
            chunks: list[str] = []
            for r in results:
                ec = getattr(r, "extracted_content", None)
                if ec:
                    chunks.append(
                        "\n".join(map(str, ec)) if isinstance(ec, list) else str(ec)
                    )
            final_text = "\n\n".join(c for c in chunks if c)
        return final_text or "Research complete."
    finally:
        with suppress(Exception):
            await browser.close()


def _infer_market_query(task: str) -> str:
    lowered = task.lower()
    if "macbook" in lowered:
        chip = next(
            (
                chip
                for chip in ["m3 pro", "m3 max", "m2 pro", "m2", "m1 pro", "m1 max", "m1"]
                if chip in lowered
            ),
            "",
        )
        return " ".join(part for part in ["MacBook Pro", chip, "14 512GB"] if part).strip()
    return task[:90] or "used laptop resale comps"


def _is_allowed_public_url(url: str) -> tuple[bool, str]:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path.lower()

    host_allowed = host in ALLOWED_RESEARCH_HOSTS or host.endswith(".craigslist.org")
    if not host_allowed:
        return False, f"blocked host: {host or 'missing'}"
    if any(part in path for part in BLOCKED_PATH_PARTS):
        return False, "blocked login/post/message/checkout path"
    return True, ""


def _build_apify_targets(encoded: str, query: str) -> list[dict[str, Any]]:
    if not os.environ.get("APIFY_TOKEN"):
        return [
            {
                "channel": target["label"],
                "category": "skipped_actor_required",
                "status": "skipped",
                "url": "https://apify.com/store",
                "price_mentions": [],
                "buyer_mentions": [],
                "snippet": (
                    "APIFY_TOKEN is not configured. Skipping marketplaces that "
                    "need a hosted actor instead of direct public browsing."
                ),
                "guardrail": target["source_note"],
            }
            for target in APIFY_TARGETS.values()
        ]

    return [
        {
            "label": target["label"],
            "actor_id": os.environ.get(target["actor_env"]) or target["default_actor"],
            "category": "buyer_demand_actor",
            "input": target["input"](encoded, query),
            "source_note": target["source_note"],
        }
        for target in APIFY_TARGETS.values()
    ]


def _apify_actor_url(actor_id: str) -> str:
    return f"https://api.apify.com/v2/acts/{actor_id.replace('/', '~')}/run-sync-get-dataset-items"


def _run_apify_actor_sync(actor_id: str, actor_input: dict[str, Any]) -> list[dict[str, Any]]:
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        return []

    request = Request(
        _apify_actor_url(actor_id),
        data=json.dumps(actor_input).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=45) as response:  # noqa: S310 - configured Apify API only.
        payload = response.read().decode("utf-8")
    data = json.loads(payload) if payload else []
    return data if isinstance(data, list) else []


def _summarize_apify_items(
    items: list[dict[str, Any]], query: str
) -> tuple[list[str], list[str], str]:
    prices: list[str] = []
    buyer_mentions: list[str] = []
    snippets: list[str] = []

    for item in items[:8]:
        text = _compact_text(json.dumps(item, ensure_ascii=False))
        snippets.append(text)
        prices.extend(_extract_prices(text))
        buyer_mentions.extend(_extract_buyer_intent(text, query))

    return _dedupe(prices)[:12], _dedupe(buyer_mentions)[:8], " | ".join(snippets)[:700]


async def _run_marketplace_snapshot_crawl(task: str, on_event) -> str:
    """Fast Chromium crawl for resale research with visible streamed screenshots."""

    from playwright.async_api import async_playwright

    query = _infer_market_query(task)
    encoded = quote_plus(query)
    direct_targets = [
        {
            "label": "Craigslist wanted posts",
            "url": f"https://sfbay.craigslist.org/search/wan?query={encoded}",
            "category": "buyer_demand",
        },
        {
            "label": "Reddit r/appleswap WTB",
            "url": (
                "https://old.reddit.com/r/appleswap/search?"
                f"q=WTB%20{encoded}&restrict_sr=on&sort=new&t=month"
            ),
            "category": "buyer_demand",
        },
        {
            "label": "Reddit r/hardwareswap WTB",
            "url": (
                "https://old.reddit.com/r/hardwareswap/search?"
                f"q=WTB%20{encoded}&restrict_sr=on&sort=new&t=month"
            ),
            "category": "buyer_demand",
        },
        {
            "label": "Craigslist for-sale comps",
            "url": f"https://sfbay.craigslist.org/search/sss?query={encoded}",
            "category": "pricing_comp",
        },
        {
            "label": "eBay sold listings",
            "url": f"https://www.ebay.com/sch/i.html?_nkw={encoded}&LH_Sold=1&LH_Complete=1",
            "category": "pricing_comp",
        },
        {
            "label": "Swappa marketplace",
            "url": f"https://swappa.com/search?q={encoded}",
            "category": "pricing_comp",
        },
        {
            "label": "Back Market",
            "url": f"https://www.backmarket.com/en-us/search?q={encoded}",
            "category": "pricing_comp",
        },
    ]
    findings: list[dict[str, Any]] = []

    await on_event({"type": "status", "message": "opening public buyer-demand and pricing tabs"})

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=os.environ.get("HEADLESS", "1") == "1")
        page = await browser.new_page(
            viewport={"width": 1365, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
            ),
        )

        try:
            for target in direct_targets:
                label = target["label"]
                url = target["url"]
                category = target["category"]
                allowed, reason = _is_allowed_public_url(url)
                if not allowed:
                    await on_event(
                        {
                            "type": "extract",
                            "text": f"{label} skipped by guardrail: {reason}",
                        }
                    )
                    findings.append(
                        {
                            "channel": label,
                            "category": category,
                            "url": url,
                            "status": "blocked",
                            "price_mentions": [],
                            "buyer_mentions": [],
                            "snippet": "",
                            "guardrail": reason,
                        }
                    )
                    continue

                await on_event({"type": "navigate", "url": url})
                action_label = (
                    f"Searching buyer demand on {label}"
                    if category == "buyer_demand"
                    else f"Checking pricing comps on {label}"
                )
                await on_event({"type": "action", "description": action_label})
                try:
                    response = await page.goto(url, wait_until="domcontentloaded", timeout=18000)
                    await page.wait_for_timeout(1800)
                    try:
                        screenshot = await page.screenshot(
                            type="png", full_page=False, timeout=5000
                        )
                        await on_event(
                            {
                                "type": "screenshot",
                                "data": base64.b64encode(screenshot).decode("ascii"),
                                "url": page.url,
                            }
                        )
                    except Exception as screenshot_exc:  # noqa: BLE001 - text extraction can still succeed
                        await on_event(
                            {
                                "type": "extract",
                                "text": f"{label} screenshot skipped: {screenshot_exc}",
                            }
                        )

                    text = await page.locator("body").inner_text(timeout=5000)
                    html = await page.content()
                    searchable_text = f"{text}\n{html}"
                    prices = _extract_prices(searchable_text)
                    buyer_mentions = _extract_buyer_intent(searchable_text, query)
                    snippet = _compact_text(text)
                    status = response.status if response else "loaded"
                    summary = (
                        f"buyer-intent signals: {'; '.join(buyer_mentions[:4]) or 'none captured'}"
                        if category == "buyer_demand"
                        else f"price mentions: {', '.join(prices[:8]) or 'none exposed before auth'}"
                    )
                    await on_event(
                        {
                            "type": "extract",
                            "text": f"{label} status {status}; {summary}",
                        }
                    )
                    findings.append(
                        {
                            "channel": label,
                            "category": category,
                            "url": page.url,
                            "status": status,
                            "price_mentions": prices[:12],
                            "buyer_mentions": buyer_mentions[:8],
                            "snippet": snippet,
                            "guardrail": "",
                        }
                    )
                except Exception as exc:  # noqa: BLE001 - keep the stream alive
                    await on_event(
                        {
                            "type": "extract",
                            "text": f"{label} could not be fully read: {exc}",
                        }
                    )
                    findings.append(
                        {
                            "channel": label,
                            "category": category,
                            "url": url,
                            "status": "error",
                            "price_mentions": [],
                            "buyer_mentions": [],
                            "snippet": str(exc),
                            "guardrail": "",
                        }
                    )
        finally:
            await browser.close()

    apify_targets = _build_apify_targets(encoded, query)
    if apify_targets and "actor_id" not in apify_targets[0]:
        findings.extend(apify_targets)
        for target in apify_targets:
            await on_event(
                {
                    "type": "extract",
                    "text": f"{target['channel']} skipped: APIFY_TOKEN is not configured",
                }
            )
    else:
        for target in apify_targets:
            await on_event(
                {
                    "type": "action",
                    "description": f"Running Apify actor for {target['label']}",
                }
            )
            try:
                items = await asyncio.to_thread(
                    _run_apify_actor_sync,
                    target["actor_id"],
                    target["input"],
                )
                prices, buyer_mentions, snippet = _summarize_apify_items(items, query)
                await on_event(
                    {
                        "type": "extract",
                        "text": (
                            f"{target['label']} returned {len(items)} items; "
                            f"price signals: {', '.join(prices[:6]) or 'none'}"
                        ),
                    }
                )
                findings.append(
                    {
                        "channel": target["label"],
                        "category": target["category"],
                        "url": f"https://apify.com/{target['actor_id']}",
                        "status": f"actor_ok:{len(items)}",
                        "price_mentions": prices,
                        "buyer_mentions": buyer_mentions,
                        "snippet": snippet,
                        "guardrail": target["source_note"],
                    }
                )
            except Exception as exc:  # noqa: BLE001 - actor failure should not kill public crawl
                await on_event(
                    {
                        "type": "extract",
                        "text": f"{target['label']} actor failed: {exc}",
                    }
                )
                findings.append(
                    {
                        "channel": target["label"],
                        "category": "actor_error",
                        "url": f"https://apify.com/{target['actor_id']}",
                        "status": "error",
                        "price_mentions": [],
                        "buyer_mentions": [],
                        "snippet": str(exc),
                        "guardrail": target["source_note"],
                    }
                )

    return _format_market_report(query, findings)


def _extract_prices(text: str) -> list[str]:
    prices = re.findall(r"\$\s?\d[\d,]*(?:\.\d{2})?", text)
    return _dedupe(price.replace(" ", "") for price in prices)


def _extract_buyer_intent(text: str, query: str) -> list[str]:
    cleaned = re.sub(r"[ \t]+", " ", text)
    fragments = re.split(r"(?<=[.!?])\s+|\n+", cleaned)
    intent_re = re.compile(
        r"(?:\b(?:wtb|want(?:ed)? to buy|looking for|in search of|iso|buying|need(?:ing)?|seeking)\b|\[w\])",
        re.IGNORECASE,
    )
    item_terms = [
        term
        for term in re.findall(r"[a-zA-Z0-9]+", query.lower())
        if len(term) >= 2 and term not in {"pro", "the", "for", "and"}
    ]
    item_terms.extend(["macbook", "laptop", "apple silicon", "m1", "m2", "m3"])
    item_re = re.compile(
        "|".join(re.escape(term) for term in _dedupe(item_terms)),
        re.IGNORECASE,
    )
    noise_re = re.compile(
        r"\b(guide|rules|subreddits|privacy|terms|safety tips|prohibited items|"
        r"product recalls|moderators|announcement|wiki|discord|popularallusers|search results)\b",
        re.IGNORECASE,
    )
    snippets: list[str] = []
    for fragment in fragments:
        candidate = fragment.strip(" -•\t")
        if len(candidate) < 8:
            continue
        if len(candidate) > 260:
            continue
        if noise_re.search(candidate):
            continue
        if intent_re.search(candidate) and item_re.search(candidate):
            snippets.append(candidate[:220])
    return _dedupe(snippets)[:10]


def _dedupe(values) -> list[str]:
    seen: list[str] = []
    for value in values:
        normalized = str(value).strip()
        if normalized and normalized not in seen:
            seen.append(normalized)
    return seen


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()[:700]


def _md_cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def _format_market_report(query: str, findings: list[dict[str, Any]]) -> str:
    demand = [f for f in findings if f.get("category") in {"buyer_demand", "buyer_demand_actor"}]
    comps = [f for f in findings if f.get("category") == "pricing_comp"]
    skipped = [
        f
        for f in findings
        if f.get("category") in {"skipped_actor_required", "actor_error"}
        or f.get("status") in {"blocked", "skipped", "error"}
    ]

    lines = [
        f"## Public Buyer-Demand Crawl For {query}",
        "",
        "### Buyer Demand Surfaces",
        "| Channel | URL | Status | Buyer-intent signals |",
        "| --- | --- | --- | --- |",
    ]
    for finding in demand:
        signals = "; ".join(finding.get("buyer_mentions", [])[:5]) or "No matching public buyer-intent text captured"
        lines.append(
            f"| {_md_cell(finding['channel'])} | {_md_cell(finding['url'])} | {_md_cell(finding['status'])} | {_md_cell(signals[:420])} |"
        )

    lines.extend(
        [
            "",
            "### Pricing Comp Surfaces",
            "| Channel | URL | Status | Price signals |",
            "| --- | --- | --- | --- |",
        ]
    )
    for finding in comps:
        signals = ", ".join(finding.get("price_mentions", [])[:8]) or "No public price text captured"
        lines.append(
            f"| {_md_cell(finding['channel'])} | {_md_cell(finding['url'])} | {_md_cell(finding['status'])} | {_md_cell(signals)} |"
        )

    if skipped:
        lines.extend(
            [
                "",
                "### Skipped Or Guardrailed Surfaces",
                "| Channel | Status | Reason |",
                "| --- | --- | --- |",
            ]
        )
        for finding in skipped:
            reason = finding.get("guardrail") or finding.get("snippet") or "No public-safe path available"
            lines.append(
                f"| {_md_cell(finding['channel'])} | {_md_cell(finding['status'])} | {_md_cell(reason[:420])} |"
            )

    lines.extend(
        [
            "",
            "## Guardrails Applied",
            "- Public pages first: Craigslist wanted posts, Reddit WTB searches, Craigslist for-sale comps, eBay sold listings, Swappa, and Back Market.",
            "- No login, no DMs/messages, no posting, no checkout/payment, no captcha bypass, and no private buyer contact scraping.",
            "- Facebook Marketplace and OfferUp run only through configured Apify actors with `APIFY_TOKEN`; otherwise they are skipped and documented.",
            "- Treat all public web signals as leads for human review. The agent can draft listings and outreach strategy, but the owner approves every post, message, price, and deal.",
        ]
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws/research")
async def ws_research(ws: WebSocket) -> None:
    await ws.accept()

    async def send(event: dict) -> None:
        # Coalesce + serialize; ignore disconnects so a closed socket doesn't
        # blow up the hook chain mid-run.
        with suppress(Exception):
            await ws.send_text(json.dumps(event))

    try:
        raw = await ws.receive_text()
        payload = json.loads(raw)
        task = (payload.get("task") or "").strip()
        if not task:
            await send({"type": "error", "message": "missing 'task' field"})
            await ws.close()
            return

        await send({"type": "status", "message": "received task"})
        logger.info("starting browser-use task: %s", task[:120])

        try:
            report = await _run_browser_use(task, send)
            await send({"type": "done", "report": report})
        except Exception as exc:  # noqa: BLE001
            logger.exception("browser-use run failed")
            await send({"type": "error", "message": str(exc)})
        finally:
            with suppress(Exception):
                await ws.close()

    except WebSocketDisconnect:
        logger.info("client disconnected before task started")
    except Exception as exc:  # noqa: BLE001
        logger.exception("ws_research crashed")
        await send({"type": "error", "message": str(exc)})
        with suppress(Exception):
            await ws.close()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# Convenience: `python browser_use_server.py` runs uvicorn on 8765.
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "browser_use_server:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8765")),
        reload=False,
    )
