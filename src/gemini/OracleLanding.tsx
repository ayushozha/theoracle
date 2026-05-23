import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  ChevronDown,
  SquarePen,
  Search,
  LayoutDashboard,
  Square,
  X,
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
import VoiceAgentControl from './VoiceAgentControl';

interface UiMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachments?: { name: string; mime: string; previewUrl?: string }[];
  streaming?: boolean;
}

interface Attachment {
  file: File;
  previewUrl?: string;
}

interface Props {
  /** User's display name for the hero ("What's the vibe, Ayush?"). */
  userName?: string;
  /** Click handler for the discreet "watch the agent flow" link. */
  onStartAgentFlow?: () => void;
}

const QUICK_PROMPTS = [
  'I want to sell my MacBook',
  "What's a fair price for this?",
  'Is this offer a scam?',
  'Draft a listing for me',
];

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export default function OracleLanding({ userName = 'Ayush', onStartAgentFlow }: Props) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiceModelIdRef = useRef<string | null>(null);

  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const buildHistory = useMemo(
    () =>
      async (userText: string, files: Attachment[]): Promise<GeminiContent[]> => {
        const priorTurns: GeminiContent[] = messages
          .filter((m) => !m.streaming && m.text.length > 0)
          .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));

        const parts: GeminiPart[] = [];
        if (userText.trim()) parts.push({ text: userText });
        for (const a of files) parts.push(await fileToInlinePart(a.file));
        return [...priorTurns, { role: 'user', parts }];
      },
    [messages],
  );

  const voiceContext = useMemo(
    () =>
      messages
        .filter((m) => !m.streaming && m.text.trim().length > 0)
        .slice(-8)
        .map((m) => `${m.role === 'user' ? 'User' : 'Oracle'}: ${m.text}`)
        .join('\n'),
    [messages],
  );

  const send = async (
    overrideText?: string,
    overrideAttachments?: Attachment[],
  ): Promise<string> => {
    if (isStreaming) return '';
    const text = (overrideText ?? input).trim();
    const activeAttachments = overrideAttachments ?? attachments;
    if (!text && activeAttachments.length === 0) return '';
    setError(null);

    const userMsg: UiMessage = {
      id: newId(),
      role: 'user',
      text,
      attachments: activeAttachments.map((a) => ({
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

    setMessages((prev) => [...prev, userMsg, modelMsg]);
    if (overrideText === undefined) setInput('');
    const sentAttachments = activeAttachments;
    if (overrideAttachments === undefined) setAttachments([]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let reply = '';

    try {
      const contents = await buildHistory(text, sentAttachments);
      for await (const delta of streamGeminiChat(contents, {
        systemInstruction: CONCIERGE_SYSTEM_PROMPT,
        signal: controller.signal,
      })) {
        reply += delta;
        setMessages((prev) =>
          prev.map((m) => (m.id === modelId ? { ...m, text: m.text + delta } : m)),
        );
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setMessages((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, streaming: false } : m)),
      );
      setIsStreaming(false);
      abortRef.current = null;
      sentAttachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    }

    return reply;
  };

  const stop = () => abortRef.current?.abort();

  const addVoiceUserTranscript = (text: string) => {
    setError(null);
    setMessages((prev) => [...prev, { id: newId(), role: 'user', text }]);
  };

  const appendVoiceAssistantDelta = (delta: string) => {
    setMessages((prev) => {
      let modelId = voiceModelIdRef.current;
      if (!modelId) {
        modelId = newId();
        voiceModelIdRef.current = modelId;
        return [...prev, { id: modelId, role: 'model', text: delta, streaming: true }];
      }

      return prev.map((m) => (m.id === modelId ? { ...m, text: m.text + delta } : m));
    });
  };

  const completeVoiceAssistant = (text: string) => {
    setMessages((prev) => {
      const modelId = voiceModelIdRef.current;
      voiceModelIdRef.current = null;

      if (!modelId) {
        return text ? [...prev, { id: newId(), role: 'model', text, streaming: false }] : prev;
      }

      return prev.map((m) =>
        m.id === modelId ? { ...m, text: text || m.text, streaming: false } : m,
      );
    });
  };

  const resetChat = () => {
    abortRef.current?.abort();
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    setMessages([]);
    setInput('');
    setAttachments([]);
    setError(null);
    setIsStreaming(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const focusSearch = () => {
    textareaRef.current?.focus();
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

  return (
    <div className="oracle-landing min-h-screen w-full flex relative overflow-hidden">
      <div className="oracle-bg-grid" aria-hidden="true" />

      <nav
        className="oracle-rail hidden md:flex flex-col items-center gap-3 pt-6 px-3 w-16 flex-shrink-0 z-10"
        aria-label="Primary"
      >
        <RailButton title="Create new chat" active={!hasMessages} onClick={resetChat}>
          <SquarePen className="w-[18px] h-[18px]" />
        </RailButton>
        <RailButton title="Search" onClick={focusSearch}>
          <Search className="w-[18px] h-[18px]" />
        </RailButton>
        <RailButton title="Dashboard" onClick={onStartAgentFlow}>
          <LayoutDashboard className="w-[18px] h-[18px]" />
        </RailButton>
      </nav>

      {/* ─── Main centered column ─── */}
      <main
        className={`flex-1 flex flex-col z-10 ${
          hasMessages ? 'justify-between' : 'justify-center'
        } items-center px-4 md:px-10 py-6 md:py-10 transition-all`}
      >
        {/* Hero — shown only when chat is empty */}
        {!hasMessages && (
          <h1 className="oracle-hero text-center text-[44px] md:text-[56px] leading-[1.05] font-normal text-text-primary mb-10 animate-fade-in">
            What's the vibe, {userName}?
          </h1>
        )}

        {/* Conversation transcript */}
        {hasMessages && (
          <div
            ref={scrollRef}
            className="w-full max-w-3xl flex-1 overflow-y-auto space-y-4 pr-1 mb-4 pt-2"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2 ${
                  m.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {m.role === 'model' && (
                  <div className="mt-1 flex-shrink-0">
                    <GeminiSpark className="w-5 h-5" />
                  </div>
                )}
                <div className="max-w-[80%]">
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
                    className={
                      m.role === 'user'
                        ? 'oracle-bubble-user'
                        : 'oracle-bubble-model'
                    }
                  >
                    {m.text || (m.streaming ? (
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

        {/* Pending attachments preview */}
        {attachments.length > 0 && (
          <div className="w-full max-w-3xl flex flex-wrap gap-2 mb-2">
            {attachments.map((a, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white border border-black/5 text-xs shadow-sm"
              >
                {a.previewUrl ? (
                  <img
                    src={a.previewUrl}
                    alt=""
                    className="w-7 h-7 object-cover rounded"
                  />
                ) : (
                  <Plus className="w-3.5 h-3.5 text-text-muted" />
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

        {/* The Ask Gemini pill */}
        <div className="oracle-pill w-full max-w-3xl flex items-center gap-2 px-3 py-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach"
            className="w-9 h-9 rounded-full flex items-center justify-center text-text-primary hover:bg-black/5"
          >
            <Plus className="w-5 h-5" />
          </button>
          <CameraCapture
            onCapture={(file) => addFiles([file])}
            buttonClassName="w-9 h-9 rounded-full flex items-center justify-center text-text-primary hover:bg-black/5 disabled:opacity-50"
            iconClassName="w-5 h-5"
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
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder="Ask Gemini"
            className="flex-1 bg-transparent resize-none outline-none text-[15px] py-2 max-h-40 text-text-primary placeholder:text-text-muted"
          />

          <button
            className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full text-[13px] text-text-primary hover:bg-black/5"
            title="Model"
          >
            Thinking
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {isStreaming ? (
            <button
              onClick={stop}
              title="Stop"
              className="w-9 h-9 rounded-full bg-text-primary text-white flex items-center justify-center hover:opacity-80"
            >
              <Square className="w-4 h-4" />
            </button>
          ) : input || attachments.length ? (
            <button
              onClick={() => void send()}
              title="Send"
              className="w-9 h-9 rounded-full gemini-gradient text-white flex items-center justify-center shadow-md"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <VoiceAgentControl
              instructions={CONCIERGE_SYSTEM_PROMPT}
              conversationContext={voiceContext}
              onUserTranscript={addVoiceUserTranscript}
              onAssistantDelta={appendVoiceAssistantDelta}
              onAssistantDone={completeVoiceAssistant}
              onError={setError}
              buttonClassName="w-9 h-9 rounded-full flex items-center justify-center text-text-primary hover:bg-black/5"
              iconClassName="w-5 h-5"
              disabled={isStreaming}
            />
          )}
        </div>

        {/* Quick prompts — only on empty state */}
        {!hasMessages && (
          <div className="mt-5 flex flex-wrap justify-center gap-2 max-w-3xl">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setInput(p)}
                className="text-[12px] px-3 py-1.5 rounded-full border border-black/10 text-text-secondary bg-white/60 hover:bg-white hover:border-google-blue/30 transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Discreet link to the 9-screen agent flow */}
        {onStartAgentFlow && !hasMessages && (
          <button
            onClick={onStartAgentFlow}
            className="mt-6 text-[12px] text-text-muted hover:text-google-blue inline-flex items-center gap-1"
          >
            Or watch the 3-min agent demo
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </main>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────────

function RailButton({
  children,
  title,
  active = false,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`relative w-10 h-10 rounded-full flex items-center justify-center text-text-primary transition-colors ${
        active ? 'bg-white shadow-sm border border-black/5' : 'hover:bg-white/75'
      }`}
    >
      {children}
    </button>
  );
}

/** Inline Gemini 4-point sparkle, recolored with the brand gradient. */
function GeminiSpark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="gemini-spark-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="50%" stopColor="#9168C0" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        d="M12 1l1.85 6.7L20.5 9.5l-6.65 1.85L12 18l-1.85-6.65L3.5 9.5l6.65-1.8L12 1z"
        fill="url(#gemini-spark-grad)"
      />
    </svg>
  );
}
