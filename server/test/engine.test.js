import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRisk, transmission } from '../src/engine/risk.js';
import { generateFixes, applyMutation, cloneFootprint } from '../src/engine/fixes.js';
import { analyzeBreach } from '../src/engine/breach.js';

const today = new Date().toISOString().slice(0, 10);
const acc = (id, extra = {}) => ({
  id,
  kind: 'account',
  name: `A${id}`,
  serviceType: 'other',
  importance: 3,
  twofa: 'none',
  signInMethods: ['password'],
  passwordGroupId: null,
  permissions: [],
  dataShared: [],
  lastActive: today,
  status: 'active',
  ...extra,
});

test('isolated strong account is low risk; weak one is higher', () => {
  const fp = { accounts: [acc(1, { twofa: 'hardware' }), acc(2)], links: [], breaches: [] };
  const r = computeRisk(fp);
  const [strong, weak] = r.nodes;
  assert.ok(strong.P < weak.P);
  assert.ok(strong.risk < weak.risk);
  assert.equal(r.spofs.length, 0);
});

test('risk propagates: a weak recovery inbox makes a strong account vulnerable', () => {
  const inbox = acc(1, { serviceType: 'email', passwordGroupId: 9 });
  const reuse = acc(3, { passwordGroupId: 9 });
  const bank = acc(2, { twofa: 'none', importance: 5 });
  const isolated = computeRisk({ accounts: [bank], links: [], breaches: [] }).nodes[0];
  const linked = computeRisk({
    accounts: [inbox, bank, reuse],
    links: [{ id: 1, sourceId: 1, targetId: 2, type: 'recovery_email' }],
    breaches: [{ id: 1, accountId: 3, title: 'x', status: 'open', severity: 'high', dataClasses: ['passwords'] }],
  }).nodes.find((n) => n.id === 2);
  assert.ok(linked.P > isolated.P + 0.1, `expected inherited risk, got ${linked.P} vs ${isolated.P}`);
  assert.ok(linked.inherited > 0);
  assert.equal(linked.p, isolated.p, 'intrinsic risk is unchanged');
});

test('2FA on the target blocks recovery-email takeover, except same-channel 2FA', () => {
  const src = acc(1);
  const link = { type: 'recovery_email' };
  assert.ok(transmission(link, src, acc(2, { twofa: 'hardware' })) < transmission(link, src, acc(2)));
  // SMS 2FA does not help when the attacker owns the recovery phone.
  const phone = { ...acc(1), kind: 'phone' };
  assert.equal(
    transmission({ type: 'recovery_phone' }, phone, acc(2, { twofa: 'sms' })),
    transmission({ type: 'recovery_phone' }, phone, acc(2, { twofa: 'none' })),
  );
});

test('cycles do not self-amplify a node above its inputs', () => {
  // A <-> B with nothing else risky: P should stay close to intrinsic.
  const fp = {
    accounts: [acc(1, { twofa: 'hardware' }), acc(2, { twofa: 'hardware' })],
    links: [
      { id: 1, sourceId: 1, targetId: 2, type: 'sso' },
      { id: 2, sourceId: 2, targetId: 1, type: 'sso' },
    ],
    breaches: [],
  };
  const r = computeRisk(fp);
  for (const n of r.nodes) assert.ok(n.P < 0.06, `P=${n.P} should be ~ p1 + p2`);
});

test('hub that can reset many accounts is flagged as single point of failure', () => {
  const accounts = [acc(1, { serviceType: 'email', importance: 5 })];
  const links = [];
  for (let i = 2; i <= 6; i++) {
    accounts.push(acc(i));
    links.push({ id: i, sourceId: 1, targetId: i, type: 'recovery_email' });
  }
  const r = computeRisk({ accounts, links, breaches: [] });
  assert.deepEqual(r.spofs, [1]);
  const hub = r.nodes.find((n) => n.id === 1);
  assert.equal(hub.blast.count, 5);
  assert.equal(hub.blast.dependents[0].path[0].from, 1);
});

test('deterministic: same input gives identical output', () => {
  const fp = {
    accounts: [acc(1), acc(2), acc(3)],
    links: [{ id: 1, sourceId: 1, targetId: 2, type: 'recovery_email' }, { id: 2, sourceId: 2, targetId: 3, type: 'sso' }],
    breaches: [],
  };
  assert.deepEqual(computeRisk(fp), computeRisk(fp));
});

test('fixes are ranked by network impact: securing the hub beats a leaf', () => {
  const accounts = [acc(1, { serviceType: 'email', importance: 5 })];
  const links = [];
  for (let i = 2; i <= 7; i++) {
    accounts.push(acc(i, { twofa: 'totp' }));
    links.push({ id: i, sourceId: 1, targetId: i, type: 'sso' });
  }
  accounts.push(acc(99, { importance: 2 }));
  const fixes = generateFixes({ accounts, links, breaches: [] });
  assert.equal(fixes[0].key, '2fa:1');
  const leaf = fixes.find((f) => f.key === '2fa:99');
  assert.ok(leaf && leaf.gain < fixes[0].gain);
  for (let i = 1; i < fixes.length; i++) assert.ok(fixes[i - 1].gain >= fixes[i].gain);
});

test('applying every suggested fix strictly improves the score', () => {
  const fp = {
    accounts: [
      acc(1, { serviceType: 'email', passwordGroupId: 1 }),
      acc(2, { passwordGroupId: 1 }),
      acc(3, { kind: 'app', permissions: ['location', 'contacts'], lastActive: '2020-01-01' }),
      { ...acc(4), kind: 'phone' },
    ],
    links: [
      { id: 1, sourceId: 1, targetId: 2, type: 'recovery_email' },
      { id: 2, sourceId: 4, targetId: 1, type: 'recovery_phone' },
    ],
    breaches: [{ id: 1, accountId: 2, title: 'leak', status: 'open', severity: 'high', dataClasses: ['passwords'] }],
  };
  const before = computeRisk(fp, { blast: false }).overall.scoreExact;
  let cur = cloneFootprint(fp);
  for (let i = 0; i < 30; i++) {
    const fx = generateFixes(cur);
    if (!fx.length) break;
    applyMutation(cur, fx[0].mutation);
  }
  const after = computeRisk(cur, { blast: false }).overall.scoreExact;
  assert.ok(after > before + 20, `${before} -> ${after}`);
});

test('breach analysis lists linked and password-reuse victims with next steps', () => {
  const fp = {
    accounts: [acc(1, { passwordGroupId: 5 }), acc(2), acc(3, { passwordGroupId: 5 })],
    links: [{ id: 1, sourceId: 1, targetId: 2, type: 'recovery_email' }],
    breaches: [],
  };
  const out = analyzeBreach(fp, { accountId: 1, dataClasses: ['email', 'passwords'], severity: 'high' });
  const ids = out.affected.map((a) => a.id).sort();
  assert.deepEqual(ids, [2, 3]);
  assert.equal(out.affected.find((a) => a.id === 3).channel, 'reuse');
  assert.ok(out.steps.length >= 3);
});

test('deleted accounts are excluded from the graph', () => {
  const fp = {
    accounts: [acc(1), acc(2, { status: 'deleted' })],
    links: [{ id: 1, sourceId: 2, targetId: 1, type: 'sso' }],
    breaches: [],
  };
  const r = computeRisk(fp);
  assert.equal(r.nodes.length, 1);
  assert.equal(r.edges.length, 0);
});
