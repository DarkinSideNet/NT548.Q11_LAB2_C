import express from 'express';
import jwt from 'jsonwebtoken';

const app = express();

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const serviceBUrl = process.env.SERVICE_B_URL ?? 'http://service-b:3000';
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';

app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'service-c' });
});

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username },
    jwtSecret,
    { expiresIn: '8h' }
  );
}

function requireAuth(req, res, next) {
  const auth = String(req.headers.authorization ?? '');
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!token) return res.status(401).json({ ok: false, error: 'missing token' });

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = {
      id: Number.parseInt(String(decoded.sub), 10),
      username: String(decoded.username ?? '')
    };
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: 'invalid token' });
  }
}

async function bFetch(path, init) {
  const url = `${serviceBUrl}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
}

app.post('/auth/register', async (req, res) => {
  try {
    const response = await bFetch('/internal/register', {
      method: 'POST',
      body: JSON.stringify(req.body ?? {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(data);
    const token = signToken(data.user);
    return res.status(201).json({ ok: true, token, user: data.user });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const response = await bFetch('/internal/login', {
      method: 'POST',
      body: JSON.stringify(req.body ?? {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(data);
    const token = signToken(data.user);
    return res.status(200).json({ ok: true, token, user: data.user });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.get('/items', requireAuth, async (_req, res) => {
  try {
    const response = await bFetch('/internal/items', { method: 'GET' });
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.post('/items', requireAuth, async (req, res) => {
  try {
    const response = await bFetch('/internal/items', {
      method: 'POST',
      body: JSON.stringify(req.body ?? {})
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.post('/items/:id/issue', requireAuth, async (req, res) => {
  try {
    const body = { ...(req.body ?? {}), userId: req.user?.id };
    const response = await bFetch(`/internal/items/${encodeURIComponent(req.params.id)}/issue`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.get('/transactions', requireAuth, async (req, res) => {
  const query = new URLSearchParams();
  if (req.query.limit) query.set('limit', String(req.query.limit));

  try {
    const response = await bFetch(`/internal/transactions?${query.toString()}`, { method: 'GET' });
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`service-c listening on :${port}, SERVICE_B_URL=${serviceBUrl}`);
});
