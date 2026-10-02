// Network-aware risk engine.
//
// Model
// -----
// 1. Every node (account, phone number, third-party app) gets an INTRINSIC
//    compromise likelihood p from its own hygiene: breaches, password reuse,
//    2FA strength, dormancy, permissions.
// 2. Links are directed "control" edges: compromising SOURCE gives an attacker
//    some chance t of taking over TARGET (recovery email, recovery phone, SSO,
//    OAuth grants). t is reduced when the target's own 2FA would stop the
//    attacker, and is NOT reduced when the 2FA factor is the same channel the
//    attacker already owns (e.g. SMS 2FA on an account recovered by that phone).
// 3. EFFECTIVE likelihood P is computed with an independent-cascade model:
//    in each Monte Carlo world every node is initially compromised with
//    probability p and every edge "works" with probability t; P_j is the share
//    of worlds where j is reachable from an initially compromised node. Unlike
//    a noisy-OR fixed point this never lets a node's own risk loop back and
//    reinforce itself through cycles (phone -> email -> carrier -> phone).
//    Random draws are a deterministic hash of (world, node/edge id), i.e.
//    common random numbers: identical inputs give identical outputs, and
//    before/after comparisons for a fix have very low variance.
// 4. BLAST RADIUS of node i: assume i is compromised, everything else is
//    perfectly safe, and cascade. What falls is purely due to how accounts
//    are wired together. Nodes whose blast radius covers several accounts are
//    single points of failure.

import {
  WEIGHTS,
  TWOFA,
  LINK_TYPES,
  PERMISSIONS,
  DATA_CLASSES,
  BREACH_SEVERITY,
  STRONG_2FA,
  riskLevel,
} from './constants.js';

const DAY = 86_400_000;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export function daysSince(date, now) {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY);
}

/** 1 - prod(1 - w*scale) over a list of keys in a catalog. */
function sensitivity(keys, catalog, scale = 1) {
  let keep = 1;
  for (const k of keys || []) keep *= 1 - (catalog[k]?.weight ?? 0.2) * scale;
  return 1 - keep;
}

function isPasswordless(node) {
  const m = node.signInMethods || [];
  return m.length > 0 && !m.includes('password');
}

function activeOnly(footprint) {
  const accounts = footprint.accounts.filter((a) => (a.status ?? 'active') === 'active');
  const ids = new Set(accounts.map((a) => a.id));
  const links = footprint.links.filter(
    (l) => ids.has(l.sourceId) && ids.has(l.targetId) && l.sourceId !== l.targetId,
  );
  const breaches = (footprint.breaches || []).filter((b) => ids.has(b.accountId));
  return { accounts, links, breaches };
}

/**
 * Intrinsic compromise likelihood of a single node plus an explanation.
 * Factors are expressed as contributions that sum to the final p.
 */
