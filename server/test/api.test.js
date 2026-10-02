import { test, before, after } from 'node:test';
process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { runScheduledJobs } from '../src/scheduler.js';

let server;
let base;
let db;

before(async () => {
  db = openDb(':memory:');
  const app = createApp(db, { secret: 'test-secret', clientDir: '/nonexistent' });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

test('auth: register, login, reject bad credentials and missing token', async () => {
  const reg = await call('/auth/register', { method: 'POST', body: { email: 'u@x.io', name: 'U', password: 'longpassword' } });
  assert.equal(reg.status, 200);
  assert.ok(reg.body.token);
  const dup = await call('/auth/register', { method: 'POST', body: { email: 'u@x.io', name: 'U', password: 'longpassword' } });
  assert.equal(dup.status, 409);
  const bad = await call('/auth/login', { method: 'POST', body: { email: 'u@x.io', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const ok = await call('/auth/login', { method: 'POST', body: { email: 'u@x.io', password: 'longpassword' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('/accounts')).status, 401);
  assert.equal((await call('/accounts', { token: 'garbage.token' })).status, 401);
});

test('inventory CRUD, links, filters and validation', async () => {
  const { body } = await call('/auth/register', { method: 'POST', body: { email: 'c@x.io', name: 'C', password: 'longpassword' } });
  const token = body.token;
  const group = (await call('/groups', { token, method: 'POST', body: { label: 'shared' } })).body;
  const mail = (await call('/accounts', { token, method: 'POST', body: { name: 'Mail', serviceType: 'email', importance: 5, passwordGroupId: group.id } })).body;
  const shop = (await call('/accounts', { token, method: 'POST', body: { name: 'Shop', serviceType: 'shopping', twofa: 'totp', passwordGroupId: group.id, dataShared: ['payment'] } })).body;
  assert.equal(mail.name, 'Mail');

  const invalid = await call('/accounts', { token, method: 'POST', body: { name: '', twofa: 'carrier-pigeon' } });
  assert.equal(invalid.status, 400);

  const link = await call('/links', { token, method: 'POST', body: { sourceId: mail.id, targetId: shop.id, type: 'recovery_email' } });
  assert.equal(link.status, 201);

  const all = (await call('/accounts', { token })).body;
  assert.equal(all.total, 2);
  assert.ok(all.accounts.every((a) => a.reused));
  assert.equal((await call('/accounts?twofa=strong', { token })).body.total, 1);
  assert.equal((await call('/accounts?data=payment', { token })).body.total, 1);
  assert.equal((await call('/accounts?q=mai', { token })).body.total, 1);
  assert.equal((await call('/accounts?type=shopping,email', { token })).body.total, 2);

  const detail = (await call(`/accounts/${shop.id}`, { token })).body;
  assert.equal(detail.links.length, 1);
  assert.equal(detail.siblings[0].name, 'Mail');
  assert.ok(detail.node.inbound[0].fromName === 'Mail');

  // Another user cannot see or touch these.
  const other = (await call('/auth/register', { method: 'POST', body: { email: 'o@x.io', name: 'O', password: 'longpassword' } })).body.token;
  assert.equal((await call(`/accounts/${shop.id}`, { token: other })).status, 404);
  assert.equal((await call('/links', { token: other, method: 'POST', body: { sourceId: mail.id, targetId: shop.id, type: 'sso' } })).status, 400);

  assert.equal((await call(`/accounts/${shop.id}`, { token, method: 'DELETE' })).status, 200);
  assert.equal((await call('/accounts', { token })).body.total, 1);
});

test('sample footprint: dashboard, fixes, completing a fix raises the score', async () => {
  const { body } = await call('/auth/demo', { method: 'POST' });
  const token = body.token;
  const dash = (await call('/dashboard', { token })).body;
  assert.ok(dash.overall.score > 0 && dash.overall.score < 70);
  assert.ok(dash.spofs.length >= 1, 'sample data has single points of failure');
  assert.ok(dash.history.length >= 3);

  const { fixes } = (await call('/fixes', { token })).body;
  assert.ok(fixes.length > 10);
  const top = fixes[0];
  const done = (await call('/fixes/complete', { token, method: 'POST', body: { key: top.key } })).body;
  assert.ok(done.scoreAfter >= done.scoreBefore);
  const again = await call('/fixes/complete', { token, method: 'POST', body: { key: top.key } });
  assert.equal(again.status, 404, 'a completed fix disappears from the list');

  const dismissed = await call('/fixes/dismiss', { token, method: 'POST', body: { key: fixes[1].key } });
  assert.equal(dismissed.status, 200);
  const after = (await call('/fixes', { token })).body;
  assert.ok(!after.fixes.some((f) => f.key === fixes[1].key));
  assert.equal(after.completed[0].key, top.key);

  const graph = (await call('/graph', { token })).body;
  assert.ok(graph.nodes.length > 20 && graph.edges.length > 20);
});

test('breaches: simulate, analyze, scan catalog, resolve; notifications created', async () => {
  const { body } = await call('/auth/demo', { method: 'POST' });
  const token = body.token;
  const accounts = (await call('/accounts?q=gmail', { token })).body.accounts;
  const gmail = accounts[0];
  const sim = await call('/breaches/simulate', { token, method: 'POST', body: { accountId: gmail.id } });
  assert.equal(sim.status, 201);
  assert.ok(sim.body.analysis.affected.length > 10, 'gmail breach should cascade');
  assert.ok(sim.body.analysis.steps.length >= 2);

  const analysis = (await call(`/breaches/${sim.body.breach.id}/analysis`, { token })).body;
  assert.equal(analysis.analysis.account.name, 'Gmail');

  const notes = (await call('/notifications', { token })).body;
  assert.ok(notes.notifications.some((n) => n.type === 'breach'));

  // Seed already contains catalog breaches; a scan should find none new.
  const scan = (await call('/breaches/scan', { token, method: 'POST' })).body;
  assert.equal(scan.found.length, 0);

  const res = await call(`/breaches/${sim.body.breach.id}/resolve`, { token, method: 'POST' });
  assert.equal(res.status, 200);
  const list = (await call('/breaches', { token })).body;
  assert.equal(list.find((b) => b.id === sim.body.breach.id).status, 'resolved');
});

test('scheduler sends review reminders and simulated breaches', async () => {
  const { body } = await call('/auth/demo', { method: 'POST' });
  const token = body.token;
  await call('/me', { token, method: 'PATCH', body: { reviewIntervalDays: 1, breachSimMinutes: 1 } });
  const future = new Date(Date.now() + 3 * 86_400_000);
  runScheduledJobs(db, future);
  const notes = (await call('/notifications', { token })).body.notifications;
  assert.ok(notes.some((n) => n.type === 'reminder'));
  assert.ok(notes.some((n) => n.type === 'breach' && n.title.startsWith('Simulated')));
});

test('export and import round-trip', async () => {
  const { body } = await call('/auth/demo', { method: 'POST' });
  const token = body.token;
  const exported = (await call('/export', { token })).body;
  const before = (await call('/dashboard', { token })).body.overall.score;
  const fresh = (await call('/auth/register', { method: 'POST', body: { email: 'imp@x.io', name: 'I', password: 'longpassword' } })).body.token;
  const imp = await call('/import', { token: fresh, method: 'POST', body: exported });
  assert.equal(imp.status, 200);
  const afterScore = (await call('/dashboard', { token: fresh })).body.overall.score;
  assert.ok(Math.abs(afterScore - before) <= 2, `${before} vs ${afterScore}`);
});

test('login is rate limited', async () => {
  delete process.env.NODE_ENV;
  const { createApp: create } = await import('../src/app.js');
  const app = create(openDb(':memory:'), { secret: 's', clientDir: '/nonexistent' });
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const url = `http://127.0.0.1:${srv.address().port}/api/auth/login`;
  let last;
  for (let i = 0; i < 31; i++)
    last = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x@y.io', password: 'nope' }) });
  assert.equal(last.status, 429);
  srv.close();
  process.env.NODE_ENV = 'test';
});
