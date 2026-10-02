// Data access. Converts between DB rows (snake_case, JSON text) and the
// engine's plain objects (camelCase, arrays).

import { tx } from './db.js';
import { computeRisk } from './engine/risk.js';

const json = (s, fallback = []) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

export function rowToAccount(r) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    serviceType: r.service_type,
    domain: r.domain,
    identifier: r.identifier,
    importance: r.importance,
    twofa: r.twofa,
    signInMethods: json(r.sign_in_methods),
    passwordGroupId: r.password_group_id,
    permissions: json(r.permissions),
    dataShared: json(r.data_shared),
    carrierPin: !!r.carrier_pin,
    lastActive: r.last_active,
    memberSince: r.member_since,
    notes: r.notes,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const rowToLink = (r) => ({ id: r.id, sourceId: r.source_id, targetId: r.target_id, type: r.type, createdAt: r.created_at });

export const rowToBreach = (r) => ({
  id: r.id,
  accountId: r.account_id,
  title: r.title,
  breachDate: r.breach_date,
  dataClasses: json(r.data_classes),
  severity: r.severity,
  source: r.source,
  status: r.status,
  resolvedAt: r.resolved_at,
  createdAt: r.created_at,
});

export const rowToNotification = (r) => ({
  id: r.id,
  type: r.type,
  title: r.title,
  body: r.body,
  data: json(r.data, null),
  read: !!r.read,
  createdAt: r.created_at,
});

export function loadFootprint(db, userId) {
  return {
    accounts: db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY id').all(userId).map(rowToAccount),
    links: db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY id').all(userId).map(rowToLink),
    breaches: db.prepare('SELECT * FROM breaches WHERE user_id = ? ORDER BY id').all(userId).map(rowToBreach),
    groups: listGroups(db, userId),
  };
}

// ---------- accounts ----------

const ACCOUNT_COLUMNS = {
  kind: 'kind',
  name: 'name',
  serviceType: 'service_type',
  domain: 'domain',
  identifier: 'identifier',
  importance: 'importance',
  twofa: 'twofa',
  signInMethods: 'sign_in_methods',
  passwordGroupId: 'password_group_id',
  permissions: 'permissions',
  dataShared: 'data_shared',
  carrierPin: 'carrier_pin',
  lastActive: 'last_active',
  memberSince: 'member_since',
  notes: 'notes',
  status: 'status',
};

function toDbValue(key, v) {
  if (v === undefined) return undefined;
  if (['signInMethods', 'permissions', 'dataShared'].includes(key)) return JSON.stringify(v ?? []);
  if (key === 'carrierPin') return v ? 1 : 0;
  return v ?? null;
}

export function getAccount(db, userId, id) {
  const r = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(id, userId);
  return r ? rowToAccount(r) : null;
}

