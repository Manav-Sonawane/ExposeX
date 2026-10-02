import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, EyeOff, RotateCcw, Sparkles, Timer, Trophy } from 'lucide-react';
import { api, post } from '../lib/api';
import { useInvalidateFootprint } from '../lib/hooks';
import { FIX_CATEGORY, scoreColor, timeAgo } from '../lib/format';
import type { ActionLog, Fix } from '../lib/types';
import { ChipSelect, EmptyState, ErrorState, PageHeader, PageLoader, Spinner } from '../components/ui';
import { useCompleteFix } from './Dashboard';

interface FixesResponse {
  fixes: Fix[];
  score: number;
  scoreExact: number;
  completed: ActionLog[];
  dismissed: { key: string; title: string | null }[];
}

const PRIORITY = {
  urgent: { label: 'Do these first', tone: 'text-rose-300', dot: 'bg-rose-500' },
  high: { label: 'High impact', tone: 'text-orange-300', dot: 'bg-orange-400' },
  medium: { label: 'Worth doing', tone: 'text-yellow-200', dot: 'bg-yellow-400' },
  low: { label: 'Nice to have', tone: 'text-emerald-300', dot: 'bg-emerald-400' },
} as const;

const EFFORT = ['', '2 min', '10 min', '30 min'];

export default function Fixes() {
  const q = useQuery({ queryKey: ['fixes'], queryFn: () => api<FixesResponse>('/fixes') });
  const complete = useCompleteFix();
  const invalidate = useInvalidateFootprint();
  const [cats, setCats] = useState<string[]>([]);
  const [tab, setTab] = useState<'todo' | 'done' | 'dismissed'>('todo');
  const dismiss = useMutation({ mutationFn: (f: Fix) => post('/fixes/dismiss', { key: f.key, title: f.title }), onSuccess: () => invalidate() });
  const restore = useMutation({ mutationFn: (key: string) => post('/fixes/restore', { key }), onSuccess: () => invalidate() });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { fixes, score, scoreExact, completed, dismissed } = q.data;
  const shown = fixes.filter((f) => !cats.length || cats.includes(f.category));
  const top5 = Math.min(100, Math.round(scoreExact + fixes.slice(0, 5).reduce((s, f) => s + f.gain, 0)));
  const gained = completed.reduce((s, a) => s + Math.max(0, (a.scoreAfter ?? 0) - (a.scoreBefore ?? 0)), 0);

  const groups = (['urgent', 'high', 'medium', 'low'] as const).map((p) => ({ p, items: shown.filter((f) => f.priority === p) })).filter((g) => g.items.length);

  return (
    <>
      <PageHeader title="Fix checklist" subtitle="Every action is simulated against your whole network and ranked by how much total risk it removes." />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="card card-pad">
          <p className="text-xs font-medium text-ink-400 uppercase">Current score</p>
          <p className="mt-1 text-3xl font-semibold" style={{ color: scoreColor(score) }}>{score}</p>
        </div>
        <div className="card card-pad">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-400 uppercase">
            <Sparkles className="size-3.5 text-brand-300" /> After the top 5 fixes
          </p>
          <p className="mt-1 text-3xl font-semibold" style={{ color: scoreColor(top5) }}>
            ~{top5} <span className="text-base text-emerald-300">+{top5 - score}</span>
          </p>
        </div>
        <div className="card card-pad">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-400 uppercase">
            <Trophy className="size-3.5 text-yellow-300" /> Completed
          </p>
          <p className="mt-1 text-3xl font-semibold">
            {completed.length} <span className="text-base text-emerald-300">+{gained} pts</span>
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-ink-600 bg-ink-850 p-0.5">
          {(
            [
              ['todo', `To do (${fixes.length})`],
              ['done', `Completed (${completed.length})`],
              ['dismissed', `Dismissed (${dismissed.length})`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx('rounded-md px-3 py-1.5 text-xs font-medium', tab === k ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200')}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'todo' && (
          <ChipSelect options={Object.entries(FIX_CATEGORY).map(([value, v]) => ({ value, label: v.label }))} value={cats} onChange={setCats} />
        )}
      </div>

      {tab === 'todo' &&
        (groups.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="All clear" body={cats.length ? 'No fixes in these categories.' : 'You have completed every recommended fix. Keep your inventory up to date and review it periodically.'} />
        ) : (
          <div className="space-y-6">
            {groups.map(({ p, items }) => (
              <section key={p}>
                <h2 className={clsx('mb-2 flex items-center gap-2 text-sm font-semibold', PRIORITY[p].tone)}>
                  <span className={clsx('size-2 rounded-full', PRIORITY[p].dot)} /> {PRIORITY[p].label}
                  <span className="text-ink-500">· {items.length}</span>
                </h2>
                <div className="card divide-y divide-ink-800">
                  {items.map((f) => {
                    const cat = FIX_CATEGORY[f.category];
                    const busy = complete.isPending && complete.variables?.key === f.key;
                    return (
                      <div key={f.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                        <span className="hidden size-8 shrink-0 items-center justify-center rounded-full bg-ink-800 font-mono text-sm text-ink-300 sm:flex">{f.rank}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-ink-100">{f.title}</p>
                          <p className="mt-0.5 text-sm text-ink-400">{f.detail}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className={clsx('chip', cat.color)}>{cat.label}</span>
                            <span className="inline-flex items-center gap-1 text-ink-400">
                              <Timer className="size-3" /> {EFFORT[f.effort]}
                            </span>
                            <Link to={`/accounts/${f.accountId}`} className="text-ink-400 hover:text-brand-300">View account →</Link>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-4">
                          <div className="w-28 text-right">
                            <p className="text-lg font-semibold text-emerald-300">+{f.gain.toFixed(1)}</p>
                            <p className="text-[11px] text-ink-400">−{(f.reduction * 100).toFixed(1)}% network risk</p>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => complete.mutate(f)} disabled={busy}>
                              {busy ? <Spinner className="size-3.5 text-ink-950" /> : <CheckCircle2 className="size-3.5" />} Mark done
                            </button>
                            <button className="btn-ghost px-3 py-1 text-xs" onClick={() => dismiss.mutate(f)}>
                              <EyeOff className="size-3.5" /> Not for me
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ))}

      {tab === 'done' &&
        (completed.length === 0 ? (
          <EmptyState icon={Trophy} title="No fixes completed yet" body="Mark a fix as done once you've made the change. Your score history updates automatically." />
        ) : (
          <div className="card divide-y divide-ink-800">
            {completed.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-100">{a.title}</p>
                  <p className="text-xs text-ink-400">{timeAgo(a.createdAt)}</p>
                </div>
                <span className="font-mono text-sm text-ink-300">
                  {a.scoreBefore} → <span className="text-emerald-300">{a.scoreAfter}</span>
                </span>
              </div>
            ))}
          </div>
        ))}

      {tab === 'dismissed' &&
        (dismissed.length === 0 ? (
          <EmptyState icon={EyeOff} title="Nothing dismissed" />
        ) : (
          <div className="card divide-y divide-ink-800">
            {dismissed.map((d) => (
              <div key={d.key} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="text-sm text-ink-300">{d.title ?? d.key}</span>
                <button className="btn-ghost shrink-0 text-xs" onClick={() => restore.mutate(d.key)}>
                  <RotateCcw className="size-3.5" /> Restore
                </button>
              </div>
            ))}
          </div>
        ))}
    </>
  );
}
