import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Send,
  Paperclip,
  Image as ImageIcon,
  X,
  Copy,
  Check,
  Square,
  ArrowRight,
} from 'lucide-react';
import {
  streamGeminiChat,
  fileToInlinePart,
  type GeminiContent,
  type GeminiPart,
} from './geminiClient';
import { CONCIERGE_SYSTEM_PROMPT } from './agentPersona';
import CameraCapture from './CameraCapture';
import MicrophoneCapture from './MicrophoneCapture';
import BrowserViewport from '../browser/BrowserViewport';
import BrowserViewportModal from '../browser/BrowserViewportModal';
import { streamBrowserResearch } from '../browser/browserClient';
import {
  initialBrowserViewState,
  reduceBrowserState,
  type BrowserViewState,
} from '../browser/types';

interface UiMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachments?: { name: string; mime: string; previewUrl?: string }[];
  /** True while the model is still streaming. */
  streaming?: boolean;
  /** Live browser-use viewport state for this message (research turns only). */
  browser?: BrowserViewState;
}

// Heuristic: route the user's turn through the browser-use research backend
// instead of the plain Gemini chat call. Keep this generous — false positives
// just open a browser viewport the user can dismiss.
function isResearchIntent(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(research|browse|browsing|where (should|can) i (sell|list)|find comps?|compare (prices|marketplaces?)|scan (the )?market|live ?browse|surf (the )?web|check (ebay|swappa|craigslist|facebook marketplace|offerup|mercari|backmarket))\b/.test(
      t,
    ) || t.startsWith('/research')
  );
}

interface Attachment {
  file: File;
  previewUrl?: string;
}

interface Props {
  /** 'landing' = full-screen entry surface. 'floating' = collapsible widget. */
  mode: 'landing' | 'floating';
  /** Optional CTA shown under the input on landing mode. */
  onStartAgentFlow?: () => void;
  /** Floating mode: dismiss the widget. */
  onClose?: () => void;
}