export function createAccount(db, userId, data) {
  const cols = ['user_id'];
  const vals = [userId];
  for (const [k, col] of Object.entries(ACCOUNT_COLUMNS)) {
    const v = toDbValue(k, data[k]);
    if (v !== undefined) {
      cols.push(col);
      vals.push(v);
    }
  }
  const r = db
    .prepare(`INSERT INTO accounts (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...vals);
  return getAccount(db, userId, Number(r.lastInsertRowid));
}

export function updateAccount(db, userId, id, data) {
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(ACCOUNT_COLUMNS)) {
    const v = toDbValue(k, data[k]);
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(v);
    }
  }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, userId);
  }
  return getAccount(db, userId, id);
}

export function deleteAccount(db, userId, id) {
  return db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

// ---------- password groups ----------

export function listGroups(db, userId) {
  return db
    .prepare(
      `SELECT g.id, g.label, g.created_at AS createdAt,
        (SELECT COUNT(*) FROM accounts a WHERE a.password_group_id = g.id AND a.status = 'active') AS size
       FROM password_groups g WHERE g.user_id = ? ORDER BY g.id`,
    )
    .all(userId)
    .map((g) => ({ ...g }));
}

export function createGroup(db, userId, label) {
  const r = db.prepare('INSERT INTO password_groups (user_id, label) VALUES (?, ?)').run(userId, label);
  return { id: Number(r.lastInsertRowid), label, size: 0 };
}

export function renameGroup(db, userId, id, label) {
  return db.prepare('UPDATE password_groups SET label = ? WHERE id = ? AND user_id = ?').run(label, id, userId).changes > 0;
}

export function deleteGroup(db, userId, id) {
  return db.prepare('DELETE FROM password_groups WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

// ---------- links ----------

export function createLink(db, userId, { sourceId, targetId, type }) {
  const owned = db
    .prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ? AND id IN (?, ?)')
    .get(userId, sourceId, targetId).n;
  if (owned !== 2 || sourceId === targetId) throw Object.assign(new Error('Invalid link endpoints'), { status: 400 });
  db.prepare('INSERT OR IGNORE INTO links (user_id, source_id, target_id, type) VALUES (?, ?, ?, ?)').run(userId, sourceId, targetId, type);
  return rowToLink(
    db.prepare('SELECT * FROM links WHERE source_id = ? AND target_id = ? AND type = ?').get(sourceId, targetId, type),
  );
}

export function deleteLink(db, userId, id) {
  return db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

// ---------- breaches ----------

export function createBreach(db, userId, b) {
  const r = db
    .prepare(
      `INSERT INTO breaches (user_id, account_id, title, breach_date, data_classes, severity, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, b.accountId, b.title, b.breachDate ?? null, JSON.stringify(b.dataClasses ?? []), b.severity ?? 'medium', b.source ?? 'manual', b.status ?? 'open');
  return rowToBreach(db.prepare('SELECT * FROM breaches WHERE id = ?').get(Number(r.lastInsertRowid)));
}

export function listBreaches(db, userId) {
  return db.prepare('SELECT * FROM breaches WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(userId).map(rowToBreach);
}

export function resolveBreach(db, userId, id) {
  return (
    db
      .prepare("UPDATE breaches SET status = 'resolved', resolved_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(id, userId).changes > 0
  );
}

// ---------- mutations from the fix engine ----------

/** Apply a fix-engine mutation to the database. Mirrors engine/fixes.applyMutation. */
export function applyMutationDb(db, userId, m) {
  return tx(db, () => {
    switch (m.op) {
      case 'set_twofa':
        updateAccount(db, userId, m.accountId, { twofa: m.value });
        break;
      case 'unique_password':
        db.prepare("UPDATE accounts SET password_group_id = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(m.accountId, userId);
        break;
      case 'resolve_breach':
        resolveBreach(db, userId, m.breachId);
        if (m.accountId)
          db.prepare("UPDATE accounts SET password_group_id = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(m.accountId, userId);
        break;
      case 'revoke_permission': {
        const a = getAccount(db, userId, m.accountId);
        if (a) updateAccount(db, userId, a.id, { permissions: a.permissions.filter((p) => p !== m.permission) });
        break;
      }
      case 'remove_node':
        updateAccount(db, userId, m.accountId, { status: 'deleted' });
        break;
      case 'set_carrier_pin':
        updateAccount(db, userId, m.accountId, { carrierPin: true });
        break;
      case 'remove_link':
        deleteLink(db, userId, m.linkId);
        break;
      default:
        throw Object.assign(new Error(`Unknown mutation ${m.op}`), { status: 400 });
    }
  });
}

// ---------- history ----------

export function recordSnapshot(db, userId, reason, at) {
  const risk = computeRisk(loadFootprint(db, userId), { blast: false });
  if (!at) {
    // Coalesce bursts of edits into one point on the history chart.
    const last = db
      .prepare("SELECT id FROM score_snapshots WHERE user_id = ? AND created_at >= datetime('now', '-2 minutes') ORDER BY id DESC LIMIT 1")
      .get(userId);
    if (last) {
      db.prepare('UPDATE score_snapshots SET score = ?, security_risk = ?, privacy_exposure = ?, reason = ? WHERE id = ?').run(
        risk.overall.score, risk.overall.securityRisk, risk.overall.privacyExposure, reason ?? null, last.id,
      );
      return risk.overall;
    }
  }
  db.prepare(
    `INSERT INTO score_snapshots (user_id, score, security_risk, privacy_exposure, reason, created_at)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(userId, risk.overall.score, risk.overall.securityRisk, risk.overall.privacyExposure, reason ?? null, at ?? null);
  return risk.overall;
}

export function listSnapshots(db, userId, limit = 200) {
  return db
    .prepare(
      `SELECT id, score, security_risk AS securityRisk, privacy_exposure AS privacyExposure, reason, created_at AS createdAt
       FROM score_snapshots WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`,
    )
    .all(userId, limit)
    .map((r) => ({ ...r }));
}

export function logAction(db, userId, a, at) {
  db.prepare(
    `INSERT INTO actions_log (user_id, fix_key, category, title, account_id, score_before, score_after, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(userId, a.key, a.category, a.title, a.accountId ?? null, a.scoreBefore, a.scoreAfter, at ?? null);
}

export function listActions(db, userId, limit = 100) {
  return db
    .prepare(
      `SELECT id, fix_key AS key, category, title, account_id AS accountId, score_before AS scoreBefore,
              score_after AS scoreAfter, created_at AS createdAt
       FROM actions_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, limit)
    .map((r) => ({ ...r }));
}

export function dismissedFixes(db, userId) {
  return new Set(db.prepare('SELECT fix_key FROM dismissed_fixes WHERE user_id = ?').all(userId).map((r) => r.fix_key));
}

// ---------- notifications ----------

export function insertNotification(db, userId, n) {
  const r = db
    .prepare('INSERT INTO notifications (user_id, type, title, body, data, created_at) VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime(\'now\')))')
    .run(userId, n.type, n.title, n.body ?? null, n.data ? JSON.stringify(n.data) : null, n.createdAt ?? null);
  return rowToNotification(db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(r.lastInsertRowid)));
}

export function listNotifications(db, userId, { unreadOnly = false, limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND read = 0' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, limit)
    .map(rowToNotification);
}

/** Remove everything a user owns except the user row itself. */
export function wipeFootprint(db, userId) {
  tx(db, () => {
    for (const t of ['links', 'breaches', 'accounts', 'password_groups', 'notifications', 'actions_log', 'dismissed_fixes', 'score_snapshots'])
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  });
}
