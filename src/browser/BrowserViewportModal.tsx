// Expanded full-screen viewport. Renders the same data as the inline
// component but with a larger screenshot and the full scrollable action log.

import { useEffect } from 'react';
import { Globe, X, AlertTriangle, Loader2, Check } from 'lucide-react';
import type { BrowserViewState } from './types';

interface Props {
  state: BrowserViewState;
  onClose: () => void;
}

export default function BrowserViewportModal({ state, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hostname = (() => {
    try {
      return state.url ? new URL(state.url).hostname.replace(/^www\./, '') : '';
    } catch {
      return state.url;
    }
  })();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[min(1100px,95vw)] h-[min(720px,90vh)] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Chrome */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-black/5">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          </div>
          <div className="flex-1 flex items-center gap-2 bg-slate-100 rounded-md px-2 py-1 min-w-0">
            <Globe className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
            <span className="text-xs text-text-secondary truncate font-mono">
              {state.url || 'spawning browser…'}
            </span>
          </div>
          {state.error ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-500 bg-rose-500/10 px-2 py-1 rounded">
              <AlertTriangle className="w-3 h-3" /> Error
            </span>
          ) : state.done ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
              <Check className="w-3 h-3" /> Done
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
              <Loader2 className="w-3 h-3 animate-spin" /> Live
            </span>
          )}
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="p-1.5 rounded-md hover:bg-black/5 text-text-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Screenshot */}
          <div className="flex-1 bg-slate-100 relative overflow-hidden">
            {state.screenshot ? (
              <img
                src={`data:image/png;base64,${state.screenshot}`}
                alt="Live browser viewport"
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                {state.status}
              </div>
            )}
          </div>

          {/* Action log */}
          <aside className="w-72 border-l border-black/5 flex flex-col">
            <div className="px-3 py-2 border-b border-black/5">
              <div className="text-[10px] uppercase tracking-widest font-bold text-emerald-500">
                Browser-use actions
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">
                Host: <span className="font-mono">{hostname || '—'}</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-[11px] font-mono text-text-secondary">
              {state.log.length === 0 && (
                <div className="text-text-muted">Waiting for first action…</div>
              )}
              {state.log.map((line, i) => (
                <div key={i} className="leading-relaxed">
                  <span className="text-emerald-500 mr-1.5">›</span>
                  {line}
                </div>
              ))}
              {state.error && (
                <div className="mt-3 text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1.5 leading-relaxed">
                  {state.error}
                </div>
              )}
            </div>
            {state.report && (
              <div className="border-t border-black/5 px-3 py-2 max-h-48 overflow-y-auto text-[11px] leading-relaxed text-text-primary whitespace-pre-wrap bg-slate-50">
                {state.report}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
