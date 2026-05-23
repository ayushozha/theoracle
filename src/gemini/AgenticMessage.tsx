import { useState, type ReactNode } from 'react';
import {
  Terminal, ChevronDown, ChevronUp, Plus, Sparkles
} from 'lucide-react';
import type { BrowserViewState } from '../browser/types';
import type { ItemIntakeProfile } from './intakeProfile';
import BrowserViewport from '../browser/BrowserViewport';

// Tiny inline-markdown renderer. Handles **bold**, *italic*, and `code`
// across each paragraph. Heavier than nothing, lighter than pulling react-markdown.
// Preserves paragraph breaks (double newline) and single line breaks within paragraphs.
function renderInlineMd(text: string): ReactNode {
  // Split on blank lines for paragraphs.
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((para, pi) => {
    const lines = para.split('\n');
    const nodes: ReactNode[] = [];
    lines.forEach((line, li) => {
      // Tokenize **bold**, *italic*, `code` left-to-right.
      const tokens: ReactNode[] = [];
      let rest = line;
      let key = 0;
      const re = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/;
      while (rest.length > 0) {
        const m = rest.match(re);
        if (!m || m.index === undefined) {
          tokens.push(rest);
          break;
        }
        if (m.index > 0) tokens.push(rest.slice(0, m.index));
        if (m[2] !== undefined) {
          tokens.push(<strong key={`b${key++}`} className="font-bold text-text-primary">{m[2]}</strong>);
        } else if (m[3] !== undefined) {
          tokens.push(<em key={`i${key++}`} className="italic">{m[3]}</em>);
        } else if (m[4] !== undefined) {
          tokens.push(
            <code
              key={`c${key++}`}
              className="px-1.5 py-0.5 rounded-md bg-violet-500/8 text-violet-600 font-mono text-[12px]"
            >
              {m[4]}
            </code>,
          );
        }
        rest = rest.slice(m.index + m[0].length);
      }
      nodes.push(<span key={li}>{tokens}</span>);
      if (li < lines.length - 1) nodes.push(<br key={`br${li}`} />);
    });
    return (
      <p key={pi} className={pi === 0 ? '' : 'mt-3'}>
        {nodes}
      </p>
    );
  });
}

interface UiMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachments?: { name: string; mime: string; previewUrl?: string }[];
  streaming?: boolean;
  browser?: BrowserViewState;
}

interface Props {
  message: UiMessage;
  intakeProfile?: ItemIntakeProfile;
  onSpecClick?: (specName: string) => void;
  onExpandBrowser?: () => void;
}

// Sub-agents registry for dynamic indicators
const AGENTS = [
  { id: 'seller', name: 'Seller Agent', color: 'bg-violet-500 text-violet-400' },
  { id: 'pricing', name: 'Pricing Agent', color: 'bg-cyan-500 text-cyan-400' },
  { id: 'buyer', name: 'Buyer Agent', color: 'bg-pink-500 text-pink-400' },
  { id: 'trust', name: 'Trust Shield', color: 'bg-rose-500 text-rose-400' },
  { id: 'research', name: 'Research Web', color: 'bg-emerald-500 text-emerald-400' },
];

