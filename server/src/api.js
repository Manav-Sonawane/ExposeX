import express from 'express';
import { z } from 'zod';
import { hashPassword, verifyPassword, signToken, requireAuth } from './auth.js';
import {
  SERVICE_TYPES,
  TWOFA,
  STRONG_2FA,
  SIGN_IN_METHODS,
  LINK_TYPES,
  PERMISSIONS,
  DATA_CLASSES,
  WEIGHTS,
  RISK_LEVELS,
} from './engine/constants.js';
import { daysSince } from './engine/risk.js';
import { analyzeBreach } from './engine/breach.js';
import * as repo from './repo.js';
import { analyze, changed, notify, reportBreach, subscribe } from './services.js';
import { BREACH_CATALOG, matchBreaches, simulatedBreachFor } from './breachCatalog.js';
import { seedSampleFootprint } from './seed.js';
import { reviewSummary } from './scheduler.js';
import { tx } from './db.js';

// ---------- validation ----------

const enumOf = (obj) => z.enum(Object.keys(obj));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD').nullable().optional();

const accountSchema = z.object({
  kind: z.enum(['account', 'phone', 'app']).default('account'),
  name: z.string().trim().min(1).max(120),
  serviceType: enumOf(SERVICE_TYPES).default('other'),
  domain: z.string().trim().max(200).nullable().optional(),
  identifier: z.string().trim().max(200).nullable().optional(),
  importance: z.coerce.number().int().min(1).max(5).default(3),
  twofa: enumOf(TWOFA).default('none'),
  signInMethods: z.array(enumOf(SIGN_IN_METHODS)).default(['password']),
  passwordGroupId: z.coerce.number().int().positive().nullable().optional(),
  permissions: z.array(enumOf(PERMISSIONS)).default([]),
  dataShared: z.array(enumOf(DATA_CLASSES)).default([]),
  carrierPin: z.boolean().default(false),
  lastActive: dateStr,
  memberSince: dateStr,
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['active', 'deleted']).optional(),
});
const accountPatch = accountSchema.partial().strict();

const linkSchema = z.object({
  sourceId: z.coerce.number().int().positive(),
  targetId: z.coerce.number().int().positive(),
  type: enumOf(LINK_TYPES),
});

const breachSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  breachDate: dateStr,
  dataClasses: z.array(enumOf(DATA_CLASSES)).default(['email']),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

const credentials = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

function parse(schema, body) {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw Object.assign(new Error(msg), { status: 400 });
  }
  return r.data;
}

const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return n;
};

const notFound = (what = 'Not found') => Object.assign(new Error(what), { status: 404 });

// ---------- helpers ----------

function activityBucket(days) {
  if (days === null) return 'unknown';
  if (days <= 30) return 'active30';
  if (days <= 90) return 'active90';
  if (days <= WEIGHTS.dormantDays) return 'stale';
  return 'dormant';
}

/** Merge stored account data with its computed risk node. */
function enrich(account, node, groups) {
  const days = daysSince(account.lastActive, new Date());
  const group = account.passwordGroupId ? groups.find((g) => g.id === account.passwordGroupId) : null;
  return {
    ...account,
    risk: node?.risk ?? 0,
    level: node?.level ?? 'low',
    P: node?.P ?? 0,
    p: node?.p ?? 0,
    inherited: node?.inherited ?? 0,
    impact: node?.impact ?? 0,
    spof: node?.spof ?? false,
    blastCount: node?.blast?.count ?? 0,
    inactiveDays: days,
    activity: activityBucket(days),
    passwordGroup: group ? { id: group.id, label: group.label, size: group.size } : null,
    reused: !!group && group.size > 1,
  };
}

function userSettings(db, userId) {
  const u = db
    .prepare('SELECT id, email, name, review_interval_days, breach_sim_minutes, last_review_at, created_at FROM users WHERE id = ?')
    .get(userId);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    reviewIntervalDays: u.review_interval_days,
    breachSimMinutes: u.breach_sim_minutes,
    lastReviewAt: u.last_review_at,
    createdAt: u.created_at,
  };
}

