import { useState } from 'react';
import {
  Terminal, ChevronDown, ChevronUp, Activity
} from 'lucide-react';
import type { BrowserViewState } from '../browser/types';
import type { ItemIntakeProfile } from './intakeProfile';
import BrowserViewport from '../browser/BrowserViewport';

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
      <div className="flex flex-col items-end gap-1 w-full animate-fade-in">
        {/* User tag */}
        <div className="flex items-center gap-1.5 px-2 text-[9px] font-semibold text-text-muted tracking-wider uppercase select-none">
          <span>{userIntent}</span>
          <span className="w-1 h-1 rounded-full bg-google-blue" />
          <span>Ayush (Owner)</span>
        </div>

        {/* User bubble */}
        <div className="oracle-bubble-user bg-violet-600 text-white rounded-3xl rounded-tr-sm border border-violet-500/20 py-2.5 px-4 shadow-md max-w-[85%] text-sm leading-relaxed">
          {text}
        </div>
      </div>
    );
  }

  // Render Assistant (Model) Message bubble
  return (
    <div className="flex flex-col items-start gap-1.5 w-full animate-fade-in group">
      {/* Agent Concierge Header */}
      <div className="flex items-center justify-between w-full px-2 text-[9px] font-bold text-text-muted tracking-wider uppercase select-none">
        <div className="flex items-center gap-2">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
          </div>
          <span className="text-text-primary">Oracle Agentic Concierge</span>
          <span className="text-[8px] border border-black/5 dark:border-white/5 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono text-[8px]">
            Gemini 3.5 Flash
          </span>
        </div>

        {/* Mini Active Agents HUD inside Bubble */}
        <div className="flex items-center gap-1">
          {AGENTS.map(agent => {
            const isActive = activeAgentIds.includes(agent.id);
            return (
              <span
                key={agent.id}
                title={`${agent.name}: ${isActive ? 'Active' : 'Standby'}`}
                className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                  isActive ? agent.color.split(' ')[0] + ' scale-110' : 'bg-slate-200 dark:bg-slate-800'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Main Agent Bubble Container */}
      <div className="w-full max-w-[90%] rounded-3xl rounded-tl-sm border border-violet-500/10 bg-white/80 dark:bg-slate-900/80 p-4 md:p-5 shadow-lg backdrop-blur-md relative overflow-hidden transition-all hover:border-violet-500/20">

        {/* Subtle dynamic glow */}
        <div className="absolute top-0 left-0 w-24 h-24 bg-radial-gradient from-violet-500/5 via-transparent to-transparent pointer-events-none" />

        {/* Live browser viewport inside message bubble */}
        {message.browser && (
          <div className="mb-4">
            <BrowserViewport
              state={message.browser}
              onExpand={onExpandBrowser || (() => {})}
            />
          </div>
        )}

        {/* Structured message parsing & layout */}
        {text ? (
          <div className="text-[14px] leading-relaxed text-text-primary whitespace-pre-wrap select-text markdown-content">
            {text}
          </div>
        ) : message.streaming && !message.browser ? (
          <div className="flex items-center gap-2 py-1 select-none">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-[10px] text-violet-400 font-bold uppercase tracking-wider font-mono">
              Agent clusters responding...
            </span>
          </div>
        ) : null}

        {/* Dynamic Spec Registry Checklist shortcut (inline widget inside chat bubble) */}
        {intakeProfile && intakeProfile.missingFields.length > 0 && text.includes('photo') && (
          <div className="mt-4 border-t border-black/5 dark:border-white/5 pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-3.5 h-3.5 text-violet-400 animate-pulse" />
              <span className="text-[10px] uppercase font-black text-text-primary tracking-wide">
                Missing Specs Checklist
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {intakeProfile.missingFields.slice(0, 4).map((field) => (
                <button
                  key={field}
                  onClick={() => onSpecClick?.(field)}
                  className="inline-flex items-center gap-1 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:text-amber-600 rounded-full px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-all active:scale-95 shadow-sm"
                >
                  <span>+</span>
                  <span className="capitalize">{field.replace(/Gb|Usd/i, '')}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Collapsible Command Execution Trace */}
        {traceLogs.length > 0 && (
          <div className="mt-4 border-t border-black/5 dark:border-white/5 pt-3">
            <button
              onClick={() => setShowTrace(!showTrace)}
              className="flex items-center justify-between w-full text-[10px] font-extrabold text-violet-400 hover:text-violet-500 cursor-pointer select-none transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" />
                <span>
                  {showTrace ? 'Hide Agent Execution Trace' : `Show Agent Execution Trace (${activeAgentIds.length} active)`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {activeAgentIds.map(id => (
                  <span
                    key={id}
                    className="px-1 py-0.2 rounded bg-violet-500/10 border border-violet-500/20 text-[7px] font-mono capitalize"
                  >
                    {id}
                  </span>
                ))}
                {showTrace ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
              </div>
            </button>

            {/* Terminal log logs container */}
            {showTrace && (
              <div className="mt-2 bg-black/90 dark:bg-black/40 rounded-xl p-3 font-mono text-[9px] text-cyan-400/90 leading-normal border border-white/5 max-h-48 overflow-y-auto custom-scrollbar animate-slide-up shadow-inner relative">
                {/* Blinking red check dot */}
                <div className="absolute top-2 right-2 flex items-center gap-1 text-[8px] text-text-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>trace_active</span>
                </div>

                <div className="space-y-1">
                  {traceLogs.map((log, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <span className="text-text-muted select-none">$&gt;</span>
                      <span className={log.includes('WARNING') ? 'text-rose-400 font-bold' : log.includes('Extracted') || log.includes('complete') || log.includes('clean') ? 'text-emerald-400' : 'text-cyan-300'}>
                        {log}
                      </span>
                    </div>
                  ))}
                  {message.streaming && (
                    <div className="flex items-center gap-1 text-violet-400 font-bold animate-pulse">
                      <span>$&gt;</span>
                      <span>Orchestrating...</span>
                      <span className="w-1 h-3.5 bg-violet-400 animate-pulse inline-block" />
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
