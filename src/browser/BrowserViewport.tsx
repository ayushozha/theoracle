// Compact inline browser viewport. Renders the latest screenshot + URL bar
// + most recent action label. Mounts inside a chat message bubble while a
// browser-use stream is running, and stays mounted (showing the final
// frame) after `done`.

import { Globe, Maximize2, Loader2, AlertTriangle, Check } from 'lucide-react';
import type { BrowserViewState } from './types';

interface Props {
  state: BrowserViewState;
  onExpand: () => void;
}

function StatusBadge({ state }: { state: BrowserViewState }) {
  if (state.error) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded">
        <AlertTriangle className="w-3 h-3" /> Error
      </span>
    );
  }
  if (state.done) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
        <Check className="w-3 h-3" /> Done
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
      <Loader2 className="w-3 h-3 animate-spin" /> Live
    </span>
  );
}

export default function BrowserViewport({ state, onExpand }: Props) {
  const lastAction = state.log.length > 0 ? state.log[state.log.length - 1] : state.status;
  const hostname = (() => {
    try {
      return state.url ? new URL(state.url).hostname.replace(/^www\./, '') : '';
    } catch {
      return state.url;
    }
  })();

  return (
    <div className="not-prose my-2 rounded-xl border border-emerald-500/20 bg-slate-50 overflow-hidden shadow-sm">
      {/* Chrome */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-white border-b border-black/5">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
        </div>
        <div className="flex-1 flex items-center gap-1.5 bg-slate-100 rounded-md px-2 py-1 min-w-0">
          <Globe className="w-3 h-3 text-text-muted flex-shrink-0" />
          <span className="text-[10px] text-text-secondary truncate font-mono">
            {hostname || 'spawning browser…'}
          </span>
        </div>
        <StatusBadge state={state} />
        <button
          onClick={onExpand}
          title="Expand"
          className="p-1 rounded hover:bg-black/5 text-text-secondary"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      </div>

      {/* Screenshot */}
      <div className="relative w-full bg-slate-100" style={{ aspectRatio: '16 / 10' }}>
        {state.screenshot ? (
          <img
            src={`data:image/png;base64,${state.screenshot}`}
            alt="Live browser viewport"
            className="absolute inset-0 w-full h-full object-cover object-top"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            {state.status}
          </div>
        )}
      </div>

      {/* Action ribbon */}
      <div className="px-2 py-1.5 bg-white border-t border-black/5 flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-widest font-bold text-emerald-500 flex-shrink-0">
          Action
        </span>
        <span className="text-[10px] text-text-secondary truncate font-mono">
          {lastAction}
        </span>
      </div>
    </div>
  );
}
