import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Search, SlidersHorizontal, X, KeyRound, CircleDot, ShieldCheck, ShieldOff, Trash2, Pencil, Check, ArrowUpDown } from 'lucide-react';
import { api, del, patch } from '../lib/api';
import { useInvalidateFootprint, useMeta } from '../lib/hooks';
import { ACTIVITY_LABELS, inactiveLabel, LEVEL_STYLES } from '../lib/format';
import type { EnrichedAccount, Group, Kind } from '../lib/types';
import { ChipSelect, EmptyState, ErrorState, Modal, PageHeader, PageLoader, RiskBadge, RiskBar, ServiceIcon, Spinner } from '../components/ui';
import AccountForm from '../components/AccountForm';
import { toast } from '../components/Toasts';

const FILTER_KEYS = ['q', 'kind', 'risk', 'type', 'data', 'twofa', 'activity', 'reused', 'spof', 'sort', 'dir'] as const;

function TwoFA({ value }: { value: string }) {
  const meta = useMeta().data;
  const strong = meta?.strong2fa.includes(value);
  if (value === 'none')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-rose-300">
        <ShieldOff className="size-3.5" /> None
      </span>
    );
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs', strong ? 'text-emerald-300' : 'text-yellow-200')}>
      <ShieldCheck className="size-3.5" /> {meta?.twofa[value]?.label ?? value}
    </span>
  );
}

