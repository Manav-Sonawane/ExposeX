import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Pencil, Siren, Trash2, Plus, ShieldCheck, ShieldOff, KeyRound, CircleDot, Undo2, CheckCircle2, Link2 } from 'lucide-react';
import { api, del, patch, post } from '../lib/api';
import { useInvalidateFootprint, useMeta } from '../lib/hooks';
import { inactiveLabel, LEVEL_STYLES, LINK_COLORS, pct } from '../lib/format';
import type { Breach, EnrichedAccount, Fix, Link as LinkT, RiskNode } from '../lib/types';
import { ErrorState, Modal, PageLoader, RiskBadge, ServiceIcon, Spinner } from '../components/ui';
import AccountForm from '../components/AccountForm';
import { toast } from '../components/Toasts';
import { FixRow, useCompleteFix } from './Dashboard';

interface Detail {
  account: EnrichedAccount;
  node: RiskNode | null;
  links: (LinkT & { sourceName: string; targetName: string; direction: 'in' | 'out'; t: number | null })[];
  siblings: { id: number; name: string }[];
  breaches: Breach[];
  fixes: Fix[];
}

function Meter({ label, value, hint, color }: { label: string; value: number; hint: string; color: string }) {
  return (
    <div className="rounded-xl bg-ink-850 p-3">
      <p className="text-[11px] font-medium text-ink-400 uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold" style={{ color }}>
        {pct(value)}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-500">{hint}</p>
    </div>
  );
}

