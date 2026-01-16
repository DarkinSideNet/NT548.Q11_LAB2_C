import express from 'express';

const app = express();

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'service-b' });
});

app.get('/hello', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'service-b',
    message: 'Hello from service-b',
    time: new Date().toISOString()
  });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`service-b listening on :${port}`);
});
