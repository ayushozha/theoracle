import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

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
          const model =
            (typeof payload.model === 'string' ? payload.model : undefined) ||
            env.VITE_GEMINI_MODEL ||
            env.GEMINI_MODEL ||
            'gemini-3.5-flash'

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
