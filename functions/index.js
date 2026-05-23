const { onRequest } = require('firebase-functions/v2/https');

// Proxies any POST to /gemini/<anything> through to generativelanguage.googleapis.com,
// injecting the API key server-side. Streams the body back so SSE works.
// Key comes from process.env.GEMINI_KEY — set via functions/.env (gitignored).
exports.gemini = onRequest(
  { cors: true, timeoutSeconds: 300, memory: '512MiB', region: 'us-central1' },
  async (req, res) => {
    const KEY = process.env.GEMINI_KEY;
    if (!KEY) { res.status(500).send('Server missing GEMINI_KEY env var'); return; }
    if (req.method !== 'POST') {
      res.status(405).send('Use POST');
      return;
    }
    // req.path is "/gemini/v1beta/..." when called via Hosting rewrite — strip the prefix.
    let path = (req.path || '').replace(/^\/gemini/, '');
    if (!path.startsWith('/')) path = '/' + path;

    // Preserve query (e.g. alt=sse) and append the key
    const query = new URLSearchParams(req.query || {});
    query.set('key', KEY);
    const url = `https://generativelanguage.googleapis.com${path}?${query.toString()}`;

    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {}),
      });
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.set('Content-Type', ct);

      if (!upstream.body) {
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (e) {
      console.error('proxy error', e);
      res.status(502).json({ error: { message: e.message } });
    }
  }
);
