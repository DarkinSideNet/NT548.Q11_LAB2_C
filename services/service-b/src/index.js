import express from 'express';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const app = express();

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  // eslint-disable-next-line no-console
  console.error('Missing required env DATABASE_URL');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });

app.use(express.json({ limit: '1mb' }));

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      item_id INTEGER REFERENCES items(id) NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('IN','OUT')),
      qty INTEGER NOT NULL CHECK (qty > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'service-b' });
});

// Internal auth endpoints (called by service-c)
app.post('/internal/register', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username and password are required' });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);

  try {
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [String(username), passwordHash]
    );
    return res.status(201).json({ ok: true, user: result.rows[0] });
  } catch (e) {
    const message = String(e?.message ?? e);
    if (message.includes('users_username_key') || message.toLowerCase().includes('duplicate key')) {
      return res.status(409).json({ ok: false, error: 'username already exists' });
    }
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post('/internal/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username and password are required' });
  }

  const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [String(username)]);
  const user = result.rows[0];
  if (!user) {
    return res.status(401).json({ ok: false, error: 'invalid credentials' });
  }

  const ok = await bcrypt.compare(String(password), String(user.password_hash));
  if (!ok) {
    return res.status(401).json({ ok: false, error: 'invalid credentials' });
  }

  return res.status(200).json({ ok: true, user: { id: user.id, username: user.username } });
});

// Inventory endpoints (called by service-c)
app.get('/internal/items', async (_req, res) => {
  const result = await pool.query('SELECT id, sku, name, quantity FROM items ORDER BY id ASC');
  return res.status(200).json({ ok: true, items: result.rows });
});

app.post('/internal/items', async (req, res) => {
  const { sku, name, qty } = req.body ?? {};
  const qtyNum = Number.parseInt(String(qty ?? '0'), 10);

  if (!sku || !name || !Number.isFinite(qtyNum) || qtyNum <= 0) {
    return res.status(400).json({ ok: false, error: 'sku, name, qty (>0) are required' });
  }

  // Upsert: if SKU exists, increase quantity; else create.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const upsert = await client.query(
      `
      INSERT INTO items (sku, name, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT (sku) DO UPDATE SET
        name = EXCLUDED.name,
        quantity = items.quantity + EXCLUDED.quantity
      RETURNING id, sku, name, quantity;
      `,
      [String(sku), String(name), qtyNum]
    );

    const item = upsert.rows[0];

    await client.query(
      'INSERT INTO transactions (user_id, item_id, type, qty) VALUES ($1, $2, $3, $4)',
      [null, item.id, 'IN', qtyNum]
    );

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, item });
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

app.post('/internal/items/:id/issue', async (req, res) => {
  const itemId = Number.parseInt(req.params.id, 10);
  const { qty, userId } = req.body ?? {};
  const qtyNum = Number.parseInt(String(qty ?? '0'), 10);
  const userIdNum = userId == null ? null : Number.parseInt(String(userId), 10);

  if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(qtyNum) || qtyNum <= 0) {
    return res.status(400).json({ ok: false, error: 'invalid item id or qty' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query('SELECT id, sku, name, quantity FROM items WHERE id = $1 FOR UPDATE', [itemId]);
    const item = current.rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'item not found' });
    }
    if (Number(item.quantity) < qtyNum) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'not enough stock' });
    }

    const updated = await client.query(
      'UPDATE items SET quantity = quantity - $1 WHERE id = $2 RETURNING id, sku, name, quantity',
      [qtyNum, itemId]
    );

    await client.query(
      'INSERT INTO transactions (user_id, item_id, type, qty) VALUES ($1, $2, $3, $4)',
      [userIdNum, itemId, 'OUT', qtyNum]
    );

    await client.query('COMMIT');
    return res.status(200).json({ ok: true, item: updated.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

app.get('/internal/transactions', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit ?? '50'), 10)));
  const result = await pool.query(
    `
    SELECT t.id, t.type, t.qty, t.created_at, t.item_id,
           i.sku, i.name,
           u.username
    FROM transactions t
    JOIN items i ON i.id = t.item_id
    LEFT JOIN users u ON u.id = t.user_id
    ORDER BY t.id DESC
    LIMIT $1;
    `,
    [limit]
  );
  return res.status(200).json({ ok: true, transactions: result.rows });
});

async function start() {
  await migrate();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`service-b listening on :${port} (PostgreSQL connected)`);
  });
}

start().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start service-b:', e);
  process.exit(1);
});
