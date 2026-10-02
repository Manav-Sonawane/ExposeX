import crypto from 'node:crypto';

const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = (stored || '').split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/** Secret comes from env, or is generated once and persisted in the DB. */
export function loadSecret(db) {
  if (process.env.EXPOSEX_SECRET) return process.env.EXPOSEX_SECRET;
  const row = db.prepare("SELECT value FROM kv WHERE key = 'token_secret'").get();
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO kv (key, value) VALUES ('token_secret', ?)").run(secret);
  return secret;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(secret, userId) {
  const payload = b64url(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.uid !== 'number' || data.exp < Date.now()) return null;
    return data.uid;
  } catch {
    return null;
  }
}

/** Express middleware: requires a valid bearer token (or ?token= for EventSource). */
export function requireAuth(db, secret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    const uid = verifyToken(secret, token);
    if (!uid) return res.status(401).json({ error: 'Not authenticated' });
    const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(uid);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.user = { ...user };
    next();
  };
}
