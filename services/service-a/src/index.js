import express from 'express';

const app = express();

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const serviceCUrl = process.env.SERVICE_C_URL ?? 'http://service-c:3000';

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '1mb' }));

function parseCookies(cookieHeader) {
  const raw = String(cookieHeader ?? '');
  const out = {};
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') ?? '');
  }
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function cFetch(path, init = {}, token) {
  return fetch(`${serviceCUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });
}

function setTokenCookie(res, token) {
  // Note: TLS/HTTPS recommended in real environments; HttpOnly helps against XSS.
  res.setHeader('Set-Cookie', `token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearTokenCookie(res) {
  res.setHeader('Set-Cookie', 'token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

app.get('/login', (_req, res) => {
  res.status(200).type('html').send(
    page(
      'Login',
      `
      <h1>Kho hàng - Đăng nhập</h1>
      <form method="post" action="/login">
        <label>Username <input name="username" required /></label><br />
        <label>Password <input name="password" type="password" required /></label><br />
        <button type="submit">Login</button>
      </form>
      <p>Chưa có tài khoản? <a href="/register">Register</a></p>
      `
    )
  );
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  try {
    const r = await cFetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(200).type('html').send(
        page('Login failed', `<p>Login failed: ${escapeHtml(data?.error ?? 'unknown')}</p><p><a href="/login">Back</a></p>`)
      );
    }
    setTokenCookie(res, data.token);
    return res.redirect('/');
  } catch (e) {
    return res.status(200).type('html').send(page('Login error', `<pre>${escapeHtml(String(e?.message ?? e))}</pre>`));
  }
});

app.get('/register', (_req, res) => {
  res.status(200).type('html').send(
    page(
      'Register',
      `
      <h1>Kho hàng - Tạo tài khoản</h1>
      <form method="post" action="/register">
        <label>Username <input name="username" required /></label><br />
        <label>Password <input name="password" type="password" required /></label><br />
        <button type="submit">Register</button>
      </form>
      <p>Đã có tài khoản? <a href="/login">Login</a></p>
      `
    )
  );
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body ?? {};
  try {
    const r = await cFetch('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(200).type('html').send(
        page('Register failed', `<p>Register failed: ${escapeHtml(data?.error ?? 'unknown')}</p><p><a href="/register">Back</a></p>`)
      );
    }
    setTokenCookie(res, data.token);
    return res.redirect('/');
  } catch (e) {
    return res.status(200).type('html').send(page('Register error', `<pre>${escapeHtml(String(e?.message ?? e))}</pre>`));
  }
});

app.get('/logout', (_req, res) => {
  clearTokenCookie(res);
  return res.redirect('/login');
});

app.get('/', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.token;
  if (!token) return res.redirect('/login');

  try {
    const r = await cFetch('/items', { method: 'GET' }, token);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      clearTokenCookie(res);
      return res.status(200).type('html').send(
        page('Auth', `<p>Session expired. <a href="/login">Login</a></p>`)
      );
    }

    const rows = (data.items ?? [])
      .map(
        (it) => `
        <tr>
          <td>${escapeHtml(it.id)}</td>
          <td>${escapeHtml(it.sku)}</td>
          <td>${escapeHtml(it.name)}</td>
          <td>${escapeHtml(it.quantity)}</td>
          <td>
            <form method="post" action="/items/${encodeURIComponent(it.id)}/issue" style="display:inline;">
              <input name="qty" type="number" min="1" value="1" required style="width: 80px;" />
              <button type="submit">Xuất</button>
            </form>
          </td>
        </tr>`
      )
      .join('');

    return res.status(200).type('html').send(
      page(
        'Kho hàng',
        `
        <h1>Quản lý kho hàng</h1>
        <p><a href="/logout">Logout</a></p>

        <h2>Thêm hàng</h2>
        <form method="post" action="/items">
          <label>SKU <input name="sku" required /></label><br />
          <label>Tên <input name="name" required /></label><br />
          <label>Số lượng <input name="qty" type="number" min="1" value="1" required /></label><br />
          <button type="submit">Nhập kho</button>
        </form>

        <h2>Tồn kho</h2>
        <table border="1" cellpadding="6" cellspacing="0">
          <thead>
            <tr><th>ID</th><th>SKU</th><th>Tên</th><th>Số lượng</th><th>Xuất</th></tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5">Chưa có hàng</td></tr>'}
          </tbody>
        </table>
        `
      )
    );
  } catch (e) {
    return res.status(200).type('html').send(page('Error', `<pre>${escapeHtml(String(e?.message ?? e))}</pre>`));
  }
});

app.post('/items', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.token;
  if (!token) return res.redirect('/login');

  const { sku, name, qty } = req.body ?? {};
  try {
    const r = await cFetch(
      '/items',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku, name, qty })
      },
      token
    );
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return res.status(200).type('html').send(page('Error', `<p>${escapeHtml(data?.error ?? 'failed')}</p><p><a href="/">Back</a></p>`));
    }
    return res.redirect('/');
  } catch (e) {
    return res.status(200).type('html').send(page('Error', `<pre>${escapeHtml(String(e?.message ?? e))}</pre>`));
  }
});

app.post('/items/:id/issue', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.token;
  if (!token) return res.redirect('/login');

  const { qty } = req.body ?? {};
  try {
    const r = await cFetch(
      `/items/${encodeURIComponent(req.params.id)}/issue`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qty })
      },
      token
    );
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return res.status(200).type('html').send(page('Error', `<p>${escapeHtml(data?.error ?? 'failed')}</p><p><a href="/">Back</a></p>`));
    }
    return res.redirect('/');
  } catch (e) {
    return res.status(200).type('html').send(page('Error', `<pre>${escapeHtml(String(e?.message ?? e))}</pre>`));
  }
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'service-a' });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`service-a listening on :${port}, SERVICE_C_URL=${serviceCUrl}`);
});
