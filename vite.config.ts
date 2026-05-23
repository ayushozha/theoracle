import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GEMINI_MODEL = 'gemini-3.5-flash'
const OPENAI_API_BASE = 'https://api.openai.com/v1'
const OPENAI_REALTIME_MODEL = 'gpt-realtime'
const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts'
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1'

interface BodyRequest {
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
}

function geminiApiPlugin(): Plugin {
  return {
    name: 'oracle-gemini-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')

      server.middlewares.use('/api/elevenlabs/tts', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const apiKey = env.ELEVENLABS_API_KEY
        const voiceId = env.ELEVENLABS_VOICE_ID
        if (!apiKey || !voiceId) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Primary voice is not configured' }))
          return
        }

        try {
          const payload = await readJsonBody(req)
          const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 2500) : ''
          if (!text) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing text' }))
            return
          }

          const upstream = await fetch(
            `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
            {
              method: 'POST',
              headers: {
                Accept: 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': apiKey,
              },
              body: JSON.stringify({
                text,
                model_id: env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
                voice_settings: {
                  stability: 0.42,
                  similarity_boost: 0.82,
                  style: 0.12,
                  use_speaker_boost: true,
                },
              }),
            },
          )

          if (!upstream.ok || !upstream.body) {
            res.statusCode = upstream.status || 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Primary voice synthesis failed' }))
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg')
          res.setHeader('Cache-Control', 'no-store')
          await pipeResponseBody(upstream, res)
        } catch (error) {
          server.config.logger.error(error instanceof Error ? error.message : String(error))
          if (!res.writableEnded) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Primary voice synthesis failed' }))
          }
        }
      })

      server.middlewares.use('/api/openai/tts', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const apiKey = env.OPENAI_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Fallback voice is not configured' }))
          return
        }

        try {
          const payload = await readJsonBody(req)
          const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 2500) : ''
          if (!text) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing text' }))
            return
          }

          const upstream = await fetch(`${OPENAI_API_BASE}/audio/speech`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: env.OPENAI_TTS_MODEL || OPENAI_TTS_MODEL,
              voice: env.OPENAI_TTS_VOICE || env.OPENAI_REALTIME_VOICE || 'marin',
              input: text,
              instructions:
                'Speak as The Oracle Concierge: warm, direct, concise, and never mention internal providers or implementation details.',
              response_format: 'mp3',
            }),
          })

          if (!upstream.ok || !upstream.body) {
            res.statusCode = upstream.status || 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Fallback voice synthesis failed' }))
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg')
          res.setHeader('Cache-Control', 'no-store')
          await pipeResponseBody(upstream, res)
        } catch (error) {
          server.config.logger.error(error instanceof Error ? error.message : String(error))
          if (!res.writableEnded) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Fallback voice synthesis failed' }))
          }
        }
      })

      server.middlewares.use('/api/openai/realtime/session', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const apiKey = env.OPENAI_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Missing OPENAI_API_KEY in .env' }))
          return
        }

        try {
          const payload = await readJsonBody(req)
          const instructions =
            typeof payload.instructions === 'string'
              ? payload.instructions.slice(0, 12000)
              : undefined
          const outputMode = payload.outputMode === 'audio' ? 'audio' : 'text'

          const upstream = await fetch(`${OPENAI_API_BASE}/realtime/client_secrets`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              session: {
                type: 'realtime',
                model: env.OPENAI_REALTIME_MODEL || OPENAI_REALTIME_MODEL,
                ...(instructions ? { instructions } : {}),
                output_modalities: outputMode === 'audio' ? ['audio'] : ['text'],
                audio: {
                  input: {
                    noise_reduction: { type: 'near_field' },
                    transcription: {
                      model: 'gpt-4o-mini-transcribe',
                      language: 'en',
                    },
                    turn_detection: {
                      type: 'server_vad',
                      threshold: 0.5,
                      prefix_padding_ms: 300,
                      silence_duration_ms: 500,
                      create_response: true,
                      interrupt_response: true,
                    },
                  },
                  ...(outputMode === 'audio'
                    ? { output: { voice: env.OPENAI_REALTIME_VOICE || 'marin' } }
                    : {}),
                },
              },
            }),
          })

          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(await upstream.text())
        } catch (error) {
          server.config.logger.error(error instanceof Error ? error.message : String(error))
          if (!res.writableEnded) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'OpenAI Realtime session failed' }))
          }
        }
      })

      server.middlewares.use('/api/gemini/stream', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        const apiKey = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY
        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Missing GEMINI_API_KEY in .env' }))
          return
        }

        try {
          const payload = await readJsonBody(req)
          const model = GEMINI_MODEL

          const body: Record<string, unknown> = {
            contents: payload.contents,
          }

          if (payload.systemInstruction) {
            body.systemInstruction = {
              parts: [{ text: String(payload.systemInstruction) }],
            }
          }

          if (typeof payload.temperature === 'number') {
            body.generationConfig = { temperature: payload.temperature }
          }

          const upstream = await fetch(
            `${API_BASE}/models/${encodeURIComponent(String(model))}:streamGenerateContent?alt=sse`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
              },
              body: JSON.stringify(body),
            },
          )

          res.statusCode = upstream.status
          res.setHeader(
            'Content-Type',
            upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
          )
          res.setHeader('Cache-Control', 'no-cache, no-transform')

          if (!upstream.ok || !upstream.body) {
            res.end(await upstream.text())
            return
          }

          const reader = upstream.body.getReader()
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            res.write(value)
          }
          res.end()
        } catch (error) {
          server.config.logger.error(error instanceof Error ? error.message : String(error))
          if (!res.writableEnded) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Gemini backend request failed' }))
          }
        }
      })
    },
  }
}

async function pipeResponseBody(
  upstream: Response,
  res: { write(chunk: Uint8Array): void; end(): void },
) {
  if (!upstream.body) {
    res.end()
    return
  }

  const reader = upstream.body.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    res.write(value)
  }
  res.end()
}

function readJsonBody(req: BodyRequest) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    req.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
    })

    req.on('end', () => {
      try {
        const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
        const merged = new Uint8Array(size)
        let offset = 0

        for (const chunk of chunks) {
          merged.set(chunk, offset)
          offset += chunk.byteLength
        }

        const raw = decoder.decode(merged)
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
      } catch (error) {
        reject(error)
      }
    })

    req.on('error', reject)
  })
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), geminiApiPlugin()],
})