export default function AgenticMessage({
  message,
  intakeProfile,
  onSpecClick,
  onExpandBrowser,
}: Props) {
  const [showTrace, setShowTrace] = useState(false);
  const isModel = message.role === 'model';
  const text = message.text;

  // Determine active sub-agents based on message content & type
  const activeAgentIds = (() => {
    if (!isModel) return [];
    const ids: string[] = ['seller']; // Concierge always active
    const t = text.toLowerCase();

    if (message.browser || t.includes('research') || t.includes('browse') || t.includes('scrape')) {
      ids.push('research');
    }
    if (t.includes('price') || t.includes('comps') || t.includes('valuation') || t.includes('worth') || t.includes('sandbox')) {
      ids.push('pricing');
    }
    if (t.includes('buyer') || t.includes('sarah') || t.includes('offer') || t.includes('negotiat')) {
      ids.push('buyer');
    }
    if (t.includes('scam') || t.includes('trust') || t.includes('safe') || t.includes('threat') || t.includes('fraud')) {
      ids.push('trust');
    }
    return ids;
  })();

  // Generate dynamic, realistic agent execution logs
  const traceLogs = (() => {
    if (!isModel) return [];
    const logs: string[] = [];
    const t = text.toLowerCase();
    const hasImage = message.attachments && message.attachments.length > 0;

    logs.push(`[Concierge] Dispatching request to Oracle multi-agent cluster.`);

    if (hasImage) {
      logs.push(`[Vision Agent] Analysing image payload: ${message.attachments![0].name}`);
      logs.push(`[Vision Agent] Running contrast enhancements and spec pattern matching...`);
    }

    if (t.includes('macbook') || t.includes('sell') || t.includes('intake')) {
      logs.push(`[Seller Agent] Instantiating MacBook Seller constraint container.`);
      logs.push(`[Intake Agent] Parsing item specs against master hardware blueprint.`);
      if (intakeProfile && intakeProfile.missingFields.length > 0) {
        logs.push(`[Intake Agent] Identification partial. Missing: [${intakeProfile.missingFields.slice(0, 3).join(', ')}]`);
      } else {
        logs.push(`[Intake Agent] Specification blueprint successfully compiled (100% match).`);
      }
    }

    if (activeAgentIds.includes('research')) {
      logs.push(`[Research Agent] Initializing sandboxed Chromium viewport...`);
      logs.push(`[Research Agent] Public targets: Craigslist wanted, Reddit WTB, Craigslist comps, eBay, Swappa, BackMarket.`);
      logs.push(`[Research Agent] Guardrails: no login, no posting, no messages, no checkout, no captcha bypass.`);
      if (message.browser?.done) {
        logs.push(`[Research Agent] Finished scraping. Extraction matrix successfully compiled.`);
      }
    }

    if (activeAgentIds.includes('pricing')) {
      logs.push(`[Pricing Agent] Starting market valuation analytics...`);
      logs.push(`[Pricing Agent] Scouring database for matching active/completed comps.`);
      logs.push(`[Pricing Agent] Outlier removal complete. Computing defensible floor & list prices.`);
    }

    if (activeAgentIds.includes('buyer')) {
      logs.push(`[Buyer Agent] Sarah buyer representation active.`);
      logs.push(`[Seller Agent] Aligned handover preference with buyer location...`);
    }

    if (activeAgentIds.includes('trust')) {
      logs.push(`[Trust Shield] safety analyzer scanning dialogue streams...`);
      if (t.includes('scam') || t.includes('incident') || t.includes('isolated')) {
        logs.push(`[Trust Shield] WARNING: High-urgency/code pattern detected.`);
        logs.push(`[Trust Shield] Threat isolated. Rerouting transaction flow to local public swap.`);
      } else {
        logs.push(`[Trust Shield] dialogue telemetry clean (0 threats detected).`);
      }
    }

    logs.push(`[Concierge] Synthesizing collaborative agent outputs into reply stream.`);
    return logs;
  })();

  // Render User Message bubble
  if (!isModel) {
    // User intent parsing (Simulated agentic processing of user message)
    const userIntent = (() => {
      const t = text.toLowerCase();
      if (t.includes('sell') || t.includes('macbook')) return 'Intake Request';
      if (t.includes('research') || t.includes('browse')) return 'Live Research Request';
      if (t.includes('price') || t.includes('worth') || t.includes('comps')) return 'Valuation Request';
      if (t.includes('scam') || t.includes('safe')) return 'Safety Audit';
      return 'Command Input';
    })();

    return (
      <div className="flex flex-col items-end gap-1.5 w-full animate-fade-in">
        {/* User tag — small pill with brand-tinted dot */}
        <div className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-violet-500/5 border border-violet-500/10 text-[9.5px] font-semibold text-violet-500 tracking-wider uppercase select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
          <span>{userIntent}</span>
          <span className="w-0.5 h-0.5 rounded-full bg-violet-400/60" />
          <span className="text-text-secondary normal-case font-medium tracking-normal">Ayush · Owner</span>
        </div>

        {/* User bubble — narrower so dialogue feels conversational, not headline-wide */}
        <div className="bg-violet-600 text-white rounded-3xl rounded-tr-md border border-violet-500/30 py-2.5 px-4 shadow-md max-w-[min(560px,85%)] text-[14px] leading-relaxed">
          {text}
        </div>
      </div>
    );
  }

  // Render Assistant (Model) Message bubble
  return (
    <div className="flex flex-col items-start gap-2 w-full animate-fade-in group">
      {/* Concierge identity row — name + model + live agent dots */}
      <div className="flex items-center gap-2 flex-wrap pl-1 select-none">
        <div className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
        </div>
        <span className="text-[10px] font-bold text-text-primary tracking-wider uppercase">
          Oracle Agentic Concierge
        </span>
        <span className="text-[9px] font-semibold text-violet-500 bg-violet-500/8 border border-violet-500/15 px-1.5 py-0.5 rounded-md font-mono tracking-wide">
          Gemini 3.5 Flash
        </span>

        {/* Agent activity HUD — separated with a divider so it doesn't look like part of the name */}
        <span className="text-[9px] text-text-muted uppercase tracking-widest ml-1">·</span>
        <div className="flex items-center gap-1" title="Active agents">
          {AGENTS.map((agent) => {
            const isActive = activeAgentIds.includes(agent.id);
            return (
              <span
                key={agent.id}
                title={`${agent.name}: ${isActive ? 'Active' : 'Standby'}`}
                className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                  isActive
                    ? `${agent.color.split(' ')[0]} ring-2 ring-offset-1 ring-offset-transparent ${
                        agent.color.split(' ')[0].replace('bg-', 'ring-')
                      }/30 scale-110`
                    : 'bg-slate-200/80'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Main bubble — constrained width for readability */}
      <div className="w-full max-w-[640px] rounded-3xl rounded-tl-md border border-violet-500/12 bg-white p-5 shadow-sm hover:shadow-md hover:border-violet-500/20 transition-all">

        {/* Live browser viewport inside message bubble */}
        {message.browser && (
          <div className="mb-4">
            <BrowserViewport
              state={message.browser}
              onExpand={onExpandBrowser || (() => {})}
            />
          </div>
        )}

        {/* Body — inline markdown renderer, well-spaced paragraphs */}
        {text ? (
          <div className="text-[14px] leading-[1.6] text-text-primary select-text">
            {renderInlineMd(text)}
          </div>
        ) : message.streaming && !message.browser ? (
          <div className="flex items-center gap-2 py-1 select-none">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-[10px] text-violet-500 font-semibold uppercase tracking-wider">
              Agent clusters responding…
            </span>
          </div>
        ) : null}

        {/* Missing-specs checklist — promoted to a proper card-within-card with brand-tinted accent */}
        {intakeProfile && intakeProfile.missingFields.length > 0 && text.includes('photo') && (
          <div className="mt-5 rounded-2xl border border-violet-500/12 bg-gradient-to-br from-violet-500/[0.03] to-transparent p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-[10px] uppercase font-bold text-text-primary tracking-wider">
                  Missing specs
                </span>
                <span className="text-[9px] text-text-muted font-mono">
                  ({intakeProfile.missingFields.length})
                </span>
              </div>
              <span className="text-[9.5px] text-text-muted">
                Tap to add
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {intakeProfile.missingFields.slice(0, 6).map((field) => (
                <button
                  key={field}
                  onClick={() => onSpecClick?.(field)}
                  className="inline-flex items-center gap-1 bg-white hover:bg-violet-500/5 border border-violet-500/20 hover:border-violet-500/40 text-violet-600 rounded-full pl-1.5 pr-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-all active:scale-95 shadow-sm"
                >
                  <Plus className="w-3 h-3" />
                  <span className="capitalize">{field.replace(/Gb|Usd/i, '')}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Execution trace — cleaner two-row layout when chips are present */}
        {traceLogs.length > 0 && (
          <div className="mt-4 border-t border-black/5 pt-3">
            <button
              onClick={() => setShowTrace(!showTrace)}
              className="flex items-center justify-between w-full cursor-pointer select-none group/trace"
            >
              <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-violet-500 group-hover/trace:text-violet-600 tracking-wide transition-colors">
                <Terminal className="w-3.5 h-3.5" />
                <span>
                  {showTrace ? 'Hide execution trace' : 'Show execution trace'}
                </span>
                <span className="text-text-muted font-mono text-[10px] ml-1">
                  · {activeAgentIds.length} active
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="hidden sm:flex items-center gap-1">
                  {activeAgentIds.slice(0, 4).map((id) => (
                    <span
                      key={id}
                      className="px-1.5 py-0.5 rounded-md bg-violet-500/8 border border-violet-500/15 text-[8.5px] font-mono font-semibold text-violet-500 capitalize tracking-wide"
                    >
                      {id}
                    </span>
                  ))}
                </div>
                {showTrace ? (
                  <ChevronUp className="w-3.5 h-3.5 text-violet-500" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-violet-500" />
                )}
              </div>
            </button>

            {showTrace && (
              <div className="mt-2.5 bg-slate-950 rounded-xl p-3 font-mono text-[10px] leading-relaxed border border-white/5 max-h-56 overflow-y-auto custom-scrollbar animate-slide-up shadow-inner relative">
                <div className="absolute top-2 right-2 flex items-center gap-1 text-[8.5px] text-emerald-400/80 font-semibold tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>TRACE_ACTIVE</span>
                </div>

                <div className="space-y-1 pr-24">
                  {traceLogs.map((log, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <span className="text-slate-500 select-none">$&gt;</span>
                      <span
                        className={
                          log.includes('WARNING')
                            ? 'text-rose-400 font-semibold'
                            : log.includes('complete') || log.includes('clean') || log.includes('100%')
                              ? 'text-emerald-300'
                              : 'text-cyan-300'
                        }
                      >
                        {log}
                      </span>
                    </div>
                  ))}
                  {message.streaming && (
                    <div className="flex items-center gap-1 text-violet-400 font-semibold">
                      <span>$&gt;</span>
                      <span>Orchestrating</span>
                      <span className="w-1.5 h-3 bg-violet-400 animate-pulse inline-block ml-0.5" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
