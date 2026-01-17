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
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        padding: 20px;
        color: #333;
      }
      
      .container {
        max-width: 1200px;
        margin: 0 auto;
        background: white;
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        padding: 40px;
        animation: slideIn 0.5s ease-out;
      }
      
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(-30px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      h1 {
        color: #667eea;
        margin-bottom: 30px;
        font-size: 2.5em;
        text-align: center;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      
      h2 {
        color: #555;
        margin: 30px 0 20px 0;
        padding-bottom: 10px;
        border-bottom: 3px solid #667eea;
        font-size: 1.8em;
      }
      
      .header-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 30px;
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 10px;
        color: white;
      }
      
      .header-bar h1 {
        color: white;
        margin: 0;
        -webkit-text-fill-color: white;
      }
      
      .logout-btn {
        background: rgba(255,255,255,0.2);
        color: white;
        padding: 10px 20px;
        text-decoration: none;
        border-radius: 8px;
        transition: all 0.3s;
        border: 2px solid white;
      }
      
      .logout-btn:hover {
        background: white;
        color: #667eea;
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
      }
      
      .form-card {
        background: #f8f9fa;
        padding: 25px;
        border-radius: 15px;
        margin-bottom: 30px;
        border: 2px solid #e9ecef;
        transition: all 0.3s;
      }
      
      .form-card:hover {
        border-color: #667eea;
        box-shadow: 0 5px 20px rgba(102, 126, 234, 0.1);
      }
      
      label {
        display: block;
        margin-bottom: 15px;
        color: #555;
        font-weight: 600;
      }
      
      input[type="text"],
      input[type="password"],
      input[type="number"] {
        width: 100%;
        padding: 12px 15px;
        margin-top: 5px;
        border: 2px solid #e9ecef;
        border-radius: 8px;
        font-size: 16px;
        transition: all 0.3s;
      }
      
      input:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
      }
      
      button[type="submit"],
      .btn {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 30px;
        border: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
        margin-top: 10px;
      }
      
      button[type="submit"]:hover,
      .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
      }
      
      button[type="submit"]:active {
        transform: translateY(0);
      }
      
      .issue-btn {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        padding: 8px 15px;
        font-size: 14px;
      }
      
      table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        margin-top: 20px;
        background: white;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 5px 15px rgba(0,0,0,0.08);
      }
      
      thead {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }
      
      th {
        padding: 15px;
        text-align: left;
        font-weight: 600;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      td {
        padding: 15px;
        border-bottom: 1px solid #f0f0f0;
      }
      
      tbody tr {
        transition: all 0.3s;
      }
      
      tbody tr:hover {
        background: #f8f9fa;
        transform: scale(1.01);
      }
      
      tbody tr:last-child td {
        border-bottom: none;
      }
      
      .empty-state {
        text-align: center;
        padding: 40px;
        color: #999;
        font-style: italic;
      }
      
      a {
        color: #667eea;
        text-decoration: none;
        font-weight: 600;
        transition: all 0.3s;
      }
      
      a:hover {
        color: #764ba2;
        text-decoration: underline;
      }
      
      p {
        margin: 15px 0;
        line-height: 1.6;
      }
      
      .auth-container {
        max-width: 450px;
        margin: 100px auto;
        background: white;
        padding: 40px;
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      }
      
      .auth-container h1 {
        margin-bottom: 30px;
        text-align: center;
      }
      
      .auth-links {
        text-align: center;
        margin-top: 20px;
        padding-top: 20px;
        border-top: 1px solid #e9ecef;
      }
      
      .form-inline {
        display: flex;
        gap: 10px;
        align-items: flex-end;
      }
      
      .form-inline input {
        flex: 1;
        margin-top: 0;
      }
      
      .badge {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
      }
      
      .badge-success {
        background: #d4edda;
        color: #155724;
      }
      
      .badge-warning {
        background: #fff3cd;
        color: #856404;
      }
      
      .badge-danger {
        background: #f8d7da;
        color: #721c24;
      }
      
      .error-message {
        background: #f8d7da;
        color: #721c24;
        padding: 15px 20px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #721c24;
      }
      
      .success-message {
        background: #d4edda;
        color: #155724;
        padding: 15px 20px;
        border-radius: 8px;
        margin: 20px 0;
        border-left: 4px solid #155724;
      }
      
      @media (max-width: 768px) {
        .container {
          padding: 20px;
        }
        
        h1 {
          font-size: 1.8em;
        }
        
        table {
          font-size: 14px;
        }
        
        th, td {
          padding: 10px;
        }
        
        .header-bar {
          flex-direction: column;
          gap: 15px;
          text-align: center;
        }
      }
    </style>
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
      <div class="auth-container">
        <h1>🏪 Kho hàng</h1>
        <h2 style="text-align: center; color: #555; font-size: 1.3em; margin-bottom: 30px; border: none;">Đăng nhập</h2>
        <form method="post" action="/login">
          <label>
            Tên đăng nhập
            <input name="username" required placeholder="Nhập tên đăng nhập..." />
          </label>
          <label>
            Mật khẩu
            <input name="password" type="password" required placeholder="Nhập mật khẩu..." />
          </label>
          <button type="submit" style="width: 100%;">Đăng nhập</button>
        </form>
        <div class="auth-links">
          <p>Chưa có tài khoản? <a href="/register">Đăng ký ngay</a></p>
        </div>
      </div>
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
        page('Đăng nhập thất bại', `
          <div class="auth-container">
            <div class="error-message">
              <strong>❌ Lỗi đăng nhập:</strong> ${escapeHtml(data?.error ?? 'Không xác định')}
            </div>
            <p style="text-align: center;"><a href="/login">← Quay lại đăng nhập</a></p>
          </div>
        `)
      );
    }
    setTokenCookie(res, data.token);
    return res.redirect('/');
  } catch (e) {
    return res.status(200).type('html').send(
      page('Lỗi hệ thống', `
        <div class="auth-container">
          <div class="error-message">
            <strong>❌ Lỗi hệ thống:</strong><br/>
            <pre style="margin-top: 10px;">${escapeHtml(String(e?.message ?? e))}</pre>
          </div>
          <p style="text-align: center;"><a href="/login">← Quay lại đăng nhập</a></p>
        </div>
      `)
    );
  }
});

