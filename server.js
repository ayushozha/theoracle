const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '15mb' }));

const KEY = process.env.GEMINI_KEY;
const PORT = process.env.PORT || 8080;

// Proxy: POST /gemini/<any path> -> https://generativelanguage.googleapis.com/<any path>?key=...
app.post('/gemini/*', async (req, res) => {
  if (!KEY) {
    res.status(500).json({ error: { message: 'Server missing GEMINI_KEY env var' } });
    return;
  }
  const suffix = req.path.replace(/^\/gemini/, '');
  const params = new URLSearchParams(req.query || {});
  params.set('key', KEY);
  const url = `https://generativelanguage.googleapis.com${suffix}?${params.toString()}`;

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);

    if (!upstream.body) return res.end();
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
});

// Static files (index.html, seed.json, etc.) from project root
app.use(express.static(__dirname, {
  index: 'index.html',
  // Don't serve sensitive files
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.env') || filePath.endsWith('config.local.js')) {
      res.status(403).end('forbidden');
    }
  },
}));

app.listen(PORT, () => console.log(`oracle on :${PORT}`));
