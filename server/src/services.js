// Application services shared by routes and the scheduler:
// cached analysis, notifications with live push, and breach reporting.

import { computeRisk } from './engine/risk.js';
import { generateFixes } from './engine/fixes.js';
import { analyzeBreach } from './engine/breach.js';
import {
  loadFootprint,
  dismissedFixes,
  insertNotification,
  createBreach,
  recordSnapshot,
  getAccount,
} from './repo.js';

// ---------- live events (Server-Sent Events) ----------

const streams = new Map(); // userId -> Set<res>

export function subscribe(userId, res) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId).add(res);
  return () => {
    streams.get(userId)?.delete(res);
    if (!streams.get(userId)?.size) streams.delete(userId);
  };
}

export function emit(userId, event, data) {
  for (const res of streams.get(userId) || []) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

export function notify(db, userId, n) {
  const created = insertNotification(db, userId, n);
  emit(userId, 'notification', created);
  return created;
}

// ---------- cached analysis ----------

const cache = new Map(); // userId -> { key, risk, fixes }

function fingerprint(fp, dismissed) {
  return JSON.stringify([fp.accounts, fp.links, fp.breaches, [...dismissed].sort(), new Date().toISOString().slice(0, 10)]);
}

/** Full analysis for a user, recomputed only when their footprint changes. */
export function analyze(db, userId) {
  const fp = loadFootprint(db, userId);
  const dismissed = dismissedFixes(db, userId);
  const key = fingerprint(fp, dismissed);
  const hit = cache.get(userId);
  if (hit && hit.key === key) return hit.result;
  const risk = computeRisk(fp);
  const result = { fp, risk, dismissed, _fixes: null };
  // Fixes are the expensive part; compute lazily.
  Object.defineProperty(result, 'fixes', {
    get() {
      if (!this._fixes) this._fixes = generateFixes(fp, { dismissed });
      return this._fixes;
    },
  });
  cache.set(userId, { key, result });
  return result;
}

/** Call after any write so dashboards update live. */
export function changed(db, userId, reason) {
  if (reason) recordSnapshot(db, userId, reason);
  emit(userId, 'footprint', { reason: reason ?? null });
}

// ---------- breaches ----------

/** Store a breach, analyze its blast radius and push an alert. */
export function reportBreach(db, userId, breach) {
  const created = createBreach(db, userId, breach);
  const { fp, risk } = analyze(db, userId);
  const analysis = analyzeBreach(fp, created, { risk });
  const account = getAccount(db, userId, created.accountId);
  const linked = analysis?.affected.filter((a) => a.prob >= 0.3).length ?? 0;
  notify(db, userId, {
    type: 'breach',
    title: `${created.source === 'simulated' ? 'Simulated breach' : 'Breach'} at ${account?.name ?? 'a service'}`,
    body: `${created.title}. ${analysis?.exposedData.join(', ') || 'Data'} exposed. ${linked} linked account${linked === 1 ? '' : 's'} could be affected.`,
    data: { breachId: created.id, accountId: created.accountId, affected: linked },
  });
  recordSnapshot(db, userId, `Breach reported: ${created.title}`);
  emit(userId, 'footprint', { reason: 'breach' });
  return { breach: created, analysis };
}
