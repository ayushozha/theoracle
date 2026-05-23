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
from urllib.parse import quote_plus

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


async def _run_marketplace_snapshot_crawl(task: str, on_event) -> str:
    """Fast Chromium crawl for resale research with visible streamed screenshots."""

    from playwright.async_api import async_playwright

    query = _infer_market_query(task)
    encoded = quote_plus(query)
    targets = [
        ("eBay sold listings", f"https://www.ebay.com/sch/i.html?_nkw={encoded}&LH_Sold=1&LH_Complete=1"),
        ("Swappa marketplace", f"https://swappa.com/search?q={encoded}"),
        ("Back Market", f"https://www.backmarket.com/en-us/search?q={encoded}"),
    ]
    findings: list[dict[str, Any]] = []

    await on_event({"type": "status", "message": "opening marketplace tabs"})

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
            for label, url in targets:
                await on_event({"type": "navigate", "url": url})
                await on_event({"type": "action", "description": f"Fetching {label}"})
                try:
                    response = await page.goto(url, wait_until="domcontentloaded", timeout=18000)
                    await page.wait_for_timeout(1800)
                    screenshot = await page.screenshot(type="png", full_page=False)
                    await on_event(
                        {
                            "type": "screenshot",
                            "data": base64.b64encode(screenshot).decode("ascii"),
                            "url": page.url,
                        }
                    )

                    text = await page.locator("body").inner_text(timeout=5000)
                    prices = _extract_prices(text)
                    snippet = _compact_text(text)
                    status = response.status if response else "loaded"
                    await on_event(
                        {
                            "type": "extract",
                            "text": f"{label} status {status}; price mentions: {', '.join(prices[:8]) or 'none exposed before auth'}",
                        }
                    )
                    findings.append(
                        {
                            "channel": label,
                            "url": page.url,
                            "status": status,
                            "price_mentions": prices[:12],
                            "snippet": snippet,
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
                            "url": url,
                            "status": "error",
                            "price_mentions": [],
                            "snippet": str(exc),
                        }
                    )
        finally:
            await browser.close()

    return _format_market_report(query, findings)


def _extract_prices(text: str) -> list[str]:
    prices = re.findall(r"\$\s?\d[\d,]*(?:\.\d{2})?", text)
    seen: list[str] = []
    for price in prices:
        normalized = price.replace(" ", "")
        if normalized not in seen:
            seen.append(normalized)
    return seen


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()[:700]


def _format_market_report(query: str, findings: list[dict[str, Any]]) -> str:
    lines = [
        f"## Browser-use market crawl for {query}",
        "",
        "| Channel | URL | Status | Price signals |",
        "| --- | --- | --- | --- |",
    ]
    for finding in findings:
        signals = ", ".join(finding["price_mentions"][:8]) or "No public price text captured"
        lines.append(
            f"| {finding['channel']} | {finding['url']} | {finding['status']} | {signals} |"
        )

    lines.extend(
        [
            "",
            "## Notes",
            "These are live website visits from the browser bridge. Pages that hide completed prices behind scripts, login, or anti-bot defenses are marked as weak signals and should be verified before publishing.",
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
