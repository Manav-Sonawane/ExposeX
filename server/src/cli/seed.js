// Create (or reset) a demo login with the sample footprint.
//   npm run seed            -> demo@exposex.app / demo12345
import { openDb } from '../db.js';
import { hashPassword } from '../auth.js';
import { seedSampleFootprint } from '../seed.js';

const email = process.argv[2] || 'demo@exposex.app';
const password = process.argv[3] || 'demo12345';

const db = openDb();
let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (!user) {
  const r = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(email, 'Alex Morgan', hashPassword(password));
  user = { id: Number(r.lastInsertRowid) };
} else {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
}
const out = seedSampleFootprint(db, user.id);
console.log(`Seeded ${out.accounts} nodes for ${email} (password: ${password}). Score: ${out.risk.score}/100`);
