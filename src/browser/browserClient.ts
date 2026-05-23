// Thin WebSocket client for the browser-use backend.
//
// Exposes `streamBrowserResearch(task)` as an async generator that yields
// typed BrowserAction frames as they arrive. The frontend folds these into
// a BrowserViewState (see `./types.ts`) and renders an inline viewport.

import type { BrowserAction } from './types';

const DEFAULT_WS_URL = 'ws://localhost:8765/ws/research';

function resolveWsUrl(): string {
  return (
    (import.meta.env.VITE_BROWSER_USE_WS_URL as string | undefined) ||
    DEFAULT_WS_URL
  );
}

export interface StreamBrowserOptions {
  task: string;
  signal?: AbortSignal;
  /** Override the default backend WebSocket URL. */
  url?: string;
}

/**
 * Stream live browser-use events for one research task.
 *
 * The first frame the backend emits is usually `{type: "status"}`. The
 * stream ends naturally on a `done` or `error` frame (we yield those too
 * so the UI can render the final state) or when the socket closes.
 *
 * Aborting the signal closes the socket cleanly. Network failures throw.
 */
export async function* streamBrowserResearch(
  opts: StreamBrowserOptions,
): AsyncGenerator<BrowserAction, void, void> {
  const url = opts.url || resolveWsUrl();
  const ws = new WebSocket(url);

  // Queue of frames received but not yet yielded, plus a deferred used to
  // unblock the generator when the next frame arrives.
  const queue: BrowserAction[] = [];
  let resolver: (() => void) | null = null;
  let closed = false;
  let socketError: Error | null = null;

  const wake = () => {
    if (resolver) {
      const r = resolver;
      resolver = null;
      r();
    }
  };

  const onAbort = () => {
    closed = true;
    try {
      ws.close();
    } catch {
      // ignore
    }
    wake();
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`Failed to connect to ${url}`));
  });

  // Kick off the task.
  ws.send(JSON.stringify({ task: opts.task }));

  ws.onmessage = (ev) => {
    try {
      const frame = JSON.parse(ev.data) as BrowserAction;
      queue.push(frame);
      wake();
    } catch (err) {
      socketError = err instanceof Error ? err : new Error(String(err));
      closed = true;
      wake();
    }
  };
  ws.onerror = () => {
    socketError = new Error('WebSocket error');
    closed = true;
    wake();
  };
  ws.onclose = () => {
    closed = true;
    wake();
  };

  try {
    while (true) {
      if (queue.length === 0) {
        if (closed) break;
        await new Promise<void>((r) => (resolver = r));
        continue;
      }
      const frame = queue.shift() as BrowserAction;
      yield frame;
      if (frame.type === 'done' || frame.type === 'error') {
        // Server typically closes after these, but don't wait.
        break;
      }
    }
    if (socketError) throw socketError;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }
}