app.get('/register', (_req, res) => {
  res.status(200).type('html').send(
    page(
      'Register',
      `
      <div class="auth-container">
        <h1>🏪 Kho hàng</h1>
        <h2 style="text-align: center; color: #555; font-size: 1.3em; margin-bottom: 30px; border: none;">Tạo tài khoản</h2>
        <form method="post" action="/register">
          <label>
            Tên đăng nhập
            <input name="username" required placeholder="Chọn tên đăng nhập..." />
          </label>
          <label>
            Mật khẩu
            <input name="password" type="password" required placeholder="Tạo mật khẩu..." />
          </label>
          <button type="submit" style="width: 100%;">Đăng ký</button>
        </form>
        <div class="auth-links">
          <p>Đã có tài khoản? <a href="/login">Đăng nhập</a></p>
        </div>
      </div>
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
        page('Đăng ký thất bại', `
          <div class="auth-container">
            <div class="error-message">
              <strong>❌ Lỗi đăng ký:</strong> ${escapeHtml(data?.error ?? 'Không xác định')}
            </div>
            <p style="text-align: center;"><a href="/register">← Quay lại đăng ký</a></p>
          </div>
        `)
      );
    }
    setTokenCookie(res, data.token);
    return res.redirect('/');
  } catch (e) {
    return res.status(200).type('html').send(
      page('Lỗi hệ thống', `
        <div class="auth-container">
          <div class="error-message">
            <strong>❌ Lỗi hệ thống:</strong><br/>
            <pre style="margin-top: 10px;">${escapeHtml(String(e?.message ?? e))}</pre>
          </div>
          <p style="text-align: center;"><a href="/register">← Quay lại đăng ký</a></p>
        </div>
      `)
    );
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
        page('Phiên đăng nhập hết hạn', `
          <div class="auth-container">
            <div class="error-message">
              <strong>⏰ Phiên đăng nhập đã hết hạn</strong>
            </div>
            <p style="text-align: center;"><a href="/login">← Đăng nhập lại</a></p>
          </div>
        `)
      );
    }

    const rows = (data.items ?? [])
      .map(
        (it) => `
        <tr>
          <td><strong>#${escapeHtml(it.id)}</strong></td>
          <td><span class="badge badge-success">${escapeHtml(it.sku)}</span></td>
          <td>${escapeHtml(it.name)}</td>
          <td><strong>${escapeHtml(it.quantity)}</strong> ${it.quantity > 10 ? '✅' : it.quantity > 0 ? '⚠️' : '❌'}</td>
          <td>
            <form method="post" action="/items/${encodeURIComponent(it.id)}/issue" class="form-inline">
              <input name="qty" type="number" min="1" max="${it.quantity}" value="1" required style="width: 80px;" />
              <button type="submit" class="issue-btn">📤 Xuất kho</button>
            </form>
          </td>
        </tr>`
      )
      .join('');

    return res.status(200).type('html').send(
      page(
        'Kho hàng',
        `
        <div class="container">
          <div class="header-bar">
            <h1>🏪 Quản lý kho hàng</h1>
            <a href="/logout" class="logout-btn">🚪 Đăng xuất</a>
          </div>

          <div class="form-card">
            <h2>📦 Nhập hàng mới</h2>
            <form method="post" action="/items">
              <label>
                Mã SKU
                <input name="sku" required placeholder="VD: SKU-001" />
              </label>
              <label>
                Tên sản phẩm
                <input name="name" required placeholder="VD: Laptop Dell XPS 15" />
              </label>
              <label>
                Số lượng nhập
                <input name="qty" type="number" min="1" value="1" required placeholder="Nhập số lượng..." />
              </label>
              <button type="submit">✅ Nhập kho</button>
            </form>
          </div>

          <h2>📊 Tồn kho hiện tại</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Mã SKU</th>
                <th>Tên sản phẩm</th>
                <th>Số lượng</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="5" class="empty-state">📭 Chưa có hàng trong kho</td></tr>'}
            </tbody>
          </table>
        </div>
        `
      )
    );
  } catch (e) {
    return res.status(200).type('html').send(
      page('Lỗi hệ thống', `
        <div class="container">
          <div class="error-message">
            <strong> Lỗi hệ thống:</strong><br/>
            <pre style="margin-top: 10px;">${escapeHtml(String(e?.message ?? e))}</pre>
          </div>
          <p><a href="/">← Quay lại trang chủ</a></p>
        </div>
      `)
    );
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
      return res.status(200).type('html').send(
        page('Lỗi nhập kho', `
          <div class="container">
            <div class="error-message">
              <strong>❌ Lỗi:</strong> ${escapeHtml(data?.error ?? 'Không thể nhập kho')}
            </div>
            <p><a href="/">← Quay lại trang chủ</a></p>
          </div>
        `)
      );
    }
    return res.redirect('/');
  } catch (e) {
    return res.status(200).type('html').send(
      page('Lỗi hệ thống', `
        <div class="container">
          <div class="error-message">
            <strong>❌ Lỗi hệ thống:</strong><br/>
            <pre style="margin-top: 10px;">${escapeHtml(String(e?.message ?? e))}</pre>
          </div>
          <p><a href="/">← Quay lại trang chủ</a></p>
        </div>
      `)
    );
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
      return res.status(200).type('html').send(
        page('Lỗi xuất kho', `
          <div class="container">
            <div class="error-message">
              <strong>❌ Lỗi:</strong> ${escapeHtml(data?.error ?? 'Không thể xuất kho')}
            </div>
            <p><a href="/">← Quay lại trang chủ</a></p>
          </div>
        `)
      );
    }
    return res.redirect('/');
  } catch (e) {
    return res.status(200).type('html').send(
      page('Lỗi hệ thống', `
        <div class="container">
          <div class="error-message">
            <strong>❌ Lỗi hệ thống:</strong><br/>
            <pre style="margin-top: 10px;">${escapeHtml(String(e?.message ?? e))}</pre>
          </div>
          <p><a href="/">← Quay lại trang chủ</a></p>
        </div>
      `)
    );
  }
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'service-a' });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`service-a listening on :${port}, SERVICE_C_URL=${serviceCUrl}`);
});
