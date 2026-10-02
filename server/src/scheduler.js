// Background jobs: periodic review prompts and simulated breach notifications.

import { analyze, notify, reportBreach } from './services.js';
import { simulatedBreachFor } from './breachCatalog.js';
import { daysSince } from './engine/risk.js';
import { WEIGHTS } from './engine/constants.js';

export function reviewSummary(db, userId) {
  const { risk, fp, fixes } = analyze(db, userId);
  const active = fp.accounts.filter((a) => a.status === 'active');
  const staleApps = active.filter((a) => a.kind === 'app' && (daysSince(a.lastActive, new Date()) ?? 0) > WEIGHTS.unusedDays);
  const dormant = active.filter((a) => a.kind === 'account' && (daysSince(a.lastActive, new Date()) ?? 0) > WEIGHTS.dormantDays);
  const open = fp.breaches.filter((b) => b.status === 'open');
  const parts = [`Your privacy score is ${risk.overall.score}/100.`];
  if (open.length) parts.push(`${open.length} breach${open.length > 1 ? 'es' : ''} still need action.`);
  if (staleApps.length) parts.push(`${staleApps.length} app${staleApps.length > 1 ? 's' : ''} haven't been used in 6+ months but still have access.`);
  if (dormant.length) parts.push(`${dormant.length} account${dormant.length > 1 ? 's look' : ' looks'} abandoned.`);
  if (fixes[0]) parts.push(`Top fix: ${fixes[0].title} (+${fixes[0].gain} pts).`);
  return parts.join(' ');
}

export function runScheduledJobs(db, now = new Date()) {
  const users = db.prepare('SELECT id, created_at, review_interval_days, last_review_at, breach_sim_minutes, last_sim_at FROM users').all();
  for (const u of users) {
    try {
      // 1. Periodic review prompt.
      const since = daysSince(u.last_review_at || u.created_at, now);
      if (u.review_interval_days > 0 && since !== null && since >= u.review_interval_days) {
        const recent = db
          .prepare("SELECT created_at FROM notifications WHERE user_id = ? AND type = 'reminder' ORDER BY id DESC LIMIT 1")
          .get(u.id);
        const lastPrompt = recent ? daysSince(recent.created_at, now) : null;
        if (lastPrompt === null || lastPrompt >= Math.max(1, Math.floor(u.review_interval_days / 2))) {
          notify(db, u.id, {
            type: 'reminder',
            title: 'Time for your privacy review',
            body: reviewSummary(db, u.id),
            data: { action: 'review' },
          });
        }
      }

      // 2. Simulated breach feed.
      if (u.breach_sim_minutes > 0) {
        const last = u.last_sim_at ? new Date(`${u.last_sim_at.replace(' ', 'T')}Z`).getTime() : 0;
        if (now.getTime() - last >= u.breach_sim_minutes * 60_000) {
          const candidates = db
            .prepare("SELECT id, name, kind, data_shared FROM accounts WHERE user_id = ? AND status = 'active' AND kind != 'phone'")
            .all(u.id);
          if (candidates.length) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            const account = { id: pick.id, name: pick.name, kind: pick.kind, dataShared: JSON.parse(pick.data_shared || '[]') };
            reportBreach(db, u.id, simulatedBreachFor(account));
          }
          db.prepare("UPDATE users SET last_sim_at = datetime('now') WHERE id = ?").run(u.id);
        }
      }
    } catch (e) {
      console.error(`[scheduler] user ${u.id}:`, e);
    }
  }
}

export function startScheduler(db, intervalMs = Number(process.env.SCHEDULER_TICK_MS) || 60_000) {
  const timer = setInterval(() => runScheduledJobs(db), intervalMs);
  timer.unref();
  setTimeout(() => runScheduledJobs(db), 5_000).unref();
  return () => clearInterval(timer);
}