function AddLink({ account, onDone }: { account: EnrichedAccount; onDone: () => void }) {
  const meta = useMeta().data;
  const others = useQuery({ queryKey: ['accounts', 'all-for-form'], queryFn: () => api<{ accounts: EnrichedAccount[] }>('/accounts?sort=name&dir=asc') });
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [type, setType] = useState('recovery_email');
  const [other, setOther] = useState('');
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidateFootprint();
  const m = useMutation({
    mutationFn: () =>
      post('/links', direction === 'in' ? { sourceId: Number(other), targetId: account.id, type } : { sourceId: account.id, targetId: Number(other), type }),
    onSuccess: () => {
      invalidate();
      onDone();
    },
    onError: (e) => setError((e as Error).message),
  });
  if (!meta) return <Spinner />;
  const lt = meta.linkTypes[type];
  const otherName = others.data?.accounts.find((a) => a.id === Number(other))?.name ?? '…';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-2">
        {(['in', 'out'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={clsx('rounded-lg border px-3 py-2 text-xs font-medium', direction === d ? 'border-brand-400/60 bg-brand-500/10 text-brand-300' : 'border-ink-600 text-ink-300')}
          >
            {d === 'in' ? `Another account controls ${account.name}` : `${account.name} controls another account`}
          </button>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="l-type">Connection type</label>
        <select id="l-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(meta.linkTypes).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="l-other">{direction === 'in' ? 'Controlled by' : 'Controls'}</label>
        <select id="l-other" className="input" value={other} onChange={(e) => setOther(e.target.value)} required>
          <option value="">Choose…</option>
          {others.data?.accounts.filter((a) => a.id !== account.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {other && (
        <p className="rounded-lg bg-ink-850 px-3 py-2 text-xs text-ink-300">
          Meaning: <span className="font-medium text-ink-100">{direction === 'in' ? otherName : account.name}</span> {lt.desc}{' '}
          <span className="font-medium text-ink-100">{direction === 'in' ? account.name : otherName}</span>.
        </p>
      )}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={m.isPending || !other}>
          {m.isPending && <Spinner className="size-4 text-ink-950" />} Add connection
        </button>
      </div>
    </form>
  );
}

export default function AccountDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meta = useMeta().data;
  const invalidate = useInvalidateFootprint();
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const complete = useCompleteFix();

  const q = useQuery({ queryKey: ['account', id], queryFn: () => api<Detail>(`/accounts/${id}`) });

  const simulate = useMutation({
    mutationFn: () => post<{ breach: Breach }>('/breaches/simulate', { accountId: Number(id) }),
    onSuccess: (r) => {
      invalidate();
      navigate(`/alerts?breach=${r.breach.id}`);
    },
  });
  const removeLink = useMutation({ mutationFn: (linkId: number) => del(`/links/${linkId}`), onSuccess: () => invalidate() });
  const remove = useMutation({
    mutationFn: () => del(`/accounts/${id}`),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Removed from inventory' });
      invalidate();
      navigate('/inventory');
    },
  });
  const restore = useMutation({ mutationFn: () => patch(`/accounts/${id}`, { status: 'active' }), onSuccess: () => invalidate() });
  const resolve = useMutation({
    mutationFn: (bid: number) => post(`/breaches/${bid}/resolve`),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Breach marked resolved' });
      invalidate();
    },
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { account: a, node, links, siblings, breaches, fixes } = q.data;
  const deleted = a.status === 'deleted';
  const levelColor = LEVEL_STYLES[a.level].hex;
  const factors = node ? [...node.factors].sort((x, y) => y.value - x.value) : [];
  const maxFactor = Math.max(0.01, ...factors.map((f) => Math.abs(f.value)), ...(node?.inbound.map((i) => i.contribution) ?? []));

  return (
    <>
      <Link to="/inventory" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-100">
        <ArrowLeft className="size-4" /> Inventory
      </Link>

      <div className="mb-6 flex flex-wrap items-start gap-4">
        <ServiceIcon kind={a.kind} serviceType={a.serviceType} className="size-14 rounded-2xl [&_svg]:size-7" />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {a.name}
            {!deleted && <RiskBadge level={a.level} risk={a.risk} />}
            {a.spof && (
              <span className="chip border-orange-500/40 bg-orange-500/10 text-orange-300">
                <CircleDot className="size-3" /> Single point of failure
              </span>
            )}
            {deleted && <span className="chip border-ink-500 text-ink-300">Deleted / removed</span>}
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            {a.kind === 'phone' ? 'Phone number' : a.kind === 'app' ? 'Third-party app' : meta?.serviceTypes[a.serviceType]?.label}
            {a.domain && ` · ${a.domain}`}
            {a.identifier && ` · ${a.identifier}`} · last used {inactiveLabel(a.inactiveDays).toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {deleted ? (
            <button className="btn-secondary" onClick={() => restore.mutate()}>
              <Undo2 className="size-4" /> Restore
            </button>
          ) : (
            <>
              {a.kind !== 'phone' && (
                <button className="btn-secondary" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
                  {simulate.isPending ? <Spinner className="size-4" /> : <Siren className="size-4 text-rose-300" />} Simulate breach
                </button>
              )}
              <button className="btn-secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </button>
            </>
          )}
          <button className="btn-danger" onClick={() => setConfirmDelete(true)} aria-label="Delete">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {node && (
            <div className="card card-pad">
              <p className="section-title">Why this score?</p>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Meter label="Own risk" value={node.p} hint="From this account alone" color="#cbd5e1" />
                <Meter label="Network risk" value={node.P} hint="Chance it gets compromised" color={levelColor} />
                <Meter label="Inherited" value={node.inherited} hint="Added by connected accounts" color={node.inherited > node.p ? '#fb923c' : '#7c8aa5'} />
                <Meter label="Impact" value={node.impact} hint="Importance & data held" color="#a78bfa" />
              </div>

              <div className="mt-5 grid gap-6 md:grid-cols-2">
                <div>
                  <p className="label">Own risk factors</p>
                  <ul className="space-y-2.5">
                    {factors.map((f) => (
                      <li key={f.key}>
                        <div className="flex justify-between gap-3 text-sm">
                          <span className={clsx(f.value < 0 ? 'text-emerald-300' : f.value === 0 ? 'text-rose-300' : 'text-ink-200')}>{f.label}</span>
                          <span className="shrink-0 font-mono text-xs text-ink-400">{f.value === 0 ? '' : `${f.value > 0 ? '+' : ''}${(f.value * 100).toFixed(1)}`}</span>
                        </div>
                        {f.value !== 0 && (
                          <div className="mt-1 h-1 rounded-full bg-ink-800">
                            <div className={clsx('h-full rounded-full', f.value < 0 ? 'bg-emerald-400' : 'bg-ink-300')} style={{ width: `${(Math.abs(f.value) / maxFactor) * 100}%` }} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="label">Risk flowing in from</p>
                  {node.inbound.length === 0 ? (
                    <p className="text-sm text-ink-400">Nothing else can unlock this account.</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {node.inbound.map((i) => (
                        <li key={i.linkId}>
                          <div className="flex justify-between gap-3 text-sm">
                            <Link to={`/accounts/${i.fromId}`} className="text-ink-200 hover:text-brand-300">
                              {i.fromName}
                              <span className="ml-1.5 text-xs" style={{ color: LINK_COLORS[i.type] }}>
                                {meta?.linkTypes[i.type]?.label}
                              </span>
                            </Link>
                            <span className="shrink-0 font-mono text-xs text-ink-400">+{(i.contribution * 100).toFixed(1)}</span>
                          </div>
                          <div className="mt-1 h-1 rounded-full bg-ink-800">
                            <div className="h-full rounded-full bg-orange-400" style={{ width: `${(i.contribution / maxFactor) * 100}%` }} />
                          </div>
                          <p className="mt-0.5 text-[11px] text-ink-500">
                            {pct(i.t)} chance a takeover of {i.fromName} carries over
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {node?.blast && (
            <div className="card card-pad">
              <p className="section-title">Blast radius: if {a.name} is compromised</p>
              {node.blast.dependents.length === 0 ? (
                <p className="mt-2 text-sm text-ink-400">Nothing else falls with it. This account is a leaf in your network.</p>
              ) : (
                <>
                  <p className="mt-0.5 text-xs text-ink-400">
                    An attacker could take over <span className="font-semibold text-orange-300">{node.blast.count}</span> other account(s) with high probability, through these paths:
                  </p>
                  <ul className="mt-3 divide-y divide-ink-800">
                    {node.blast.dependents.slice(0, 15).map((d) => (
                      <li key={d.id} className="flex items-center gap-3 py-2">
                        <span className="w-12 shrink-0 text-right font-mono text-sm" style={{ color: d.prob >= 0.6 ? '#f43f5e' : d.prob >= 0.4 ? '#fb923c' : '#facc15' }}>
                          {pct(d.prob)}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs">
                          {d.path.map((s, i) => (
                            <span key={i} className="inline-flex items-center gap-1">
                              {i === 0 && <span className="text-ink-400">{s.fromName}</span>}
                              <ArrowRight className="size-3" style={{ color: LINK_COLORS[s.type] }} />
                              <Link to={`/accounts/${s.to}`} className={clsx('hover:text-brand-300', i === d.path.length - 1 ? 'font-medium text-ink-100' : 'text-ink-400')}>
                                {s.toName}
                              </Link>
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="card card-pad">
            <div className="flex items-center justify-between">
              <p className="section-title">Connections</p>
              {!deleted && (
                <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setLinking(true)}>
                  <Plus className="size-3.5" /> Add connection
                </button>
              )}
            </div>
            {links.length === 0 ? (
              <p className="mt-2 text-sm text-ink-400">No connections mapped. Add the recovery email, recovery phone, or SSO provider for this account.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {links.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm">
                    <Link2 className="size-4 shrink-0" style={{ color: LINK_COLORS[l.type] }} />
                    <span className="min-w-0 flex-1">
                      <Link to={`/accounts/${l.sourceId}`} className={clsx('hover:text-brand-300', l.direction === 'in' ? 'font-medium' : 'text-ink-400')}>
                        {l.sourceName}
                      </Link>{' '}
                      <span className="text-ink-400">{meta?.linkTypes[l.type]?.desc}</span>{' '}
                      <Link to={`/accounts/${l.targetId}`} className={clsx('hover:text-brand-300', l.direction === 'out' ? 'font-medium' : 'text-ink-400')}>
                        {l.targetName}
                      </Link>
                    </span>
                    {l.t !== null && <span className="hidden font-mono text-xs text-ink-500 sm:inline">{pct(l.t)}</span>}
                    <button className="btn-ghost p-1 hover:text-rose-300" onClick={() => removeLink.mutate(l.id)} aria-label="Remove connection">
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card card-pad">
            <p className="section-title mb-3">Fixes for this account</p>
            {fixes.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="size-4" /> Nothing to fix here.
              </p>
            ) : (
              <div className="-my-3 divide-y divide-ink-800">
                {fixes.map((f) => (
                  <FixRow key={f.key} fix={f} compact busy={complete.isPending && complete.variables?.key === f.key} onDo={() => complete.mutate(f)} />
                ))}
              </div>
            )}
          </div>

          <div className="card card-pad space-y-4 text-sm">
            <p className="section-title">Security details</p>
            {a.kind === 'account' && (
              <div className="flex items-center justify-between">
                <span className="text-ink-400">Two-factor</span>
                {a.twofa === 'none' ? (
                  <span className="inline-flex items-center gap-1 text-rose-300"><ShieldOff className="size-4" /> None</span>
                ) : (
                  <span className={clsx('inline-flex items-center gap-1', meta?.strong2fa.includes(a.twofa) ? 'text-emerald-300' : 'text-yellow-200')}>
                    <ShieldCheck className="size-4" /> {meta?.twofa[a.twofa]?.label}
                  </span>
                )}
              </div>
            )}
            {a.kind === 'phone' && (
              <div className="flex items-center justify-between">
                <span className="text-ink-400">Carrier PIN</span>
                <span className={a.carrierPin ? 'text-emerald-300' : 'text-rose-300'}>{a.carrierPin ? 'Enabled' : 'Not set'}</span>
              </div>
            )}
            {a.kind !== 'phone' && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-400">Sign-in</span>
                  <span className="text-right">{a.signInMethods.map((m) => meta?.signInMethods[m]).join(', ') || '—'}</span>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-400">Password</span>
                    {a.reused ? (
                      <span className="inline-flex items-center gap-1 text-violet-300"><KeyRound className="size-4" /> {a.passwordGroup?.label}</span>
                    ) : (
                      <span>Unique</span>
                    )}
                  </div>
                  {siblings.length > 0 && (
                    <p className="mt-1 text-xs text-ink-400">
                      Also used by:{' '}
                      {siblings.map((s, i) => (
                        <span key={s.id}>
                          {i > 0 && ', '}
                          <Link to={`/accounts/${s.id}`} className="text-ink-200 hover:text-brand-300">{s.name}</Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-ink-400">Importance</span>
              <span>{'●'.repeat(a.importance)}<span className="text-ink-600">{'●'.repeat(5 - a.importance)}</span></span>
            </div>
            {a.permissions.length > 0 && (
              <div>
                <p className="mb-1.5 text-ink-400">Permissions</p>
                <div className="flex flex-wrap gap-1">
                  {a.permissions.map((p) => (
                    <span key={p} className={clsx('chip', (meta?.permissions[p]?.weight ?? 0) >= 0.6 ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-ink-600 text-ink-300')}>
                      {meta?.permissions[p]?.label ?? p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {a.dataShared.length > 0 && (
              <div>
                <p className="mb-1.5 text-ink-400">Data held</p>
                <div className="flex flex-wrap gap-1">
                  {a.dataShared.map((d) => (
                    <span key={d} className="chip border-ink-600 text-ink-300">{meta?.dataClasses[d]?.label ?? d}</span>
                  ))}
                </div>
              </div>
            )}
            {a.notes && <p className="rounded-lg bg-ink-850 p-3 text-xs whitespace-pre-wrap text-ink-300">{a.notes}</p>}
          </div>

          <div className="card card-pad">
            <p className="section-title mb-3">Breach history</p>
            {breaches.length === 0 ? (
              <p className="text-sm text-ink-400">No known breaches.</p>
            ) : (
              <ul className="space-y-2">
                {breaches.map((b) => (
                  <li key={b.id} className="rounded-lg border border-ink-700 bg-ink-850 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/alerts?breach=${b.id}`} className="text-sm font-medium hover:text-brand-300">{b.title}</Link>
                      <span className={clsx('chip shrink-0', b.status === 'open' ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 text-emerald-300')}>
                        {b.status === 'open' ? 'Action needed' : 'Resolved'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-400">
                      {b.breachDate ?? 'Unknown date'} · {b.dataClasses.map((d) => meta?.dataClasses[d]?.label ?? d).join(', ')}
                    </p>
                    {b.status === 'open' && (
                      <button className="btn-secondary mt-2 px-2.5 py-1 text-xs" onClick={() => resolve.mutate(b.id)}>
                        I changed my password
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${a.name}`} wide>
        {editing && <AccountForm initial={a} onDone={() => setEditing(false)} />}
      </Modal>
      <Modal open={linking} onClose={() => setLinking(false)} title="Add connection">
        {linking && <AddLink account={a} onDone={() => setLinking(false)} />}
      </Modal>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Remove ${a.name}?`}>
        <p className="text-sm text-ink-300">
          This removes it from your inventory along with its connections and breach history. If you actually closed the account, the Fix checklist's
          "Delete account" action keeps it in your history instead.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending && <Spinner className="size-4" />} Remove
          </button>
        </div>
      </Modal>
    </>
  );
}
