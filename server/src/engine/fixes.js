// Fix checklist generator.
//
// Every candidate action is expressed as a pure MUTATION of the footprint.
// We apply each mutation to a copy, recompute the whole-network risk, and rank
// actions by how much they actually move the overall score. Because the
// simulation runs over the full graph, fixing a single point of failure (e.g.
// 2FA on a recovery inbox) correctly outranks fixing a leaf account.

import { computeRisk, daysSince } from './risk.js';
import { PERMISSIONS, STRONG_2FA, TWOFA, WEIGHTS, LINK_TYPES } from './constants.js';

export function cloneFootprint(fp) {
  return {
    accounts: fp.accounts.map((a) => ({ ...a, permissions: [...(a.permissions || [])], signInMethods: [...(a.signInMethods || [])] })),
    links: fp.links.map((l) => ({ ...l })),
    breaches: (fp.breaches || []).map((b) => ({ ...b })),
  };
}

/** Apply a mutation to a footprint in place. Mirrors repo.applyMutation for the DB. */
export function applyMutation(fp, m) {
  const acc = m.accountId != null ? fp.accounts.find((a) => a.id === m.accountId) : null;
  switch (m.op) {
    case 'set_twofa':
      if (acc) acc.twofa = m.value;
      break;
    case 'unique_password':
      if (acc) acc.passwordGroupId = null;
      break;
    case 'resolve_breach': {
      const b = fp.breaches.find((x) => x.id === m.breachId);
      if (b) b.status = 'resolved';
      if (acc) acc.passwordGroupId = null;
      break;
    }
    case 'revoke_permission':
      if (acc) acc.permissions = acc.permissions.filter((p) => p !== m.permission);
      break;
    case 'remove_node':
      if (acc) acc.status = 'deleted';
      break;
    case 'set_carrier_pin':
      if (acc) acc.carrierPin = true;
      break;
    case 'remove_link':
      fp.links = fp.links.filter((l) => l.id !== m.linkId);
      break;
    default:
      throw new Error(`Unknown mutation op: ${m.op}`);
  }
  return fp;
}

