// Discriminated union for the live browser-use stream. Mirrors the JSON
// frames the Python backend emits over `/ws/research`. See backend/README.md.

export type BrowserAction =
  | { type: 'status'; message: string }
  | { type: 'navigate'; url: string }
  | { type: 'screenshot'; data: string; url: string }
  | { type: 'action'; description: string }
  | { type: 'extract'; text: string }
  | { type: 'done'; report: string }
  | { type: 'error'; message: string };

/** Frame kinds the inline viewport renders. */
export type RenderableBrowserAction = Exclude<
  BrowserAction,
  { type: 'done' } | { type: 'error' }
>;

/** Latest snapshot the inline viewport draws from. */
export interface BrowserViewState {
  /** Most recent URL seen on a `navigate` or `screenshot` frame. */
  url: string;
  /** Base64 PNG of the most recent screenshot frame (no `data:` prefix). */
  screenshot: string | null;
  /** Last ~8 action/extract descriptions in oldest→newest order. */
  log: string[];
  /** Most recent status message (e.g., "browser spawned"). */
  status: string;
  /** True once a `done` frame has been received. */
  done: boolean;
  /** Set if an `error` frame closed the stream. */
  error: string | null;
  /** Final markdown report, set when `done` arrives. */
  report: string | null;
}

export const initialBrowserViewState: BrowserViewState = {
  url: '',
  screenshot: null,
  log: [],
  status: 'connecting',
  done: false,
  error: null,
  report: null,
};

/** Fold a stream of actions into the latest viewport state. */
export function reduceBrowserState(
  prev: BrowserViewState,
  action: BrowserAction,
): BrowserViewState {
  switch (action.type) {
    case 'status':
      return { ...prev, status: action.message };
    case 'navigate':
      return { ...prev, url: action.url, status: 'navigating' };
    case 'screenshot':
      return {
        ...prev,
        url: action.url || prev.url,
        screenshot: action.data,
        status: 'rendering',
      };
    case 'action':
      return {
        ...prev,
        log: [...prev.log, action.description].slice(-16),
        status: action.description,
      };
    case 'extract':
      return {
        ...prev,
        log: [...prev.log, `extract: ${action.text.slice(0, 120)}`].slice(-16),
      };
    case 'done':
      return { ...prev, done: true, status: 'complete', report: action.report };
    case 'error':
      return { ...prev, error: action.message, status: 'error' };
    default: {
      // exhaustiveness guard
      const _never: never = action;
      return _never;
    }
  }
}
