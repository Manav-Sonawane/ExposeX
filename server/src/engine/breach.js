// Breach impact analysis: when a service is breached, who else is affected?

import { computeRisk } from './risk.js';
import { LINK_TYPES, DATA_CLASSES } from './constants.js';

/**
 * @param fp      footprint
 * @param breach  {accountId, title, dataClasses, severity}
 * @returns       {account, affected: [{id, name, prob, reason, path}], reuseSiblings, steps}
 */
export function analyzeBreach(fp, breach, { risk } = {}) {
  const r = risk ?? computeRisk(fp);
  const node = r.nodes.find((n) => n.id === breach.accountId);
  if (!node) return null;
  const byId = new Map(fp.accounts.map((a) => [a.id, a]));
  const account = byId.get(breach.accountId);
  const leaksPw = (breach.dataClasses || []).includes('passwords');

  const affected = [];
  const seen = new Set([account.id]);

  // Accounts that can be taken over through recovery / SSO / OAuth chains.
  for (const d of node.blast?.dependents || []) {
    const target = byId.get(d.id);
    if (!target) continue;
    const first = d.path[d.path.length - 1];
    const via = first ? byId.get(first.from) : account;
    const reason =
      d.path.length <= 1
        ? `${account.name} ${LINK_TYPES[first?.type]?.desc ?? 'is linked to'} ${target.name}`
        : `Reachable in ${d.path.length} hops via ${via?.name}`;
    affected.push({ id: target.id, name: target.name, kind: target.kind, prob: d.prob, reason, path: d.path, channel: 'link' });
    seen.add(target.id);
  }

  // Password reuse: credential stuffing against every sibling.
  const reuseSiblings = account.passwordGroupId
    ? fp.accounts.filter((a) => a.id !== account.id && a.passwordGroupId === account.passwordGroupId && (a.status ?? 'active') === 'active')
    : [];
  for (const s of reuseSiblings) {
    const prob = leaksPw ? 0.6 : 0.25;
    const existing = affected.find((x) => x.id === s.id);
    if (existing) {
      existing.prob = Math.max(existing.prob, prob);
      existing.reason += '; also shares the same password';
      existing.channel = 'both';
    } else {
      affected.push({
        id: s.id,
        name: s.name,
        kind: s.kind,
        prob,
        reason: leaksPw ? 'Uses the same password, which was exposed in this breach' : 'Uses the same password (credential stuffing risk)',
        path: [],
        channel: 'reuse',
      });
    }
  }
  affected.sort((a, b) => b.prob - a.prob);

  const steps = [];
  steps.push({ accountId: account.id, text: `Change your ${account.name} password now and sign out all other sessions.`, urgent: true });
  if (!['totp', 'hardware', 'passkey', 'push'].includes(account.twofa) && account.kind === 'account')
    steps.push({ accountId: account.id, text: `Turn on authenticator-app 2FA for ${account.name}.`, urgent: true });
  if (reuseSiblings.length)
    steps.push({
      text: `Change the shared password on ${reuseSiblings.length} other account(s): ${reuseSiblings.map((s) => s.name).join(', ')}.`,
      urgent: leaksPw,
    });
  const linkAffected = affected.filter((a) => a.channel !== 'reuse' && a.prob >= 0.3);
  if (linkAffected.length)
    steps.push({
      text: `Check recent activity and recovery settings on ${linkAffected.length} linked account(s) that ${account.name} can unlock: ${linkAffected.slice(0, 5).map((s) => s.name).join(', ')}${linkAffected.length > 5 ? '…' : ''}.`,
      urgent: true,
    });
  const dc = breach.dataClasses || [];
  if (dc.includes('payment') || dc.includes('financial'))
    steps.push({ text: 'Watch your card and bank statements; ask your bank about replacing exposed cards.', urgent: true });
  if (dc.includes('government_id') || dc.includes('dob'))
    steps.push({ text: 'Consider a credit freeze; identity data was exposed.', urgent: false });
  if (dc.includes('email') || dc.includes('phone') || dc.includes('name'))
    steps.push({ text: 'Expect targeted phishing that mentions this service. Never use links in "security alert" messages; go to the site directly.', urgent: false });

  return {
    account: { id: account.id, name: account.name, kind: account.kind },
    exposedData: dc.map((k) => DATA_CLASSES[k]?.label ?? k),
    affected,
    reuseSiblings: reuseSiblings.map((s) => ({ id: s.id, name: s.name })),
    steps,
  };
}