function createUser(db, { email, name, password }) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) throw Object.assign(new Error('An account with this email already exists'), { status: 409 });
  const r = db
    .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
    .run(email, name, hashPassword(password));
  return Number(r.lastInsertRowid);
}

/** Fixed-window in-memory limiter for credential endpoints. */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) hits.set(key, { start: now, count: 1 });
    else if (++entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.start + windowMs - now) / 1000));
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    next();
  };
}

// ---------- router ----------

export function apiRouter(db, secret) {
  const r = express.Router();
  const auth = requireAuth(db, secret);
  const wrap = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      next(e);
    }
  };

  r.get('/health', (_req, res) => res.json({ ok: true }));
  const limiter = process.env.NODE_ENV === 'test' ? (_q, _s, n) => n() : rateLimit({ windowMs: 10 * 60_000, max: 30 });
  r.use(['/auth/login', '/auth/register', '/auth/demo'], limiter);

  r.get(
    '/meta',
    wrap(() => ({
      serviceTypes: SERVICE_TYPES,
      twofa: TWOFA,
      strong2fa: STRONG_2FA,
      signInMethods: SIGN_IN_METHODS,
      linkTypes: LINK_TYPES,
      permissions: PERMISSIONS,
      dataClasses: DATA_CLASSES,
      riskLevels: RISK_LEVELS,
      thresholds: { unusedDays: WEIGHTS.unusedDays, dormantDays: WEIGHTS.dormantDays },
    })),
  );

  // ----- auth -----
  r.post(
    '/auth/register',
    wrap((req) => {
      const body = parse(credentials.extend({ name: z.string().trim().min(1).max(80), sample: z.boolean().default(false) }), req.body);
      const uid = createUser(db, body);
      if (body.sample) seedSampleFootprint(db, uid);
      else {
        repo.recordSnapshot(db, uid, 'Account created');
        repo.insertNotification(db, uid, {
          type: 'system',
          title: 'Welcome to ExposeX',
          body: 'Start by adding your main email account and phone number. Everything else connects to those.',
        });
      }
      return { token: signToken(secret, uid), user: userSettings(db, uid) };
    }),
  );

  r.post(
    '/auth/login',
    wrap((req) => {
      const body = parse(credentials.extend({ password: z.string().min(1).max(200) }), req.body);
      const u = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(body.email);
      if (!u || !verifyPassword(body.password, u.password_hash))
        throw Object.assign(new Error('Incorrect email or password'), { status: 401 });
      return { token: signToken(secret, u.id), user: userSettings(db, u.id) };
    }),
  );

  r.post(
    '/auth/demo',
    wrap(() => {
      const tag = Math.random().toString(36).slice(2, 8);
      const uid = createUser(db, { email: `demo-${tag}@exposex.local`, name: 'Alex Morgan (demo)', password: `demo-${tag}-${Date.now()}` });
      seedSampleFootprint(db, uid);
      return { token: signToken(secret, uid), user: userSettings(db, uid) };
    }),
  );

  r.use(auth);

  // ----- me / settings -----
  r.get('/me', wrap((req) => userSettings(db, req.user.id)));

  r.patch(
    '/me',
    wrap((req) => {
      const body = parse(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            reviewIntervalDays: z.coerce.number().int().min(0).max(365),
            breachSimMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30),
          })
          .partial(),
        req.body,
      );
      if (body.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, req.user.id);
      if (body.reviewIntervalDays !== undefined)
        db.prepare('UPDATE users SET review_interval_days = ? WHERE id = ?').run(body.reviewIntervalDays, req.user.id);
      if (body.breachSimMinutes !== undefined)
        db.prepare("UPDATE users SET breach_sim_minutes = ?, last_sim_at = datetime('now') WHERE id = ?").run(body.breachSimMinutes, req.user.id);
      return userSettings(db, req.user.id);
    }),
  );

  r.post(
    '/me/review',
    wrap((req) => {
      db.prepare("UPDATE users SET last_review_at = datetime('now') WHERE id = ?").run(req.user.id);
      db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND type = 'reminder'").run(req.user.id);
      repo.recordSnapshot(db, req.user.id, 'Completed privacy review');
      return userSettings(db, req.user.id);
    }),
  );

  r.get('/me/review-summary', wrap((req) => ({ summary: reviewSummary(db, req.user.id) })));

  r.delete(
    '/me',
    wrap((req) => {
      db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
      return { ok: true };
    }),
  );

  // ----- accounts -----
  r.get(
    '/accounts',
    wrap((req) => {
      const { fp, risk } = analyze(db, req.user.id);
      const nodes = new Map(risk.nodes.map((n) => [n.id, n]));
      const q = String(req.query.q || '').trim().toLowerCase();
      const list = (k) => (req.query[k] ? String(req.query[k]).split(',').filter(Boolean) : []);
      const kinds = list('kind');
      const levels = list('risk');
      const types = list('type');
      const data = list('data');
      const twofa = list('twofa');
      const activity = list('activity');
      const status = req.query.status === 'deleted' ? 'deleted' : req.query.status === 'all' ? null : 'active';

      let rows = fp.accounts
        .filter((a) => !status || a.status === status)
        .map((a) => enrich(a, nodes.get(a.id), fp.groups));

      if (q)
        rows = rows.filter((a) =>
          [a.name, a.domain, a.identifier, a.notes, SERVICE_TYPES[a.serviceType]?.label].some((v) => v && v.toLowerCase().includes(q)),
        );
      if (kinds.length) rows = rows.filter((a) => kinds.includes(a.kind));
      if (levels.length) rows = rows.filter((a) => levels.includes(a.level));
      if (types.length) rows = rows.filter((a) => types.includes(a.serviceType));
      if (data.length) rows = rows.filter((a) => data.some((d) => a.dataShared.includes(d) || a.permissions.includes(d)));
      if (twofa.length)
        rows = rows.filter((a) =>
          twofa.some((t) =>
            t === 'strong' ? STRONG_2FA.includes(a.twofa) : t === 'weak' ? !STRONG_2FA.includes(a.twofa) : a.twofa === t,
          ),
        );
      if (activity.length) rows = rows.filter((a) => activity.includes(a.activity));
      if (req.query.reused === 'true') rows = rows.filter((a) => a.reused);
      if (req.query.spof === 'true') rows = rows.filter((a) => a.spof);

      const sort = String(req.query.sort || 'risk');
      const dir = req.query.dir === 'asc' ? 1 : -1;
      const cmp = {
        risk: (a, b) => a.risk - b.risk,
        name: (a, b) => b.name.localeCompare(a.name),
        lastActive: (a, b) => (b.inactiveDays ?? 1e9) - (a.inactiveDays ?? 1e9),
        blast: (a, b) => a.blastCount - b.blastCount,
        importance: (a, b) => a.importance - b.importance,
      }[sort] ?? ((a, b) => a.risk - b.risk);
      rows.sort((a, b) => dir * cmp(a, b));
      return { total: rows.length, accounts: rows };
    }),
  );

  r.get(
    '/accounts/:id',
    wrap((req) => {
      const accId = id(req);
      const { fp, risk, fixes } = analyze(db, req.user.id);
      const account = fp.accounts.find((a) => a.id === accId);
      if (!account) throw notFound('Account not found');
      const node = risk.nodes.find((n) => n.id === accId);
      const name = (i) => fp.accounts.find((a) => a.id === i)?.name ?? `#${i}`;
      const links = fp.links.filter((l) => l.sourceId === accId || l.targetId === accId).map((l) => ({
        ...l,
        sourceName: name(l.sourceId),
        targetName: name(l.targetId),
        direction: l.sourceId === accId ? 'out' : 'in',
        t: risk.edges.find((e) => e.id === l.id)?.t ?? null,
      }));
      const siblings = account.passwordGroupId
        ? fp.accounts.filter((a) => a.id !== accId && a.status === 'active' && a.passwordGroupId === account.passwordGroupId).map((a) => ({ id: a.id, name: a.name }))
        : [];
      return {
        account: enrich(account, node, fp.groups),
        node: node
          ? {
              ...node,
              inbound: node.inbound.map((i) => ({ ...i, fromName: name(i.fromId) })),
              blast: node.blast && {
                ...node.blast,
                dependents: node.blast.dependents.map((d) => ({
                  ...d,
                  name: name(d.id),
                  path: d.path.map((s) => ({ ...s, fromName: name(s.from), toName: name(s.to) })),
                })),
              },
            }
          : null,
        links,
        siblings,
        breaches: fp.breaches.filter((b) => b.accountId === accId),
        fixes: fixes.filter((f) => f.accountId === accId),
      };
    }),
  );

  r.post(
    '/accounts',
    wrap((req, res) => {
      const body = parse(accountSchema, req.body);
      const created = repo.createAccount(db, req.user.id, body);
      changed(db, req.user.id, `Added ${created.name}`);
      res.status(201);
      return created;
    }),
  );

  r.patch(
    '/accounts/:id',
    wrap((req) => {
      const body = parse(accountPatch, req.body);
      const before = repo.getAccount(db, req.user.id, id(req));
      if (!before) throw notFound('Account not found');
      const updated = repo.updateAccount(db, req.user.id, before.id, body);
      changed(db, req.user.id, `Updated ${updated.name}`);
      return updated;
    }),
  );

  r.delete(
    '/accounts/:id',
    wrap((req) => {
      const acc = repo.getAccount(db, req.user.id, id(req));
      if (!acc) throw notFound('Account not found');
      repo.deleteAccount(db, req.user.id, acc.id);
      changed(db, req.user.id, `Removed ${acc.name}`);
      return { ok: true };
    }),
  );

  // ----- password reuse groups -----
  r.get('/groups', wrap((req) => repo.listGroups(db, req.user.id)));
  r.post(
    '/groups',
    wrap((req, res) => {
      const { label } = parse(z.object({ label: z.string().trim().min(1).max(80) }), req.body);
      res.status(201);
      return repo.createGroup(db, req.user.id, label);
    }),
  );
  r.patch(
    '/groups/:id',
    wrap((req) => {
      const { label } = parse(z.object({ label: z.string().trim().min(1).max(80) }), req.body);
      if (!repo.renameGroup(db, req.user.id, id(req), label)) throw notFound();
      return { ok: true };
    }),
  );
  r.delete(
    '/groups/:id',
    wrap((req) => {
      if (!repo.deleteGroup(db, req.user.id, id(req))) throw notFound();
      changed(db, req.user.id, 'Removed a password group');
      return { ok: true };
    }),
  );

  // ----- links -----
  r.get('/links', wrap((req) => repo.loadFootprint(db, req.user.id).links));
  r.post(
    '/links',
    wrap((req, res) => {
      const body = parse(linkSchema, req.body);
      const link = repo.createLink(db, req.user.id, body);
      changed(db, req.user.id, 'Added a connection');
      res.status(201);
      return link;
    }),
  );
  r.delete(
    '/links/:id',
    wrap((req) => {
      if (!repo.deleteLink(db, req.user.id, id(req))) throw notFound();
      changed(db, req.user.id, 'Removed a connection');
      return { ok: true };
    }),
  );

  // ----- analysis -----
  r.get(
    '/dashboard',
    wrap((req) => {
      const uid = req.user.id;
      const { fp, risk, fixes } = analyze(db, uid);
      const name = (i) => fp.accounts.find((a) => a.id === i)?.name ?? `#${i}`;
      const nodes = new Map(risk.nodes.map((n) => [n.id, n]));
      const riskiest = [...risk.nodes].sort((a, b) => b.risk - a.risk).slice(0, 6).map((n) => {
        const top = [...n.factors].sort((x, y) => y.value - x.value)[0];
        const inherited = n.inherited > n.p ? n.inbound[0] : null;
        return {
          id: n.id,
          name: n.name,
          kind: n.kind,
          serviceType: n.serviceType,
          risk: n.risk,
          level: n.level,
          P: n.P,
          reason: inherited ? `Inherits risk from ${name(inherited.fromId)}` : top?.label ?? '',
        };
      });
      const spofs = risk.spofs.map((sid) => {
        const n = nodes.get(sid);
        return {
          id: n.id,
          name: n.name,
          kind: n.kind,
          serviceType: n.serviceType,
          risk: n.risk,
          level: n.level,
          P: n.P,
          twofa: n.twofa,
          count: n.blast.count,
          impact: n.blast.impact,
          dependents: n.blast.dependents.filter((d) => d.prob >= WEIGHTS.structuralThreshold).slice(0, 12).map((d) => ({ id: d.id, name: name(d.id), prob: d.prob })),
        };
      });
      const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(uid).n;
      const levelCounts = risk.overall.counts;
      const byType = {};
      for (const n of risk.nodes) {
        const t = n.serviceType;
        byType[t] ??= { type: t, count: 0, avgRisk: 0 };
        byType[t].count++;
        byType[t].avgRisk += n.risk;
      }
      for (const v of Object.values(byType)) v.avgRisk = Math.round(v.avgRisk / v.count);
      return {
        overall: risk.overall,
        levelCounts,
        riskiest,
        spofs,
        topFixes: fixes.slice(0, 5),
        fixCount: fixes.length,
        potentialScore: Math.min(100, Math.round(risk.overall.scoreExact + fixes.slice(0, 5).reduce((s, f) => s + f.gain, 0))),
        history: repo.listSnapshots(db, uid),
        recentActions: repo.listActions(db, uid, 8),
        openBreaches: fp.breaches.filter((b) => b.status === 'open').length,
        unread,
        byType: Object.values(byType).sort((a, b) => b.avgRisk - a.avgRisk),
        user: userSettings(db, uid),
      };
    }),
  );

  r.get(
    '/graph',
    wrap((req) => {
      const { fp, risk } = analyze(db, req.user.id);
      const accounts = new Map(fp.accounts.map((a) => [a.id, a]));
      return {
        nodes: risk.nodes.map((n) => {
          const a = accounts.get(n.id);
          return {
            id: n.id,
            name: n.name,
            kind: n.kind,
            serviceType: n.serviceType,
            twofa: a.twofa,
            importance: a.importance,
            passwordGroupId: a.passwordGroupId,
            risk: n.risk,
            level: n.level,
            p: n.p,
            P: n.P,
            inherited: n.inherited,
            spof: n.spof,
            blastCount: n.blast?.count ?? 0,
            dependents: (n.blast?.dependents || []).map((d) => ({ id: d.id, prob: d.prob, path: d.path })),
          };
        }),
        edges: risk.edges,
        groups: fp.groups,
        overall: risk.overall,
      };
    }),
  );

  // ----- fixes -----
  r.get(
    '/fixes',
    wrap((req) => {
      const { fixes, risk } = analyze(db, req.user.id);
      return {
        fixes: fixes.map(({ mutation, ...f }) => ({ ...f, op: mutation.op })),
        score: risk.overall.score,
        scoreExact: risk.overall.scoreExact,
        completed: repo.listActions(db, req.user.id, 100),
        dismissed: db.prepare('SELECT fix_key AS key, title FROM dismissed_fixes WHERE user_id = ?').all(req.user.id).map((r) => ({ ...r })),
      };
    }),
  );

  r.post(
    '/fixes/complete',
    wrap((req) => {
      const { key } = parse(z.object({ key: z.string().min(1) }), req.body);
      const uid = req.user.id;
      const { fixes, risk } = analyze(db, uid);
      const fix = fixes.find((f) => f.key === key);
      if (!fix) throw notFound('That fix is no longer applicable');
      repo.applyMutationDb(db, uid, fix.mutation);
      const after = repo.recordSnapshot(db, uid, `Fixed: ${fix.title}`);
      repo.logAction(db, uid, { ...fix, scoreBefore: risk.overall.score, scoreAfter: after.score });
      changed(db, uid);
      return { ok: true, scoreBefore: risk.overall.score, scoreAfter: after.score, fix: { key: fix.key, title: fix.title } };
    }),
  );

  r.post(
    '/fixes/dismiss',
    wrap((req) => {
      const { key, title } = parse(z.object({ key: z.string().min(1), title: z.string().max(300).optional() }), req.body);
      db.prepare('INSERT OR IGNORE INTO dismissed_fixes (user_id, fix_key, title) VALUES (?, ?, ?)').run(req.user.id, key, title ?? null);
      changed(db, req.user.id);
      return { ok: true };
    }),
  );

  r.post(
    '/fixes/restore',
    wrap((req) => {
      const { key } = parse(z.object({ key: z.string().min(1) }), req.body);
      db.prepare('DELETE FROM dismissed_fixes WHERE user_id = ? AND fix_key = ?').run(req.user.id, key);
      changed(db, req.user.id);
      return { ok: true };
    }),
  );

  // ----- breaches -----
  r.get(
    '/breaches',
    wrap((req) => {
      const fp = repo.loadFootprint(db, req.user.id);
      const name = (i) => fp.accounts.find((a) => a.id === i)?.name ?? `#${i}`;
      return repo.listBreaches(db, req.user.id).map((b) => ({ ...b, accountName: name(b.accountId) }));
    }),
  );

  r.get('/breaches/catalog', wrap(() => BREACH_CATALOG));

  r.get(
    '/breaches/:id/analysis',
    wrap((req) => {
      const { fp, risk } = analyze(db, req.user.id);
      const breach = fp.breaches.find((b) => b.id === id(req));
      if (!breach) throw notFound('Breach not found');
      return { breach, analysis: analyzeBreach(fp, breach, { risk }) };
    }),
  );

  r.post(
    '/breaches',
    wrap((req, res) => {
      const body = parse(breachSchema, req.body);
      if (!repo.getAccount(db, req.user.id, body.accountId)) throw notFound('Account not found');
      res.status(201);
      return reportBreach(db, req.user.id, { ...body, source: 'manual', status: 'open' });
    }),
  );

  r.post(
    '/breaches/simulate',
    wrap((req, res) => {
      const { accountId } = parse(z.object({ accountId: z.coerce.number().int().positive().optional() }), req.body);
      const fp = repo.loadFootprint(db, req.user.id);
      const pool = fp.accounts.filter((a) => a.status === 'active' && a.kind !== 'phone');
      const target = accountId ? pool.find((a) => a.id === accountId) : pool[Math.floor(Math.random() * pool.length)];
      if (!target) throw notFound('No account to simulate a breach on');
      res.status(201);
      return reportBreach(db, req.user.id, simulatedBreachFor(target));
    }),
  );

  r.post(
    '/breaches/scan',
    wrap((req) => {
      const uid = req.user.id;
      const fp = repo.loadFootprint(db, uid);
      const found = [];
      for (const a of fp.accounts.filter((x) => x.status === 'active')) {
        for (const c of matchBreaches(a)) {
          const exists = fp.breaches.some((b) => b.accountId === a.id && b.title === c.title);
          if (exists) continue;
          const res = reportBreach(db, uid, {
            accountId: a.id,
            title: c.title,
            breachDate: c.date,
            dataClasses: c.dataClasses,
            severity: c.severity,
            source: 'catalog',
            status: 'open',
          });
          found.push({ ...res.breach, accountName: a.name });
        }
      }
      return { scanned: fp.accounts.length, found };
    }),
  );

  r.post(
    '/breaches/:id/resolve',
    wrap((req) => {
      const uid = req.user.id;
      const bid = id(req);
      const b = repo.listBreaches(db, uid).find((x) => x.id === bid);
      if (!b) throw notFound('Breach not found');
      // Resolving means the password was changed, which also breaks reuse.
      repo.applyMutationDb(db, uid, { op: 'resolve_breach', breachId: bid, accountId: b.accountId });
      changed(db, uid, `Resolved breach: ${b.title}`);
      return { ok: true };
    }),
  );

  // ----- notifications -----
  r.get(
    '/notifications',
    wrap((req) => ({
      notifications: repo.listNotifications(db, req.user.id, { unreadOnly: req.query.unread === 'true' }),
      unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).n,
    })),
  );
  r.post(
    '/notifications/:id/read',
    wrap((req) => {
      db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id(req), req.user.id);
      return { ok: true };
    }),
  );
  r.post(
    '/notifications/read-all',
    wrap((req) => {
      db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
      return { ok: true };
    }),
  );
  r.post(
    '/notifications/test-reminder',
    wrap((req) =>
      notify(db, req.user.id, { type: 'reminder', title: 'Time for your privacy review', body: reviewSummary(db, req.user.id), data: { action: 'review' } }),
    ),
  );

  r.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: {}\n\n`);
    const off = subscribe(req.user.id, res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      off();
    });
  });

  // ----- data portability -----
  r.get(
    '/export',
    wrap((req, res) => {
      const fp = repo.loadFootprint(db, req.user.id);
      res.setHeader('Content-Disposition', 'attachment; filename="exposex-footprint.json"');
      return {
        format: 'exposex/v1',
        exportedAt: new Date().toISOString(),
        groups: fp.groups.map((g) => ({ id: g.id, label: g.label })),
        accounts: fp.accounts.map(({ createdAt, updatedAt, ...a }) => a),
        links: fp.links.map(({ createdAt, ...l }) => l),
        breaches: fp.breaches.map(({ createdAt, ...b }) => b),
      };
    }),
  );

  r.post(
    '/import',
    wrap((req) => {
      const body = req.body || {};
      if (body.format !== 'exposex/v1') throw Object.assign(new Error('Unsupported file. Expected an ExposeX export.'), { status: 400 });
      const uid = req.user.id;
      const accounts = (body.accounts || []).map((a) => ({ old: a.id, data: parse(accountSchema, { ...a, passwordGroupId: a.passwordGroupId ?? null }) }));
      tx(db, () => {
        for (const t of ['links', 'breaches', 'accounts', 'password_groups', 'dismissed_fixes']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(uid);
        const gmap = new Map();
        for (const g of body.groups || []) gmap.set(g.id, repo.createGroup(db, uid, String(g.label || 'Group')).id);
        const amap = new Map();
        for (const { old, data } of accounts)
          amap.set(old, repo.createAccount(db, uid, { ...data, passwordGroupId: data.passwordGroupId ? gmap.get(data.passwordGroupId) ?? null : null }).id);
        for (const l of body.links || []) {
          const s = amap.get(l.sourceId);
          const t = amap.get(l.targetId);
          if (s && t && LINK_TYPES[l.type]) repo.createLink(db, uid, { sourceId: s, targetId: t, type: l.type });
        }
        for (const b of body.breaches || []) {
          const a = amap.get(b.accountId);
          if (a) repo.createBreach(db, uid, { ...b, accountId: a });
        }
      });
      changed(db, uid, 'Imported footprint');
      return { ok: true, accounts: accounts.length };
    }),
  );

  r.post(
    '/reset-sample',
    wrap((req) => {
      const out = seedSampleFootprint(db, req.user.id);
      changed(db, req.user.id);
      return { ok: true, ...out };
    }),
  );

  r.post(
    '/clear',
    wrap((req) => {
      repo.wipeFootprint(db, req.user.id);
      changed(db, req.user.id, 'Cleared footprint');
      return { ok: true };
    }),
  );

  return r;
}
