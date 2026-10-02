import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, KeyRound, ShieldOff, Siren, TrendingUp, Users, CalendarClock } from 'lucide-react';
import { api, post } from '../lib/api';
import { useInvalidateFootprint } from '../lib/hooks';
import { parseServerDate, scoreColor, scoreLabel, timeAgo, FIX_CATEGORY, LEVEL_STYLES } from '../lib/format';
import type { Dashboard as DashboardData, GraphData, Fix } from '../lib/types';
import { ErrorState, PageHeader, PageLoader, RiskBadge, RiskBar, ScoreGauge, ServiceIcon, Spinner } from '../components/ui';
import ExposureGraph, { GraphLegend } from '../components/ExposureGraph';
import { toast } from '../components/Toasts';
import clsx from 'clsx';

export function useCompleteFix() {
  const invalidate = useInvalidateFootprint();
  return useMutation({
    mutationFn: (fix: Fix) => post<{ scoreBefore: number; scoreAfter: number }>('/fixes/complete', { key: fix.key }),
    onSuccess: (r, fix) => {
      toast({
        tone: 'success',
        title: 'Fix applied',
        body: `${fix.title}. Score ${r.scoreBefore} → ${r.scoreAfter}.`,
      });
      invalidate();
    },
    onError: (e) => toast({ tone: 'danger', title: 'Could not apply fix', body: (e as Error).message }),
  });
}

