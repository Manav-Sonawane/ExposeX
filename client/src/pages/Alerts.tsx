import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellRing, CalendarClock, CheckCheck, ScanSearch, ShieldAlert, Siren, Info, ArrowRight, AlertTriangle, Plus, Sparkles } from 'lucide-react';
import { api, post } from '../lib/api';
import { useInvalidateFootprint, useMeta } from '../lib/hooks';
import { pct, timeAgo, LINK_COLORS } from '../lib/format';
import type { Breach, BreachAnalysis, EnrichedAccount, Notification } from '../lib/types';
import { ChipSelect, EmptyState, ErrorState, Modal, PageHeader, PageLoader, Spinner } from '../components/ui';
import { toast } from '../components/Toasts';

const N_ICON = { breach: ShieldAlert, reminder: CalendarClock, tip: Sparkles, system: Info };
const N_TONE = { breach: 'text-rose-400', reminder: 'text-cyan-300', tip: 'text-yellow-200', system: 'text-ink-300' };
const SEVERITY = {
  critical: 'border-rose-500/50 bg-rose-500/15 text-rose-200',
  high: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
  medium: 'border-yellow-400/40 bg-yellow-400/10 text-yellow-100',
  low: 'border-ink-500 text-ink-300',
};

function BreachPanel({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['breaches', 'analysis', id], queryFn: () => api<{ breach: Breach; analysis: BreachAnalysis }>(`/breaches/${id}/analysis`) });
  const invalidate = useInvalidateFootprint();
  const resolve = useMutation({
    mutationFn: () => post(`/breaches/${id}/resolve`),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Breach resolved', body: 'Password change recorded; reuse with other accounts is broken.' });
      invalidate();
    },
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { breach: b, analysis: a } = q.data;
  const linked = a.affected.filter((x) => x.channel !== 'reuse');
  const reuse = a.affected.filter((x) => x.channel !== 'link');
  return (
    <div className="card card-pad animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-medium text-ink-400 uppercase">
            <Siren className="size-4 text-rose-400" /> Breach impact
            {b.source === 'simulated' && <span className="chip border-ink-500 text-ink-300 normal-case">Simulated</span>}
            {b.source === 'catalog' && <span className="chip border-ink-500 text-ink-300 normal-case">Public breach record</span>}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{b.title}</h2>
          <p className="text-sm text-ink-400">
            <Link to={`/accounts/${a.account.id}`} className="text-ink-200 hover:text-brand-300">{a.account.name}</Link> · {b.breachDate ?? 'date unknown'}
          </p>
        </div>
        <span className={clsx('chip capitalize', SEVERITY[b.severity])}>{b.severity} severity</span>
      </div>

      <div className="mt-4">
        <p className="label">Data exposed</p>
        <div className="flex flex-wrap gap-1.5">
          {a.exposedData.map((d) => (
            <span key={d} className={clsx('chip', d === 'Passwords' ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-ink-600 text-ink-200')}>{d}</span>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
        <p className="mb-2 text-sm font-semibold text-ink-100">What to do next</p>
        <ol className="space-y-2">
          {a.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className={clsx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', s.urgent ? 'bg-rose-500 text-white' : 'bg-ink-700 text-ink-200')}>{i + 1}</span>
              <span className="text-ink-200">{s.text}</span>
            </li>
          ))}
        </ol>
        {b.status === 'open' ? (
          <button className="btn-primary mt-4" onClick={() => resolve.mutate()} disabled={resolve.isPending}>
            {resolve.isPending && <Spinner className="size-4 text-ink-950" />} I changed the password, mark resolved
          </button>
        ) : (
          <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-emerald-300"><CheckCheck className="size-4" /> Resolved</p>
        )}
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <p className="label">Linked accounts at risk ({linked.length})</p>
          {linked.length === 0 && <p className="text-sm text-ink-400">No accounts can be reached through connections.</p>}
          <ul className="space-y-1.5">
            {linked.slice(0, 20).map((x) => (
              <li key={x.id} className="rounded-lg bg-ink-850 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/accounts/${x.id}`} className="truncate text-sm font-medium hover:text-brand-300">{x.name}</Link>
                  <span className="font-mono text-xs" style={{ color: x.prob >= 0.6 ? '#f43f5e' : x.prob >= 0.4 ? '#fb923c' : '#facc15' }}>{pct(x.prob)}</span>
                </div>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-400">
                  <ArrowRight className="size-3 shrink-0" style={{ color: LINK_COLORS[x.path[x.path.length - 1]?.type ?? 'linked'] }} />
                  {x.reason}
                  {x.channel === 'both' && <span className="text-violet-300">(+ shared password)</span>}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="label">Same password ({reuse.length})</p>
          {reuse.length === 0 && <p className="text-sm text-ink-400">No other account shares this password.</p>}
          <ul className="space-y-1.5">
            {reuse.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-850 px-3 py-2">
                <Link to={`/accounts/${x.id}`} className="truncate text-sm font-medium hover:text-brand-300">{x.name}</Link>
                <span className="text-[11px] text-violet-300">credential stuffing</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ReportForm({ onDone }: { onDone: (id: number) => void }) {
  const meta = useMeta().data;
  const accounts = useQuery({ queryKey: ['accounts', 'all-for-form'], queryFn: () => api<{ accounts: EnrichedAccount[] }>('/accounts?sort=name&dir=asc') });
  const invalidate = useInvalidateFootprint();
  const [f, setF] = useState({ accountId: '', title: '', breachDate: new Date().toISOString().slice(0, 10), severity: 'high', dataClasses: ['email', 'passwords'] as string[] });
  const m = useMutation({
    mutationFn: () => post<{ breach: Breach }>('/breaches', { ...f, accountId: Number(f.accountId) }),
    onSuccess: (r) => {
      invalidate();
      onDone(r.breach.id);
    },
  });
  if (!meta) return <Spinner />;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <div>
        <label className="label" htmlFor="r-acc">Breached service</label>
        <select id="r-acc" className="input" required value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value, title: f.title || `${accounts.data?.accounts.find((a) => a.id === Number(e.target.value))?.name ?? ''} data breach` })}>
          <option value="">Choose…</option>
          {accounts.data?.accounts.filter((a) => a.kind !== 'phone').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="r-title">Title</label>
        <input id="r-title" className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="r-date">Date</label>
          <input id="r-date" type="date" className="input" value={f.breachDate} onChange={(e) => setF({ ...f, breachDate: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="r-sev">Severity</label>
          <select id="r-sev" className="input" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
            {['low', 'medium', 'high', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div>
        <p className="label">Data exposed</p>
        <ChipSelect options={Object.entries(meta.dataClasses).map(([value, v]) => ({ value, label: v.label }))} value={f.dataClasses} onChange={(v) => setF({ ...f, dataClasses: v })} />
      </div>
      {m.error && <p className="text-sm text-rose-300">{(m.error as Error).message}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={m.isPending}>{m.isPending && <Spinner className="size-4 text-ink-950" />} Report breach</button>
      </div>
    </form>
  );
}

export default function Alerts() {
  const [params, setParams] = useSearchParams();
  const breachId = params.get('breach') ? Number(params.get('breach')) : null;
  const [filter, setFilter] = useState<string[]>([]);
  const [reporting, setReporting] = useState(false);
  const invalidate = useInvalidateFootprint();

  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ notifications: Notification[]; unread: number }>('/notifications') });
  const breaches = useQuery({ queryKey: ['breaches'], queryFn: () => api<Breach[]>('/breaches') });

  const openBreach = (id: number) => setParams({ breach: String(id) }, { replace: false });
  const simulate = useMutation({
    mutationFn: () => post<{ breach: Breach }>('/breaches/simulate'),
    onSuccess: (r) => {
      invalidate();
      openBreach(r.breach.id);
    },
  });
  const scan = useMutation({
    mutationFn: () => post<{ scanned: number; found: Breach[] }>('/breaches/scan'),
    onSuccess: (r) => {
      toast({
        tone: r.found.length ? 'danger' : 'success',
        title: r.found.length ? `${r.found.length} known breach(es) found` : 'No new known breaches',
        body: `Checked ${r.scanned} accounts against the public breach reference list.`,
      });
      invalidate();
    },
  });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: () => invalidate() });
  const read = useMutation({ mutationFn: (id: number) => post(`/notifications/${id}/read`), onSuccess: () => invalidate() });
  const testReminder = useMutation({ mutationFn: () => post('/notifications/test-reminder'), onSuccess: () => invalidate() });

  if (notes.isLoading || breaches.isLoading) return <PageLoader />;
  if (notes.error) return <ErrorState error={notes.error} />;
  const list = notes.data!.notifications.filter((n) => !filter.length || filter.includes(n.type));
  const open = breaches.data!.filter((b) => b.status === 'open');

  return (
    <>
      <PageHeader
        title="Alerts & breaches"
        subtitle="Breach notifications, review reminders, and what each breach means for your linked accounts."
        actions={
          <>
            <button className="btn-secondary" onClick={() => scan.mutate()} disabled={scan.isPending}>
              {scan.isPending ? <Spinner className="size-4" /> : <ScanSearch className="size-4" />} Check known breaches
            </button>
            <button className="btn-secondary" onClick={() => setReporting(true)}>
              <Plus className="size-4" /> Report breach
            </button>
            <button className="btn-danger" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
              {simulate.isPending ? <Spinner className="size-4" /> : <Siren className="size-4" />} Simulate a breach
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-4">
          <div className="card card-pad">
            <div className="mb-3 flex items-center justify-between">
              <p className="section-title flex items-center gap-2">
                <AlertTriangle className="size-4 text-rose-400" /> Breaches ({open.length} open)
              </p>
            </div>
            {breaches.data!.length === 0 ? (
              <p className="text-sm text-ink-400">No breaches recorded. Run "Check known breaches" or simulate one.</p>
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {breaches.data!.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => openBreach(b.id)}
                      className={clsx('w-full rounded-lg border px-3 py-2 text-left transition', breachId === b.id ? 'border-brand-400/50 bg-brand-500/5' : 'border-ink-700 bg-ink-850 hover:border-ink-500')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{b.title}</span>
                        <span className={clsx('size-2 shrink-0 rounded-full', b.status === 'open' ? 'bg-rose-500' : 'bg-emerald-500')} title={b.status} />
                      </div>
                      <p className="text-xs text-ink-400">
                        {b.accountName} · <span className="capitalize">{b.severity}</span> · {b.source === 'simulated' ? 'simulated' : b.source === 'catalog' ? 'public record' : 'reported'} · {b.status}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card card-pad">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="section-title flex items-center gap-2">
                <BellRing className="size-4 text-cyan-300" /> Notifications
              </p>
              <div className="flex gap-1">
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => testReminder.mutate()}>Send review reminder</button>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => readAll.mutate()} disabled={!notes.data!.unread}>
                  <CheckCheck className="size-3.5" /> Mark all read
                </button>
              </div>
            </div>
            <ChipSelect
              className="mb-3"
              options={[
                { value: 'breach', label: 'Breaches' },
                { value: 'reminder', label: 'Reminders' },
                { value: 'system', label: 'System' },
              ]}
              value={filter}
              onChange={setFilter}
            />
            {list.length === 0 ? (
              <EmptyState icon={BellRing} title="No notifications" />
            ) : (
              <ul className="max-h-[480px] space-y-1.5 overflow-y-auto pr-1">
                {list.map((n) => {
                  const Icon = N_ICON[n.type];
                  const bid = n.data?.breachId as number | undefined;
                  return (
                    <li key={n.id}>
                      <button
                        className={clsx('flex w-full gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-ink-850', !n.read && 'bg-ink-850/70')}
                        onClick={() => {
                          if (!n.read) read.mutate(n.id);
                          if (bid) openBreach(bid);
                        }}
                      >
                        <Icon className={clsx('mt-0.5 size-4 shrink-0', N_TONE[n.type])} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className={clsx('text-sm', n.read ? 'text-ink-300' : 'font-semibold text-ink-100')}>{n.title}</p>
                            {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-400" />}
                          </div>
                          {n.body && <p className="mt-0.5 text-xs text-ink-400">{n.body}</p>}
                          <p className="mt-1 text-[11px] text-ink-500">{timeAgo(n.createdAt)}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div>
          {breachId ? (
            <BreachPanel key={breachId} id={breachId} />
          ) : (
            <div className="card card-pad">
              <EmptyState
                icon={Siren}
                title="Select a breach to see its impact"
                body="When a service is breached, ExposeX traces every account an attacker could reach from it, through recovery links, single sign-on, app access and reused passwords, and tells you what to do next."
                action={
                  <button className="btn-danger" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
                    <Siren className="size-4" /> Simulate a breach
                  </button>
                }
              />
            </div>
          )}
        </div>
      </div>

      <Modal open={reporting} onClose={() => setReporting(false)} title="Report a breach">
        {reporting && (
          <ReportForm
            onDone={(id) => {
              setReporting(false);
              openBreach(id);
            }}
          />
        )}
      </Modal>
    </>
  );
}
