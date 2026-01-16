import express from 'express';

const app = express();

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const serviceBUrl = process.env.SERVICE_B_URL ?? 'http://service-b:3000';

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