export function intrinsicRisk(node, ctx) {
  const { now, groupSize, groupBreached, breachesByAccount } = ctx;
  const raw = []; // contributions before 2FA mitigation
  const add = (key, label, value) => {
    if (value > 0) raw.push({ key, label, value });
  };

  const inactiveDays = daysSince(node.lastActive, now);

  if (node.kind === 'phone') {
    if (node.carrierPin) add('sim_swap', 'SIM-swap risk (carrier PIN set)', WEIGHTS.phoneWithPin);
    else add('sim_swap', 'SIM-swap / port-out risk: no carrier PIN or port lock', WEIGHTS.phoneBase);
  } else if (node.kind === 'app') {
    add('base', 'Third-party app holding your data', WEIGHTS.appBase);
    if (inactiveDays !== null && inactiveDays > WEIGHTS.unusedDays)
      add('unused', `Unused for ${inactiveDays} days but still authorized`, WEIGHTS.appUnused);
    const sensitive = (node.permissions || []).filter((p) => (PERMISSIONS[p]?.weight ?? 0) >= 0.6);
    if (sensitive.length)
      add(
        'perms',
        `${sensitive.length} sensitive permission${sensitive.length > 1 ? 's' : ''} granted`,
        WEIGHTS.appPermEach * sensitive.length,
      );
  } else {
    add('base', 'Baseline exposure of an online account', WEIGHTS.base);
  }

  // Credential-based risk applies to anything with a password.
  if (node.kind !== 'phone') {
    const credScale = isPasswordless(node) ? 1 - WEIGHTS.passwordlessDiscount : 1;
    const n = node.passwordGroupId ? groupSize.get(node.passwordGroupId) || 1 : 1;
    if (n >= 2) {
      const extra = Math.min(n - 2, WEIGHTS.reuseMaxExtra);
      add(
        'reuse',
        `Password shared with ${n - 1} other account${n > 2 ? 's' : ''}`,
        (WEIGHTS.reuseBase + WEIGHTS.reusePerExtra * extra) * credScale,
      );
      const breachedSiblings = groupBreached.get(node.passwordGroupId);
      const siblingHit = breachedSiblings && [...breachedSiblings].some((id) => id !== node.id);
      if (siblingHit)
        add(
          'reuse_breached',
          'A breached account uses the same password (credential stuffing)',
          WEIGHTS.reuseBreached * credScale,
        );
    }

    for (const b of breachesByAccount.get(node.id) || []) {
      const leaksPw = (b.dataClasses || []).includes('passwords');
      if (b.status === 'open') {
        const sev = BREACH_SEVERITY[b.severity] ?? BREACH_SEVERITY.medium;
        add(
          `breach_${b.id}`,
          `Unresolved breach: ${b.title}${leaksPw ? ' (passwords exposed)' : ''}`,
          sev * (leaksPw ? 1 : 0.5) * credScale,
        );
      } else {
        const age = daysSince(b.breachDate, now);
        if (age === null || age < 730)
          add(`breach_${b.id}`, `Past breach (resolved): ${b.title}`, WEIGHTS.resolvedBreach);
      }
    }

    if (inactiveDays !== null && node.kind === 'account') {
      if (inactiveDays > 730)
        add('dormant', `Dormant for ${Math.floor(inactiveDays / 365)}+ years (nobody watching it)`, WEIGHTS.dormant2y);
      else if (inactiveDays > WEIGHTS.dormantDays)
        add('dormant', 'Not used in over a year', WEIGHTS.dormant1y);
    }
  }

  const rawSum = raw.reduce((s, f) => s + f.value, 0);
  const factor = node.kind === 'account' ? (TWOFA[node.twofa] ?? TWOFA.none).factor : 1;
  const p = clamp(rawSum * factor, WEIGHTS.minP, WEIGHTS.maxP);

  // Rescale contributions so they sum to the final p, with mitigation shown separately.
  const scale = rawSum > 0 ? Math.min(1, WEIGHTS.maxP / Math.max(rawSum, 1e-9)) : 1;
  const factors = raw.map((f) => ({ ...f, value: round(f.value * scale) }));
  if (factor < 1 && rawSum > 0) {
    factors.push({
      key: 'twofa',
      label: `${TWOFA[node.twofa].label} 2FA reduces takeover risk`,
      value: round(-(Math.min(rawSum, WEIGHTS.maxP) * (1 - factor))),
    });
  } else if (node.kind === 'account' && node.twofa === 'none') {
    factors.push({ key: 'no_2fa', label: 'No two-factor authentication', value: 0 });
  }
  return { p, factors };
}

/** Probability that controlling link.source lets an attacker take over link.target. */
export function transmission(link, source, target) {
  const def = LINK_TYPES[link.type] ?? LINK_TYPES.linked;
  let base = def.base;
  if (link.type === 'oauth') {
    let keep = 1;
    for (const perm of source.permissions || []) keep *= 1 - (PERMISSIONS[perm]?.takeover ?? 0);
    base = def.base * Math.max(1 - keep, 0.08);
  }
  const twofa = TWOFA[target.twofa] ?? TWOFA.none;
  let block = 0;
  if (target.kind === 'account') {
    if (link.type === 'recovery_email') block = target.twofa === 'email' ? 0 : twofa.block;
    else if (link.type === 'recovery_phone') block = target.twofa === 'sms' ? 0 : twofa.block;
    else if (link.type === 'linked') block = twofa.block * 0.5;
    // sso and oauth bypass the target's own 2FA entirely.
  }
  return clamp(base * (1 - block), 0, 1);
}

