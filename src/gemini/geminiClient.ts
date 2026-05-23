// Thin streaming client for the Gemini REST API.
//
// Docs: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
//       https://ai.google.dev/gemini-api/docs/text-generation
//
// We hit `:streamGenerateContent?alt=sse` and parse server-sent events.
// Each event is a `data: {...}` JSON object with `candidates[0].content.parts`.
// We yield text deltas as they arrive so the UI can render token-by-token.

export type GeminiRole = 'user' | 'model';

export interface GeminiInlinePart {
  inline_data: {
    mime_type: string;
    /** Base64-encoded payload, NO `data:...;base64,` prefix. */
    data: string;
  };
}

export interface GeminiTextPart {
  text: string;
}

export type GeminiPart = GeminiTextPart | GeminiInlinePart;

export interface GeminiContent {
  role: GeminiRole;
  parts: GeminiPart[];
}

export interface StreamOptions {
  model?: string;
  apiKey?: string;
  systemInstruction?: string;
  temperature?: number;
  signal?: AbortSignal;
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_BACKEND_ENDPOINT = '/api/gemini/stream';

function resolveModel(model?: string): string {
  return (
    model ||
    (import.meta.env.VITE_GEMINI_MODEL as string | undefined) ||
    'gemini-3.5-flash'
  );
}

function resolveEndpoint(): string {
  return (
    (import.meta.env.VITE_GEMINI_API_ENDPOINT as string | undefined) ||
    DEFAULT_BACKEND_ENDPOINT
  );
}

/**
 * Stream a chat turn. Yields text fragments as they arrive on the wire.
 *
 * Usage:
 *   for await (const chunk of streamGeminiChat(contents, { systemInstruction })) {
 *     setReply((prev) => prev + chunk);
 *   }
 */
export async function* streamGeminiChat(
  contents: GeminiContent[],
  opts: StreamOptions = {},
): AsyncGenerator<string, void, void> {
  const model = resolveModel(opts.model);

  const body: Record<string, unknown> = { contents };
  if (model) {
    body.model = model;
  }
  if (opts.systemInstruction) {
    body.systemInstruction = opts.systemInstruction;
  }
  if (typeof opts.temperature === 'number') {
    body.temperature = opts.temperature;
  }

  const res = opts.apiKey
    ? await fetch(
      `${API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': opts.apiKey,
        },
        body: JSON.stringify({
          contents,
          ...(opts.systemInstruction
            ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } }
            : {}),
          ...(typeof opts.temperature === 'number'
            ? { generationConfig: { temperature: opts.temperature } }
            : {}),
        }),
        signal: opts.signal,
      },
    )
    : await fetch(resolveEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${errText || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // Normalize CRLF so frame splitting on \n\n is reliable.
    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');

    // SSE frames are separated by blank lines.
    let nlIdx: number;
    while ((nlIdx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, nlIdx);
      buffer = buffer.slice(nlIdx + 2);

      for (const line of frame.split('\n')) {
        const trimmed = line.trimStart();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const json = JSON.parse(payload);
          const parts = json?.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            if (typeof p?.text === 'string' && p.text.length > 0) {
              yield p.text as string;
            }
          }
        } catch {
          // Ignore partial JSON; the next chunk may complete it.
        }
      }
    }
  }
}

/** Convert a File/Blob into a base64 string (no data URL prefix). */
export async function fileToInlinePart(file: File): Promise<GeminiInlinePart> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return {
    inline_data: {
      mime_type: file.type || 'application/octet-stream',
      data: btoa(binary),
    },
  };
}