const QUICK_PROMPTS = [
  'I want to sell my MacBook',
  "What's a fair price for this?",
  'Is this offer a scam?',
  'Draft a listing for me',
  'Research where to sell my MacBook live',
];

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export default function GeminiChat({ mode, onStartAgentFlow, onClose }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedBrowserId, setExpandedBrowserId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const updateMessage = (id: string, patch: (m: UiMessage) => UiMessage) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));

  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Build the Gemini contents history from the visible messages.
  const buildHistory = useMemo(
    () =>
      async (
        userText: string,
        files: Attachment[],
      ): Promise<GeminiContent[]> => {
        const priorTurns: GeminiContent[] = messages
          .filter((m) => !m.streaming && m.text.length > 0)
          .map((m) => ({
            role: m.role,
            parts: [{ text: m.text }],
          }));

        const parts: GeminiPart[] = [];
        if (userText.trim()) parts.push({ text: userText });
        for (const a of files) {
          parts.push(await fileToInlinePart(a.file));
        }
        return [...priorTurns, { role: 'user', parts }];
      },
    [messages],
  );

  const send = async () => {
    if (isStreaming) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;

    setError(null);

    const userMsg: UiMessage = {
      id: newId(),
      role: 'user',
      text,
      attachments: attachments.map((a) => ({
        name: a.file.name,
        mime: a.file.type,
        previewUrl: a.previewUrl,
      })),
    };
    const modelId = newId();
    const modelMsg: UiMessage = {
      id: modelId,
      role: 'model',
      text: '',
      streaming: true,
    };

    // Route research-style asks through the browser-use backend and embed a
    // live viewport in the model bubble. Everything else stays on plain
    // Gemini chat.
    const useBrowser = isResearchIntent(text);
    if (useBrowser) {
      modelMsg.browser = { ...initialBrowserViewState };
      modelMsg.text = 'Spinning up the Research Agent and a live Chromium session…';
    }

    setMessages((prev) => [...prev, userMsg, modelMsg]);
    setInput('');
    const sentAttachments = attachments;
    setAttachments([]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (useBrowser) {
        const taskPrompt = text.replace(/^\/research\s*/i, '').trim();
        for await (const frame of streamBrowserResearch({
          task:
            taskPrompt ||
            'Research where to sell my MacBook Pro M3 Pro (18GB / 512GB, Good/Mint, charger included) to clear above $725 with local Ferry Building pickup.',
          signal: controller.signal,
        })) {
          updateMessage(modelId, (m) => ({
            ...m,
            browser: reduceBrowserState(
              m.browser ?? initialBrowserViewState,
              frame,
            ),
            // When the backend emits the final report, surface it as message text.
            text:
              frame.type === 'done'
                ? frame.report || 'Research complete.'
                : frame.type === 'error'
                  ? `Browser-use error: ${frame.message}`
                  : m.text,
          }));
        }
      } else {
        const contents = await buildHistory(text, sentAttachments);
        for await (const delta of streamGeminiChat(contents, {
          systemInstruction: CONCIERGE_SYSTEM_PROMPT,
          signal: controller.signal,
        })) {
          updateMessage(modelId, (m) => ({ ...m, text: m.text + delta }));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        // Soft stop — leave whatever streamed.
      } else {
        setError(msg);
        if (useBrowser) {
          updateMessage(modelId, (m) => ({
            ...m,
            browser: m.browser
              ? { ...m.browser, error: msg, status: 'error' }
              : m.browser,
          }));
        }
      }
    } finally {
      updateMessage(modelId, (m) => ({ ...m, streaming: false }));
      setIsStreaming(false);
      abortRef.current = null;
      // Free preview URLs.
      sentAttachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      const previewUrl = file.type.startsWith('image/')
        ? URL.createObjectURL(file)
        : undefined;
      next.push({ file, previewUrl });
    }
    setAttachments((prev) => [...prev, ...next]);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => {
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const copyEmbed = async () => {
    const snippet = `<script src="https://the-oracle.app/embed.js" data-agent="concierge"></script>`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const showHero = mode === 'landing' && !hasMessages;

  const containerClasses =
    mode === 'landing'
      ? 'flex-1 flex flex-col w-full max-w-3xl mx-auto px-4 md:px-6 py-6 gap-4'
      : 'flex flex-col h-full';

  return (
    <div className={containerClasses}>
      {mode === 'floating' && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full gemini-gradient flex items-center justify-center text-white shadow-sm">
              <Sparkles className="w-4 h-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-text-primary leading-tight">
                The Oracle Concierge
              </div>
              <div className="text-[10px] text-text-muted leading-none">
                gemini-3.5-flash · routes to 4 agents
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={copyEmbed}
              title="Copy embed snippet"
              className="p-1.5 rounded-md hover:bg-black/5 text-text-secondary"
            >
              {copied ? <Check className="w-4 h-4 text-google-green" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              title="Close"
              className="p-1.5 rounded-md hover:bg-black/5 text-text-secondary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Landing hero */}
      {showHero && (
        <div className="flex flex-col items-center text-center py-10 md:py-16 animate-fade-in">
          <button
            onClick={copyEmbed}
            className="mb-6 inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full bg-white border border-black/5 text-text-secondary hover:border-google-blue/40 transition-colors"
            title="Copy embed snippet"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-google-green" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Embed this agent on any site
              </>
            )}
          </button>

          <div className="relative w-16 h-16 mb-6">
            <div className="absolute inset-0 rounded-full gemini-ring animate-spin-slow opacity-80" />
            <div className="absolute inset-[3px] rounded-full bg-white flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-google-blue" />
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            Hi, I'm your{' '}
            <span className="text-gradient">The Oracle concierge</span>.
          </h1>
          <p className="mt-3 text-text-secondary max-w-xl">
            Show me anything you want to sell. I'll spin up a Seller Agent, run
            a Pricing sandbox, find a buyer, and let a Trust Agent keep you
            safe — you stay in the loop on every deal.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setInput(p)}
                className="btn-ghost text-xs"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Transcript */}
      {hasMessages && (
        <div
          ref={scrollRef}
          className={
            mode === 'landing'
              ? 'flex-1 overflow-y-auto space-y-4 pr-1'
              : 'flex-1 overflow-y-auto px-4 py-4 space-y-3'
          }
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'model' && (
                <div className="w-7 h-7 rounded-full gemini-gradient text-white flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
              )}
              <div className="max-w-[78%]">
                {m.attachments && m.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-1.5 justify-end">
                    {m.attachments.map((a, i) =>
                      a.previewUrl ? (
                        <img
                          key={i}
                          src={a.previewUrl}
                          alt={a.name}
                          className="w-24 h-24 object-cover rounded-lg border border-black/5"
                        />
                      ) : (
                        <div
                          key={i}
                          className="text-[11px] px-2 py-1 rounded-md bg-white border border-black/5 text-text-secondary"
                        >
                          {a.name}
                        </div>
                      ),
                    )}
                  </div>
                )}
                <div
                  className={`${
                    m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-model'
                  } text-sm whitespace-pre-wrap leading-relaxed`}
                >
                  {m.browser && (
                    <BrowserViewport
                      state={m.browser}
                      onExpand={() => setExpandedBrowserId(m.id)}
                    />
                  )}
                  {m.text || (m.streaming && !m.browser ? (
                    <span className="typing-dots inline-flex items-center">
                      <span /><span /><span />
                    </span>
                  ) : null)}
                </div>
              </div>
            </div>
          ))}
          {error && (
            <div className="text-xs text-google-red bg-red-50 border border-red-200 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Input shell */}
      <div className={mode === 'floating' ? 'px-3 pb-3' : ''}>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 px-1">
            {attachments.map((a, idx) => (
              <div
                key={idx}
                className="relative group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white border border-black/5 text-xs"
              >
                {a.previewUrl ? (
                  <img
                    src={a.previewUrl}
                    alt=""
                    className="w-7 h-7 object-cover rounded"
                  />
                ) : (
                  <Paperclip className="w-3.5 h-3.5 text-text-muted" />
                )}
                <span className="truncate max-w-[140px] text-text-secondary">
                  {a.file.name}
                </span>
                <button
                  onClick={() => removeAttachment(idx)}
                  className="text-text-muted hover:text-google-red"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="chat-input-shell flex items-end gap-2 px-3 py-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-full hover:bg-black/5 text-text-secondary"
            title="Attach image, PDF, audio, or video"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <CameraCapture
            onCapture={(file) => addFiles([file])}
            buttonClassName="p-2 rounded-full hover:bg-black/5 text-text-secondary disabled:opacity-50"
          />
          <MicrophoneCapture
            onCapture={(file) => addFiles([file])}
            buttonClassName="p-2 rounded-full hover:bg-black/5 text-text-secondary"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,audio/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder={
              mode === 'landing'
                ? 'Tell the concierge what you want to sell — or paste a photo'
                : 'Ask the concierge anything…'
            }
            className="flex-1 bg-transparent resize-none outline-none text-sm py-2 max-h-40 text-text-primary placeholder:text-text-muted"
          />
          {isStreaming ? (
            <button
              onClick={stop}
              title="Stop"
              className="p-2 rounded-full bg-text-primary text-white hover:opacity-80"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim() && attachments.length === 0}
              title="Send"
              className="p-2 rounded-full gemini-gradient text-white shadow-md disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>

        {mode === 'landing' && (
          <div className="mt-4 flex items-center justify-between text-[11px] text-text-muted px-2">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-google-green" />
              Powered by Gemini 3.5 Flash · vision · streaming · file upload
            </div>
            {onStartAgentFlow && (
              <button
                onClick={onStartAgentFlow}
                className="inline-flex items-center gap-1 text-google-blue hover:underline font-medium"
              >
                Or watch the 3-min agent flow
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {expandedBrowserId &&
        (() => {
          const expanded = messages.find((m) => m.id === expandedBrowserId);
          if (!expanded?.browser) return null;
          return (
            <BrowserViewportModal
              state={expanded.browser}
              onClose={() => setExpandedBrowserId(null)}
            />
          );
        })()}
    </div>
  );
}
