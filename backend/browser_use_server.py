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
from contextlib import suppress
from typing import Any

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

    from browser_use import Agent, Browser
    from browser_use.llm import ChatGoogle

    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get(
        "VITE_GEMINI_API_KEY"
    )
    if not gemini_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Export it (or VITE_GEMINI_API_KEY) before starting the server."
        )

    model_id = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
    llm = ChatGoogle(model=model_id, api_key=gemini_key)

    # Headed so the developer can also watch the live window during dev; flip
    # to True (headless=True) for CI/production. We don't need a visible
    # window for the frontend — screenshots are streamed regardless.
    browser = Browser(headless=os.environ.get("HEADLESS", "1") == "1")

    await on_event({"type": "status", "message": "browser spawned"})

    async def step_hook(agent_instance: Any) -> None:  # noqa: ANN401 - browser-use API
        """Called by browser-use after every step."""
        try:
            history = agent_instance.state.history
            last = history.history[-1] if history and history.history else None
            if last is None:
                return

            url = getattr(last.state, "url", None) or ""
            if url:
                await on_event({"type": "navigate", "url": url})

            # Screenshot (base64 PNG without data: prefix).
            screenshot_b64 = getattr(last.state, "screenshot", None)
            if screenshot_b64:
                # Some browser-use versions return raw bytes — normalize to b64.
                if isinstance(screenshot_b64, (bytes, bytearray)):
                    screenshot_b64 = base64.b64encode(screenshot_b64).decode("ascii")
                await on_event(
                    {"type": "screenshot", "data": screenshot_b64, "url": url}
                )

            # Action descriptions for the last step.
            for model_output in last.model_output.action if last.model_output else []:
                action_name = next(iter(model_output.model_dump().keys()), "action")
                await on_event(
                    {
                        "type": "action",
                        "description": f"{action_name}",
                    }
                )

            # Extracted text / thought.
            extracted = getattr(last.result, "extracted_content", None) if last.result else None
            if extracted:
                # extracted_content is sometimes a list of dicts/strings.
                text = (
                    "\n".join(map(str, extracted))
                    if isinstance(extracted, list)
                    else str(extracted)
                )
                await on_event({"type": "extract", "text": text[:500]})
        except Exception as exc:  # noqa: BLE001 - never let a hook crash the run
            logger.warning("step_hook error: %s", exc)

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        use_vision=True,
    )

    try:
        result = await agent.run(on_step_end=step_hook, max_steps=20)
        final_text = ""
        if result and result.history:
            final = result.history[-1]
            if final.result and final.result.extracted_content:
                ec = final.result.extracted_content
                final_text = (
                    "\n".join(map(str, ec)) if isinstance(ec, list) else str(ec)
                )
        return final_text or "Research complete."
    finally:
        with suppress(Exception):
            await browser.close()


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