function HistoryChart({ history }: { history: DashboardData['history'] }) {
  const data = history.map((h) => ({
    t: parseServerDate(h.createdAt).getTime(),
    score: h.score,
    reason: h.reason,
  }));
  if (data.length < 2)
    return <p className="flex h-full items-center justify-center text-sm text-ink-400">Complete fixes to see your progress over time.</p>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          stroke="#475569"
          tick={{ fill: '#7c8aa5', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={30}
        />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke="#475569" tick={{ fill: '#7c8aa5', fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ stroke: '#475569', strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof data)[number];
            return (
              <div className="max-w-60 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 text-xs shadow-xl">
                <p className="text-ink-400">{new Date(p.t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                <p className="mt-0.5 text-sm font-semibold text-ink-100">Score {p.score}</p>
                {p.reason && <p className="mt-0.5 text-ink-300">{p.reason}</p>}
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="score" stroke="#22d3ee" strokeWidth={2} fill="url(#scoreFill)" dot={{ r: 3, fill: '#22d3ee', strokeWidth: 0 }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function FixRow({ fix, onDo, busy, compact }: { fix: Fix; onDo: () => void; busy: boolean; compact?: boolean }) {
  const cat = FIX_CATEGORY[fix.category];
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-800 font-mono text-xs text-ink-300">{fix.rank}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-100">{fix.title}</p>
        {!compact && <p className="mt-0.5 text-xs text-ink-400">{fix.detail}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className={clsx('chip', cat.color)}>{cat.label}</span>
          <span className="text-xs font-medium text-emerald-300">+{fix.gain.toFixed(1)} pts</span>
          <span className="text-xs text-ink-400">−{(fix.reduction * 100).toFixed(1)}% network risk</span>
        </div>
      </div>
      <button onClick={onDo} disabled={busy} className="btn-secondary shrink-0 px-2.5 py-1.5 text-xs">
        {busy ? <Spinner className="size-3.5" /> : <CheckCircle2 className="size-3.5" />} Done
      </button>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard') });
  const graph = useQuery({ queryKey: ['graph'], queryFn: () => api<GraphData>('/graph') });
  const complete = useCompleteFix();
  const invalidate = useInvalidateFootprint();
  const [reviewing, setReviewing] = useState(false);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const d = q.data;
  const o = d.overall;

  const first = d.history[0];
  const delta = first ? o.score - first.score : 0;
  const reviewDue =
    d.user.reviewIntervalDays > 0 &&
    Date.now() - parseServerDate(d.user.lastReviewAt ?? d.user.createdAt).getTime() > d.user.reviewIntervalDays * 86_400_000;

  async function markReviewed() {
    setReviewing(true);
    try {
      await post('/me/review');
      toast({ tone: 'success', title: 'Review recorded', body: `Next reminder in ${d.user.reviewIntervalDays} days.` });
      invalidate();
    } finally {
      setReviewing(false);
    }
  }

  if (o.counts.total === 0)
    return (
      <>
        <PageHeader title="Privacy dashboard" />
        <div className="card card-pad flex flex-col items-center py-16 text-center">
          <ScoreGauge score={100} label="Nothing tracked yet" />
          <p className="mt-6 max-w-md text-ink-300">Add your accounts, phone numbers and connected apps to see how exposed you really are.</p>
          <div className="mt-6 flex gap-2">
            <Link to="/inventory?add=1" className="btn-primary">Add your first account</Link>
            <Link to="/settings" className="btn-secondary">Load sample data</Link>
          </div>
        </div>
      </>
    );

  return (
    <>
      <PageHeader
        title="Privacy dashboard"
        subtitle={`${o.counts.total} accounts, numbers and apps tracked · ${d.fixCount} recommended fixes`}
        actions={
          <Link to="/fixes" className="btn-primary">
            Start fixing <ArrowRight className="size-4" />
          </Link>
        }
      />

      {reviewDue && (
        <div className="card mb-6 flex flex-wrap items-center gap-4 border-cyan-500/30 bg-cyan-500/5 px-5 py-4">
          <CalendarClock className="size-6 text-cyan-300" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink-100">Your periodic privacy review is due</p>
            <p className="text-sm text-ink-400">Check for new accounts, apps you no longer use, and anything that changed. Then mark it done.</p>
          </div>
          <button className="btn-secondary" onClick={markReviewed} disabled={reviewing}>
            {reviewing && <Spinner className="size-4" />} Mark review complete
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="card card-pad flex flex-col items-center justify-center text-center">
          <p className="mb-3 self-start text-sm font-semibold text-ink-200">Overall privacy score</p>
          <ScoreGauge score={o.score} label={scoreLabel(o.score)} size={220} />
          <div className="mt-4 grid w-full grid-cols-3 gap-2 text-left">
            {[
              { label: 'Account security', value: 1 - o.securityRisk },
              { label: 'Data privacy', value: 1 - o.privacyExposure },
              { label: '2FA coverage', value: 1 - o.hygieneGap },
            ].map((m) => (
              <div key={m.label} className="rounded-lg bg-ink-850 px-2.5 py-2">
                <p className="text-[11px] text-ink-400">{m.label}</p>
                <p className="font-semibold" style={{ color: scoreColor(m.value * 100) }}>
                  {Math.round(m.value * 100)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-400">
            Completing the top 5 fixes would raise your score to about{' '}
            <span className="font-semibold text-emerald-300">{d.potentialScore}</span>.
          </p>
        </div>

        <div className="card card-pad flex flex-col lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="section-title">Improvement over time</p>
            {first && (
              <span className={clsx('chip', delta >= 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300')}>
                <TrendingUp className="size-3" />
                {delta >= 0 ? '+' : ''}
                {delta} since {timeAgo(first.createdAt)}
              </span>
            )}
          </div>
          <div className="h-56 lg:h-auto lg:min-h-56 lg:flex-1">
            <HistoryChart history={d.history} />
          </div>
          {d.recentActions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-700 pt-3">
              {d.recentActions.slice(0, 3).map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 text-xs text-ink-400">
                  <CheckCircle2 className="size-3.5 text-emerald-400" />
                  <span className="max-w-64 truncate text-ink-300">{a.title}</span>
                  <span>· {timeAgo(a.createdAt)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'Critical / high', value: `${o.counts.critical} / ${o.counts.high}`, icon: AlertTriangle, tone: 'text-rose-300', to: '/inventory?risk=critical,high' },
          { label: 'Single points of failure', value: o.counts.spofs, icon: CircleDot, tone: 'text-orange-300', to: '/inventory?spof=true' },
          { label: 'Open breaches', value: d.openBreaches, icon: Siren, tone: d.openBreaches ? 'text-rose-300' : 'text-ink-100', to: '/alerts' },
          { label: 'Without 2FA', value: o.counts.no2fa, icon: ShieldOff, tone: 'text-yellow-200', to: '/inventory?twofa=none' },
          { label: 'Reused passwords', value: o.counts.reused, icon: KeyRound, tone: 'text-violet-300', to: '/inventory?reused=true' },
          { label: 'Tracked', value: o.counts.total, icon: Users, tone: 'text-ink-100', to: '/inventory' },
        ].map((s) => (
          <Link key={s.label} to={s.to} className="card card-pad group transition hover:border-ink-500">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-ink-400">{s.label}</p>
              <s.icon className="size-4 text-ink-500 group-hover:text-ink-300" />
            </div>
            <p className={clsx('mt-2 text-2xl font-semibold', s.tone)}>{s.value}</p>
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
        <div className="card flex flex-col xl:col-span-2">
          <div className="flex items-center justify-between px-5 pt-5">
            <p className="section-title">Connection graph</p>
            <Link to="/graph" className="text-xs font-medium text-brand-300 hover:underline">
              Open full exposure map →
            </Link>
          </div>
          <div className="h-[380px] xl:h-auto xl:min-h-[380px] xl:flex-1">
            {graph.data ? (
              <ExposureGraph data={graph.data} compact onSelect={(id) => id && navigate(`/accounts/${id}`)} />
            ) : (
              <PageLoader />
            )}
          </div>
          <div className="border-t border-ink-700 px-5 py-3">
            <GraphLegend />
          </div>
        </div>

        <div className="card card-pad">
          <p className="section-title">Single points of failure</p>
          <p className="mt-0.5 text-xs text-ink-400">If one of these falls, everything listed under it can be taken over.</p>
          <div className="mt-3 space-y-3">
            {d.spofs.length === 0 && <p className="py-6 text-center text-sm text-ink-400">No single points of failure. Nice.</p>}
            {d.spofs.slice(0, 5).map((s) => (
              <Link key={s.id} to={`/accounts/${s.id}`} className="block rounded-xl border border-ink-700 bg-ink-850 p-3 transition hover:border-ink-500">
                <div className="flex items-center gap-3">
                  <ServiceIcon kind={s.kind} serviceType={s.serviceType} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-ink-400">
                      Unlocks <span className="font-semibold text-orange-300">{s.count}</span> accounts · {Math.round(s.P * 100)}% chance of compromise
                    </p>
                  </div>
                  <RiskBadge level={s.level} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.dependents.slice(0, 6).map((dep) => (
                    <span key={dep.id} className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-300">
                      {dep.name}
                    </span>
                  ))}
                  {s.dependents.length > 6 && <span className="px-1 text-[11px] text-ink-500">+{s.count - 6} more</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <div className="card card-pad">
          <div className="flex items-center justify-between">
            <p className="section-title">Riskiest accounts</p>
            <Link to="/inventory" className="text-xs font-medium text-brand-300 hover:underline">
              View all →
            </Link>
          </div>
          <div className="mt-2 divide-y divide-ink-800">
            {d.riskiest.map((a) => (
              <Link key={a.id} to={`/accounts/${a.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-ink-850">
                <ServiceIcon kind={a.kind} serviceType={a.serviceType} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <span className="font-mono text-sm" style={{ color: LEVEL_STYLES[a.level].hex }}>
                      {a.risk}
                    </span>
                  </div>
                  <p className="mb-1.5 truncate text-xs text-ink-400">{a.reason}</p>
                  <RiskBar value={a.risk} level={a.level} />
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="card card-pad">
          <div className="flex items-center justify-between">
            <p className="section-title">Top fixes by risk removed</p>
            <Link to="/fixes" className="text-xs font-medium text-brand-300 hover:underline">
              All {d.fixCount} fixes →
            </Link>
          </div>
          <div className="divide-y divide-ink-800">
            {d.topFixes.length === 0 && <p className="py-8 text-center text-sm text-ink-400">Nothing left to fix. 🎉</p>}
            {d.topFixes.map((f) => (
              <FixRow key={f.key} fix={f} compact busy={complete.isPending && complete.variables?.key === f.key} onDo={() => complete.mutate(f)} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