export const SAMPLES = 4000;
export const BLAST_SAMPLES = 1200;

// murmur3 finalizer: a fast, well-mixed 32-bit hash.
function fmix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
/** Deterministic uniform [0,1) for (world, entity, salt). */
function draw(world, entity, salt) {
  return fmix(fmix(fmix(world + 0x9e3779b9) ^ entity) ^ salt) / 4294967296;
}

/** Compact adjacency for the simulator. */
function compile(ids, outgoing) {
  const index = new Map(ids.map((id, i) => [id, i]));
  const out = ids.map((id) =>
    (outgoing.get(id) || []).map((e) => ({ to: index.get(e.targetId), key: e.key, t: e.t })),
  );
  return { index, out };
}

/**
 * Independent-cascade Monte Carlo.
 * @param seeds  function(world) -> array of node indices compromised initially
 * @returns      Float64Array of P per node index
 */
function cascade(g, n, seeds, samples) {
  const hits = new Float64Array(n);
  const stamp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  for (let w = 0; w < samples; w++) {
    let top = 0;
    for (const i of seeds(w)) {
      if (stamp[i] !== w) {
        stamp[i] = w;
        stack[top++] = i;
      }
    }
    while (top > 0) {
      const u = stack[--top];
      hits[u]++;
      for (const e of g.out[u]) {
        if (stamp[e.to] === w) continue;
        if (draw(w, e.key, 0x2b) < e.t) {
          stamp[e.to] = w;
          stack[top++] = e.to;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) hits[i] /= samples;
  return hits;
}

/** Effective compromise likelihood for every node given intrinsic p. */
export function propagate(ids, outgoing, p, samples = SAMPLES) {
  const g = compile(ids, outgoing);
  const n = ids.length;
  const pArr = ids.map((id) => p.get(id) ?? 0);
  const salt = ids.map((id) => fmix(Number(id) * 2654435761 + 17));
  const seeds = (w) => {
    const s = [];
    for (let i = 0; i < n; i++) if (pArr[i] > 0 && draw(w, salt[i], 0x1a) < pArr[i]) s.push(i);
    return s;
  };
  const hits = cascade(g, n, seeds, samples);
  return new Map(ids.map((id, i) => [id, hits[i]]));
}

/** Most-probable attack path from `start` to every node (max product of t). */
function bestPaths(start, ids, outgoing) {
  const best = new Map(ids.map((id) => [id, 0]));
  const prev = new Map();
  best.set(start, 1);
  const done = new Set();
  for (;;) {
    let u = null;
    for (const id of ids) if (!done.has(id) && best.get(id) > 0 && (u === null || best.get(id) > best.get(u))) u = id;
    if (u === null) break;
    done.add(u);
    for (const e of outgoing.get(u) || []) {
      const cand = best.get(u) * e.t;
      if (cand > best.get(e.targetId)) {
        best.set(e.targetId, cand);
        prev.set(e.targetId, { from: u, type: e.type });
      }
    }
  }
  return (target) => {
    const steps = [];
    let cur = target;
    while (prev.has(cur)) {
      const s = prev.get(cur);
      steps.unshift({ from: s.from, to: cur, type: s.type });
      cur = s.from;
    }
    return steps;
  };
}

function nodeImpact(node) {
  const imp = clamp((node.importance ?? 3) / 5, 0.2, 1);
  const data = sensitivity(node.dataShared, DATA_CLASSES, 0.6);
  const perms = sensitivity(node.permissions, PERMISSIONS, 0.5);
  return clamp(0.55 * imp + 0.3 * data + 0.15 * perms, 0.05, 1);
}

function buildGraph(accounts, links) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const edges = links.map((l) => ({
    id: l.id,
    sourceId: l.sourceId,
    targetId: l.targetId,
    type: l.type,
    // Stable per-edge key so random draws survive unrelated graph edits.
    key: fmix(Number(l.sourceId) * 73856093 ^ Number(l.targetId) * 19349663 ^ (Object.keys(LINK_TYPES).indexOf(l.type) + 1) * 83492791),
    t: transmission(l, byId.get(l.sourceId), byId.get(l.targetId)),
  }));
  const incoming = new Map();
  const outgoing = new Map();
  for (const e of edges) {
    if (!incoming.has(e.targetId)) incoming.set(e.targetId, []);
    if (!outgoing.has(e.sourceId)) outgoing.set(e.sourceId, []);
    incoming.get(e.targetId).push(e);
    outgoing.get(e.sourceId).push(e);
  }
  return { byId, edges, incoming, outgoing };
}

/** Structural blast radius: what falls if `id` is compromised and nothing else is weak. */
export function blastRadius(id, ids, outgoing, impact, compiled = compile(ids, outgoing)) {
  const start = compiled.index.get(id);
  const cond = cascade(compiled, ids.length, () => [start], BLAST_SAMPLES);
  const pathTo = bestPaths(id, ids, outgoing);
  const dependents = [];
  let expectedImpact = 0;
  for (const [i, j] of ids.entries()) {
    if (j === id) continue;
    const prob = cond[i];
    if (prob < 0.01) continue;
    expectedImpact += prob * impact.get(j);
    dependents.push({ id: j, prob: round(prob), path: pathTo(j) });
  }
  dependents.sort((a, b) => b.prob - a.prob);
  const count = dependents.filter((d) => d.prob >= WEIGHTS.structuralThreshold).length;
  return { count, impact: round(expectedImpact), dependents };
}

/**
 * Compute risk for a whole footprint.
 * @param footprint {accounts, links, breaches}
 * @param opts.blast  compute blast radius / SPOFs (expensive-ish; skip for what-if sims)
 * @param opts.now    reference date
 */
export function computeRisk(footprint, { blast = true, now = new Date(), samples = SAMPLES } = {}) {
  const { accounts, links, breaches } = activeOnly(footprint);
  const ids = accounts.map((a) => a.id);
  const { byId, edges, incoming, outgoing } = buildGraph(accounts, links);

  // Password-reuse context.
  const groupSize = new Map();
  for (const a of accounts) if (a.passwordGroupId) groupSize.set(a.passwordGroupId, (groupSize.get(a.passwordGroupId) || 0) + 1);
  const breachesByAccount = new Map();
  const groupBreached = new Map();
  for (const b of breaches) {
    if (!breachesByAccount.has(b.accountId)) breachesByAccount.set(b.accountId, []);
    breachesByAccount.get(b.accountId).push(b);
    const acc = byId.get(b.accountId);
    if (b.status === 'open' && (b.dataClasses || []).includes('passwords') && acc?.passwordGroupId) {
      if (!groupBreached.has(acc.passwordGroupId)) groupBreached.set(acc.passwordGroupId, new Set());
      groupBreached.get(acc.passwordGroupId).add(acc.id);
    }
  }
  const ctx = { now, groupSize, groupBreached, breachesByAccount };

  const intrinsic = new Map();
  const p = new Map();
  const impact = new Map();
  for (const a of accounts) {
    const r = intrinsicRisk(a, ctx);
    intrinsic.set(a.id, r);
    p.set(a.id, r.p);
    impact.set(a.id, nodeImpact(a));
  }

  const P = propagate(ids, outgoing, p, samples);

  const blastById = new Map();
  if (blast) {
    const compiled = compile(ids, outgoing);
    for (const id of ids) blastById.set(id, blastRadius(id, ids, outgoing, impact, compiled));
  }

  const nodes = accounts.map((a) => {
    const Pi = P.get(a.id);
    const I = impact.get(a.id);
    const br = blastById.get(a.id);
    const own = Pi * (0.4 + 0.6 * I);
    const cascade = br ? Pi * Math.min(1, br.impact / 3) : 0;
    const risk = Math.round(100 * (1 - (1 - own) * (1 - cascade)));
    const inbound = (incoming.get(a.id) || [])
      .map((e) => ({
        linkId: e.id,
        fromId: e.sourceId,
        type: e.type,
        t: round(e.t),
        contribution: round(P.get(e.sourceId) * e.t),
      }))
      .sort((x, y) => y.contribution - x.contribution);
    const outboundCount = (outgoing.get(a.id) || []).length;
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      serviceType: a.serviceType,
      importance: a.importance,
      twofa: a.twofa,
      p: round(p.get(a.id)),
      P: round(Pi),
      inherited: round(Math.max(0, Pi - p.get(a.id))),
      impact: round(I),
      risk,
      level: riskLevel(risk),
      factors: intrinsic.get(a.id).factors,
      inbound,
      outboundCount,
      blast: br ?? null,
      spof: br ? br.count >= WEIGHTS.spofMinDependents : false,
    };
  });

  const overall = scoreOverall(accounts, nodes, impact, P);
  const spofs = nodes
    .filter((n) => n.spof)
    .sort((a, b) => b.P * b.blast.impact - a.P * a.blast.impact)
    .map((n) => n.id);

  return { nodes, edges: edges.map(({ key, ...e }) => ({ ...e, t: round(e.t) })), overall, spofs };
}

function scoreOverall(accounts, nodes, impact, P) {
  if (!accounts.length) {
    return { score: 100, securityRisk: 0, privacyExposure: 0, hygieneGap: 0, totalRisk: 0, counts: emptyCounts() };
  }
  // Security: impact-weighted expected compromise, already network-aware via P.
  let num = 0;
  let den = 0;
  for (const a of accounts) {
    num += P.get(a.id) * impact.get(a.id);
    den += impact.get(a.id);
  }
  const securityRisk = num / den;

  // Privacy: every sensitive permission adds exposure, more so if the holder is unused.
  const now = new Date();
  let keep = 1;
  for (const a of accounts) {
    const perm = sensitivity(a.permissions, PERMISSIONS, 1);
    if (!perm) continue;
    const idle = daysSince(a.lastActive, now);
    const unused = idle !== null && idle > WEIGHTS.unusedDays ? 1.6 : 1;
    keep *= 1 - Math.min(0.5, 0.07 * perm * unused * (a.kind === 'app' ? 1.2 : 1));
  }
  const privacyExposure = 1 - keep;

  // Hygiene: share of important accounts without strong 2FA.
  const important = accounts.filter((a) => a.kind === 'account' && (a.importance ?? 3) >= 4);
  const weak = important.filter((a) => !STRONG_2FA.includes(a.twofa));
  const hygieneGap = important.length ? weak.length / important.length : 0;

  // Linear so every bit of removed risk shows up in the score (no saturation).
  const penalty = 0.6 * securityRisk + 0.25 * privacyExposure + 0.15 * hygieneGap;
  const scoreExact = clamp(100 * (1 - penalty), 0, 100);

  const counts = emptyCounts();
  for (const n of nodes) counts[n.level]++;
  counts.total = nodes.length;
  counts.no2fa = accounts.filter((a) => a.kind === 'account' && a.twofa === 'none').length;
  counts.reused = accounts.filter((a) => a.passwordGroupId && accounts.filter((b) => b.passwordGroupId === a.passwordGroupId).length > 1).length;
  counts.spofs = nodes.filter((n) => n.spof).length;

  return {
    score: Math.round(scoreExact),
    scoreExact: round(scoreExact, 4),
    securityRisk: round(securityRisk),
    privacyExposure: round(privacyExposure),
    hygieneGap: round(hygieneGap),
    totalRisk: round(num, 4),
    counts,
  };
}

function emptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0, total: 0, no2fa: 0, reused: 0, spofs: 0 };
}