function GroupsPanel() {
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<Group[]>('/groups') });
  const invalidate = useInvalidateFootprint();
  const [editing, setEditing] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const rename = useMutation({
    mutationFn: ({ id, label }: { id: number; label: string }) => patch(`/groups/${id}`, { label }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => del(`/groups/${id}`),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Group removed', body: 'Its accounts are now marked as having unique passwords.' });
      invalidate();
    },
  });
  return (
    <div className="card card-pad">
      <p className="section-title flex items-center gap-2">
        <KeyRound className="size-4 text-violet-300" /> Password-reuse groups
      </p>
      <p className="mt-0.5 mb-3 text-xs text-ink-400">Labels only. ExposeX never sees or stores a real password.</p>
      {groups.data?.length === 0 && <p className="text-sm text-ink-400">No shared passwords recorded.</p>}
      <div className="space-y-2">
        {groups.data?.map((g) => (
          <div key={g.id} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
            {editing === g.id ? (
              <>
                <input className="input py-1" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
                <button className="btn-ghost p-1.5" onClick={() => rename.mutate({ id: g.id, label })} aria-label="Save">
                  <Check className="size-4" />
                </button>
              </>
            ) : (
              <>
                <Link to={`/inventory?q=&reused=true`} className="min-w-0 flex-1 truncate text-sm">
                  {g.label}
                </Link>
                <span className={clsx('chip', g.size > 1 ? 'border-violet-500/30 bg-violet-500/10 text-violet-300' : 'border-ink-600 text-ink-400')}>
                  {g.size} account{g.size === 1 ? '' : 's'}
                </span>
                <button
                  className="btn-ghost p-1.5"
                  onClick={() => {
                    setEditing(g.id);
                    setLabel(g.label);
                  }}
                  aria-label="Rename"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button className="btn-ghost p-1.5 hover:text-rose-300" onClick={() => remove.mutate(g.id)} aria-label="Delete group">
                  <Trash2 className="size-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Inventory() {
  const meta = useMeta().data;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(() => FILTER_KEYS.some((k) => k !== 'q' && k !== 'kind' && k !== 'sort' && k !== 'dir' && params.get(k)));
  const [adding, setAdding] = useState<Kind | null>(params.get('add') ? 'account' : null);

  const query = useMemo(() => {
    const qp = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) qp.set(k, v);
    }
    return qp.toString();
  }, [params]);

  const q = useQuery({
    queryKey: ['accounts', query],
    queryFn: () => api<{ total: number; accounts: EnrichedAccount[] }>(`/accounts?${query}`),
    placeholderData: keepPreviousData,
  });

  const list = (k: string) => (params.get(k) ? params.get(k)!.split(',') : []);
  const setParam = (k: string, v: string | string[] | null) => {
    const next = new URLSearchParams(params);
    const val = Array.isArray(v) ? v.join(',') : v;
    if (val) next.set(k, val);
    else next.delete(k);
    next.delete('add');
    setParams(next, { replace: true });
  };
  const activeFilters = FILTER_KEYS.filter((k) => !['q', 'sort', 'dir', 'kind'].includes(k) && params.get(k)).length;
  const sort = params.get('sort') ?? 'risk';
  const toggleSort = (key: string) => {
    const next = new URLSearchParams(params);
    if (sort === key) next.set('dir', params.get('dir') === 'asc' ? 'desc' : 'asc');
    else {
      next.set('sort', key);
      next.set('dir', key === 'name' ? 'asc' : 'desc');
    }
    setParams(next, { replace: true });
  };

  const opts = (rec?: Record<string, { label: string }>) => Object.entries(rec ?? {}).map(([value, v]) => ({ value, label: v.label }));
  const kinds: { value: string; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'account', label: 'Accounts' },
    { value: 'phone', label: 'Phone numbers' },
    { value: 'app', label: 'Apps' },
  ];

  const SortHead = ({ k, children, className }: { k: string; children: string; className?: string }) => (
    <th className={clsx('px-3 py-2.5 font-medium', className)}>
      <button onClick={() => toggleSort(k)} className={clsx('inline-flex items-center gap-1 hover:text-ink-100', sort === k && 'text-ink-100')}>
        {children} <ArrowUpDown className="size-3" />
      </button>
    </th>
  );

  return (
    <>
      <PageHeader
        title="Accounts & apps inventory"
        subtitle="Everything that holds your data, and how it connects."
        actions={
          <>
            <button className="btn-secondary" onClick={() => setAdding('phone')}>
              <Plus className="size-4" /> Phone
            </button>
            <button className="btn-secondary" onClick={() => setAdding('app')}>
              <Plus className="size-4" /> App
            </button>
            <button className="btn-primary" onClick={() => setAdding('account')}>
              <Plus className="size-4" /> Add account
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <div className="card mb-4 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500" />
                <input
                  className="input pl-9"
                  placeholder="Search by name, domain, username, notes…"
                  value={params.get('q') ?? ''}
                  onChange={(e) => setParam('q', e.target.value)}
                  aria-label="Search accounts"
                />
              </div>
              <div className="flex rounded-lg border border-ink-600 bg-ink-850 p-0.5">
                {kinds.map((k) => (
                  <button
                    key={k.value}
                    onClick={() => setParam('kind', k.value || null)}
                    className={clsx(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition',
                      (params.get('kind') ?? '') === k.value ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200',
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <button className={clsx('btn-secondary', activeFilters && 'border-brand-400/50 text-brand-300')} onClick={() => setShowFilters((s) => !s)}>
                <SlidersHorizontal className="size-4" /> Filters{activeFilters ? ` (${activeFilters})` : ''}
              </button>
              {activeFilters > 0 && (
                <button
                  className="btn-ghost"
                  onClick={() => {
                    const next = new URLSearchParams();
                    for (const k of ['q', 'kind', 'sort', 'dir']) if (params.get(k)) next.set(k, params.get(k)!);
                    setParams(next, { replace: true });
                  }}
                >
                  <X className="size-4" /> Clear
                </button>
              )}
            </div>

            {showFilters && meta && (
              <div className="mt-3 grid gap-4 border-t border-ink-700 pt-3 md:grid-cols-2">
                <div>
                  <p className="label">Risk level</p>
                  <ChipSelect options={(['critical', 'high', 'medium', 'low'] as const).map((l) => ({ value: l, label: LEVEL_STYLES[l].label }))} value={list('risk')} onChange={(v) => setParam('risk', v)} />
                </div>
                <div>
                  <p className="label">2FA status</p>
                  <ChipSelect
                    options={[
                      { value: 'none', label: 'No 2FA' },
                      { value: 'weak', label: 'Weak (none/SMS/email)' },
                      { value: 'strong', label: 'Strong (app/key/passkey)' },
                    ]}
                    value={list('twofa')}
                    onChange={(v) => setParam('twofa', v)}
                  />
                </div>
                <div>
                  <p className="label">Last activity</p>
                  <ChipSelect options={Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label }))} value={list('activity')} onChange={(v) => setParam('activity', v)} />
                </div>
                <div>
                  <p className="label">Network</p>
                  <ChipSelect
                    options={[
                      { value: 'reused', label: 'Reused password' },
                      { value: 'spof', label: 'Single point of failure' },
                    ]}
                    value={[params.get('reused') ? 'reused' : '', params.get('spof') ? 'spof' : ''].filter(Boolean)}
                    onChange={(v) => {
                      const next = new URLSearchParams(params);
                      for (const k of ['reused', 'spof']) {
                        if (v.includes(k)) next.set(k, 'true');
                        else next.delete(k);
                      }
                      setParams(next, { replace: true });
                    }}
                  />
                </div>
                <div className="md:col-span-2">
                  <p className="label">Service type</p>
                  <ChipSelect options={opts(meta.serviceTypes)} value={list('type')} onChange={(v) => setParam('type', v)} />
                </div>
                <div className="md:col-span-2">
                  <p className="label">Data shared or permission granted</p>
                  <ChipSelect
                    options={[...opts(meta.dataClasses), ...opts(meta.permissions).filter((p) => !meta.dataClasses[p.value])]}
                    value={list('data')}
                    onChange={(v) => setParam('data', v)}
                  />
                </div>
              </div>
            )}
          </div>

          {q.isLoading ? (
            <PageLoader />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : q.data!.accounts.length === 0 ? (
            <EmptyState
              icon={Search}
              title={query ? 'No matches' : 'Your inventory is empty'}
              body={query ? 'Try removing some filters.' : 'Start with your main email account and your phone number. Most other accounts recover through those.'}
              action={!query && <button className="btn-primary" onClick={() => setAdding('account')}>Add your first account</button>}
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5 text-xs text-ink-400">
                <span>
                  {q.data!.total} result{q.data!.total === 1 ? '' : 's'}
                </span>
                {q.isFetching && <Spinner className="size-4" />}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="text-left text-xs text-ink-400">
                    <tr className="border-b border-ink-700">
                      <SortHead k="name" className="pl-4">Name</SortHead>
                      <SortHead k="risk" className="w-44">Risk</SortHead>
                      <th className="px-3 py-2.5 font-medium">2FA</th>
                      <th className="px-3 py-2.5 font-medium">Password</th>
                      <SortHead k="blast">Unlocks</SortHead>
                      <SortHead k="lastActive">Last used</SortHead>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-800">
                    {q.data!.accounts.map((a) => (
                      <tr key={a.id} className="cursor-pointer transition hover:bg-ink-850" onClick={() => navigate(`/accounts/${a.id}`)}>
                        <td className="py-2.5 pr-3 pl-4">
                          <div className="flex items-center gap-3">
                            <ServiceIcon kind={a.kind} serviceType={a.serviceType} />
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate font-medium text-ink-100">
                                {a.name}
                                {a.spof && (
                                  <span title="Single point of failure" className="text-orange-300">
                                    <CircleDot className="size-3.5" />
                                  </span>
                                )}
                              </p>
                              <p className="truncate text-xs text-ink-400">
                                {a.kind === 'phone' ? 'Phone number' : a.kind === 'app' ? 'Third-party app' : meta?.serviceTypes[a.serviceType]?.label}
                                {a.domain && ` · ${a.domain}`}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <RiskBadge level={a.level} risk={a.risk} />
                          </div>
                          <div className="mt-1.5 w-32">
                            <RiskBar value={a.risk} level={a.level} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{a.kind === 'account' ? <TwoFA value={a.twofa} /> : a.kind === 'phone' ? <span className={clsx('text-xs', a.carrierPin ? 'text-emerald-300' : 'text-rose-300')}>{a.carrierPin ? 'Carrier PIN' : 'No carrier PIN'}</span> : <span className="text-xs text-ink-400">{a.permissions.length} permissions</span>}</td>
                        <td className="px-3 py-2.5">
                          {a.kind === 'phone' ? (
                            <span className="text-xs text-ink-500">n/a</span>
                          ) : a.reused ? (
                            <span className="chip border-violet-500/30 bg-violet-500/10 text-violet-300">
                              <KeyRound className="size-3" /> Shared ×{a.passwordGroup!.size}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-400">Unique</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs">{a.blastCount > 0 ? <span className="font-semibold text-orange-300">{a.blastCount} accounts</span> : <span className="text-ink-500">none</span>}</td>
                        <td className={clsx('px-3 py-2.5 text-xs', a.activity === 'dormant' ? 'text-yellow-200' : 'text-ink-300')}>{inactiveLabel(a.inactiveDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <GroupsPanel />
          <div className="card card-pad text-xs text-ink-400">
            <p className="section-title mb-2">How scoring works</p>
            <p>
              Each account gets an <span className="text-ink-200">intrinsic</span> risk from breaches, password reuse, 2FA, and dormancy. Risk then
              <span className="text-ink-200"> flows along connections</span>: if an inbox can reset your bank, your bank is only as safe as that inbox.
              Scores come from thousands of simulated attack cascades across your whole network.
            </p>
          </div>
        </div>
      </div>

      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding === 'phone' ? 'Add phone number' : adding === 'app' ? 'Add third-party app' : 'Add account'} wide>
        {adding && <AccountForm defaultKind={adding} onDone={(a) => { setAdding(null); navigate(`/accounts/${a.id}`); }} />}
      </Modal>
    </>
  );
}