function candidates(fp, now) {
  const active = fp.accounts.filter((a) => (a.status ?? 'active') === 'active');
  const byId = new Map(active.map((a) => [a.id, a]));
  const out = [];
  const groupSize = new Map();
  for (const a of active) if (a.passwordGroupId) groupSize.set(a.passwordGroupId, (groupSize.get(a.passwordGroupId) || 0) + 1);
  const outbound = new Map();
  for (const l of fp.links) {
    if (!byId.has(l.sourceId) || !byId.has(l.targetId)) continue;
    outbound.set(l.sourceId, (outbound.get(l.sourceId) || 0) + 1);
  }
  const openPwBreach = new Set(
    fp.breaches.filter((b) => b.status === 'open').map((b) => b.accountId),
  );

  // 1. Unresolved breaches.
  for (const b of fp.breaches) {
    const a = byId.get(b.accountId);
    if (!a || b.status !== 'open') continue;
    out.push({
      key: `breach:${b.id}`,
      category: 'breach',
      effort: 1,
      accountId: a.id,
      title: `Change your ${a.name} password after the "${b.title}" breach`,
      detail: 'Set a new, unique password and sign out of all other sessions. This also breaks any password reuse with other accounts.',
      mutation: { op: 'resolve_breach', breachId: b.id, accountId: a.id },
    });
  }

  for (const a of active) {
    const inactive = daysSince(a.lastActive, now);

    // 2. Two-factor authentication.
    if (a.kind === 'account' && !STRONG_2FA.includes(a.twofa)) {
      const upgrading = a.twofa === 'sms' || a.twofa === 'email';
      out.push({
        key: `2fa:${a.id}`,
        category: '2fa',
        effort: 1,
        accountId: a.id,
        title: upgrading
          ? `Upgrade ${a.name} from ${TWOFA[a.twofa].label.toLowerCase()}s to an authenticator app`
          : `Turn on two-factor authentication for ${a.name}`,
        detail: upgrading
          ? `${TWOFA[a.twofa].label}s can be intercepted (SIM swap, inbox takeover). An authenticator app or security key can't be.`
          : 'Use an authenticator app, passkey, or security key. Avoid SMS where possible.',
        mutation: { op: 'set_twofa', accountId: a.id, value: 'totp' },
      });
    }

    // 3. Password reuse.
    if (a.kind !== 'phone' && a.passwordGroupId && (groupSize.get(a.passwordGroupId) || 0) >= 2 && !openPwBreach.has(a.id)) {
      out.push({
        key: `pw:${a.id}`,
        category: 'password',
        effort: 1,
        accountId: a.id,
        title: `Give ${a.name} a unique password`,
        detail: `It currently shares a password with ${groupSize.get(a.passwordGroupId) - 1} other account(s). Use a password manager to generate a unique one.`,
        mutation: { op: 'unique_password', accountId: a.id },
      });
    }

    // 4. Unused third-party apps: remove entirely.
    const unused = inactive !== null && inactive > WEIGHTS.unusedDays;
    if (a.kind === 'app' && unused) {
      out.push({
        key: `remove:${a.id}`,
        category: 'cleanup',
        effort: 1,
        accountId: a.id,
        title: `Remove ${a.name} and revoke its access`,
        detail: `Not used in ${inactive} days, but it still holds ${a.permissions.length} permission(s) and any access tokens you granted.`,
        mutation: { op: 'remove_node', accountId: a.id },
      });
    } else {
      // 5. Sensitive permissions on things still in use.
      for (const perm of a.permissions || []) {
        const def = PERMISSIONS[perm];
        if (!def || def.weight < 0.5) continue;
        out.push({
          key: `perm:${a.id}:${perm}`,
          category: 'permission',
          effort: 1,
          accountId: a.id,
          title: `Revoke ${def.label.toLowerCase()} access from ${a.name}`,
          detail: 'Only keep this if the feature you use genuinely needs it. You can usually re-grant it later.',
          mutation: { op: 'revoke_permission', accountId: a.id, permission: perm },
        });
      }
    }

    // 6. Dormant accounts. Never suggest deleting an account other accounts recover through:
    //    abandoned addresses can be re-registered by an attacker.
    if (a.kind === 'account' && inactive !== null && inactive > WEIGHTS.dormantDays && (a.importance ?? 3) <= 3 && !outbound.get(a.id)) {
      out.push({
        key: `delete:${a.id}`,
        category: 'cleanup',
        effort: 2,
        accountId: a.id,
        title: `Delete your old ${a.name} account`,
        detail: `Unused for ${Math.floor(inactive / 30)} months. Download anything you need, then close it so its data can't leak in a future breach.`,
        mutation: { op: 'remove_node', accountId: a.id },
      });
    }

    // 7. SIM-swap protection.
    if (a.kind === 'phone' && !a.carrierPin) {
      out.push({
        key: `pin:${a.id}`,
        category: 'phone',
        effort: 2,
        accountId: a.id,
        title: `Add a carrier PIN / port-out lock to ${a.name}`,
        detail: 'Stops attackers from moving your number to their SIM and receiving your reset codes.',
        mutation: { op: 'set_carrier_pin', accountId: a.id },
      });
    }
  }

  // 8. Risky recovery links: recovery pointing at a dormant account.
  for (const l of fp.links) {
    const src = byId.get(l.sourceId);
    const tgt = byId.get(l.targetId);
    if (!src || !tgt || !l.type.startsWith('recovery')) continue;
    const idle = daysSince(src.lastActive, now);
    if (idle !== null && idle > WEIGHTS.dormantDays) {
      out.push({
        key: `link:${l.id}`,
        category: 'recovery',
        effort: 2,
        accountId: tgt.id,
        title: `Update ${tgt.name}'s ${LINK_TYPES[l.type].label.toLowerCase()} (points at unused ${src.name})`,
        detail: `${src.name} hasn't been used in ${Math.floor(idle / 30)} months. If it's taken over, it can reset ${tgt.name}. Point recovery at an inbox you actively secure.`,
        mutation: { op: 'remove_link', linkId: l.id },
      });
    }
  }
  return out;
}

/**
 * Generate the prioritized fix list.
 * gain        = overall score points gained (0..100 scale, unrounded)
 * reduction   = fraction of total network risk removed
 */
export function generateFixes(fp, { dismissed = new Set(), now = new Date() } = {}) {
  const samples = 2500;
  const base = computeRisk(fp, { blast: false, now, samples });
  const list = [];
  for (const c of candidates(fp, now)) {
    if (dismissed.has(c.key)) continue;
    const sim = computeRisk(applyMutation(cloneFootprint(fp), c.mutation), { blast: false, now, samples });
    const gain = sim.overall.scoreExact - base.overall.scoreExact;
    const reduction = base.overall.totalRisk > 0 ? (base.overall.totalRisk - sim.overall.totalRisk) / base.overall.totalRisk : 0;
    if (gain <= 0.01 && reduction <= 0.001) continue;
    list.push({
      ...c,
      gain: Math.round(gain * 100) / 100,
      reduction: Math.round(reduction * 1000) / 1000,
      scoreAfter: sim.overall.score,
    });
  }
  // Rank by score impact, then raw risk reduction, then lower effort.
  list.sort((a, b) => b.gain - a.gain || b.reduction - a.reduction || a.effort - b.effort);
  list.forEach((f, i) => {
    f.rank = i + 1;
    f.priority = i < 3 || f.gain >= 3 ? 'urgent' : f.gain >= 1 ? 'high' : f.gain >= 0.3 ? 'medium' : 'low';
  });
  return list;
}
