import express from 'express';

const app = express();

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const serviceBUrl = process.env.SERVICE_B_URL ?? 'http://service-b:3000';

app.get('/', (_req, res) => {
  res.status(200).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Micro Demo</title>
  </head>
  <body>
    <h1>Microservices Demo</h1>
    <p>This page calls <code>/api</code> on service-a, which calls service-b.</p>

    <button id="call">Call /api</button>
    <pre id="out" style="white-space: pre-wrap;"></pre>

    <script>
      const out = document.getElementById('out');
      const btn = document.getElementById('call');

      async function callApi() {
        out.textContent = 'Loading...';
        try {
          const r = await fetch('/api', { headers: { 'accept': 'application/json' } });
          const text = await r.text();
          try {
            out.textContent = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            out.textContent = text;
          }
        } catch (e) {
          out.textContent = String(e);
        }
      }

      btn.addEventListener('click', callApi);
      callApi();
    </script>
  </body>
</html>`);
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'service-a' });
});

app.get('/api', async (_req, res) => {
  try {
    const response = await fetch(`${serviceBUrl}/hello`);
    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        service: 'service-a',
        error: `service-b responded ${response.status}`
      });
    }
    const data = await response.json();
    return res.status(200).json({
      ok: true,
      service: 'service-a',
      fromB: data,
      time: new Date().toISOString()
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      service: 'service-a',
      error: err?.message ?? String(err)
    });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`service-a listening on :${port}, SERVICE_B_URL=${serviceBUrl}`);
});
