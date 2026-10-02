import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Crosshair, X, ArrowRight, CircleDot, Palette } from 'lucide-react';
import { api } from '../lib/api';
import { useMeta } from '../lib/hooks';
import { LINK_COLORS, pct } from '../lib/format';
import type { GraphData } from '../lib/types';
import { EmptyState, ErrorState, PageHeader, PageLoader, RiskBadge, ServiceIcon } from '../components/ui';
import ExposureGraph, { GraphLegend, type Simulation } from '../components/ExposureGraph';

export default function GraphPage() {
  const meta = useMeta().data;
  const q = useQuery({ queryKey: ['graph'], queryFn: () => api<GraphData>('/graph') });
  const [selected, setSelected] = useState<number | null>(null);
  const [attackMode, setAttackMode] = useState(false);
  const [colorBy, setColorBy] = useState<'risk' | 'reuse'>('risk');

  const byId = useMemo(() => new Map((q.data?.nodes ?? []).map((n) => [n.id, n])), [q.data]);
  const node = selected != null ? byId.get(selected) : undefined;

  const simulation: Simulation | null = useMemo(() => {
    if (!attackMode || !node) return null;
    const probs = new Map<number, number>([[node.id, 1]]);
    const pathEdges = new Set<string>();
    for (const d of node.dependents) {
      probs.set(d.id, d.prob);
      if (d.prob >= 0.05) for (const s of d.path) pathEdges.add(`${s.from}-${s.to}-${s.type}`);
    }
    return { sourceId: node.id, probs, pathEdges };
  }, [attackMode, node]);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const data = q.data;

  if (data.nodes.length === 0)
    return (
      <>
        <PageHeader title="Exposure map" />
        <EmptyState icon={Crosshair} title="Nothing to map yet" body="Add accounts and their recovery links to see your exposure graph." action={<Link to="/inventory?add=1" className="btn-primary">Add an account</Link>} />
      </>
    );

  const falls = node ? node.dependents.filter((d) => d.prob >= 0.4) : [];
  const inbound = node ? data.edges.filter((e) => e.targetId === node.id) : [];
  const outbound = node ? data.edges.filter((e) => e.sourceId === node.id) : [];

  return (
    <>
      <PageHeader
        title="Exposure map"
        subtitle="Arrows point from an account to what it can unlock. Bigger nodes unlock more."
        actions={
          <>
            <button className={clsx('btn-secondary', colorBy === 'reuse' && 'border-violet-400/50 text-violet-300')} onClick={() => setColorBy((c) => (c === 'risk' ? 'reuse' : 'risk'))}>
              <Palette className="size-4" /> {colorBy === 'risk' ? 'Color by risk' : 'Color by password reuse'}
            </button>
            <button
              className={clsx('btn-secondary', attackMode && 'border-rose-500/60 bg-rose-500/10 text-rose-200')}
              onClick={() => setAttackMode((m) => !m)}
              aria-pressed={attackMode}
            >
              <Crosshair className="size-4" /> {attackMode ? 'Attack simulation on' : 'Simulate compromise'}
            </button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="card relative flex flex-col overflow-hidden">
          {attackMode && !node && (
            <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-rose-500/40 bg-ink-900/90 px-4 py-1.5 text-xs text-rose-200 backdrop-blur">
              Click any node to see what an attacker could reach from it
            </div>
          )}
          <div className="h-[calc(100vh-260px)] min-h-[480px]">
            <ExposureGraph data={data} selectedId={selected} onSelect={setSelected} simulation={simulation} colorBy={colorBy} />
          </div>
          <div className="border-t border-ink-700 px-5 py-3">
            <GraphLegend colorBy={colorBy} />
          </div>
        </div>

        <aside className="card card-pad h-fit">
          {!node ? (
            <div className="text-sm text-ink-400">
              <p className="section-title mb-2">Explore your network</p>
              <p>Select a node to inspect it. Turn on <span className="text-rose-300">Simulate compromise</span> to trace what an attacker could reach from any account.</p>
              <p className="mt-4 label">Single points of failure</p>
              <ul className="space-y-1.5">
                {data.nodes
                  .filter((n) => n.spof)
                  .sort((a, b) => b.blastCount - a.blastCount)
                  .map((n) => (
                    <li key={n.id}>
                      <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink-800" onClick={() => setSelected(n.id)}>
                        <CircleDot className="size-4 text-orange-300" />
                        <span className="flex-1 text-ink-200">{n.name}</span>
                        <span className="text-xs">unlocks {n.blastCount}</span>
                      </button>
                    </li>
                  ))}
                {!data.nodes.some((n) => n.spof) && <li>None found.</li>}
              </ul>
            </div>
          ) : (
            <div>
              <div className="flex items-start gap-3">
                <ServiceIcon kind={node.kind} serviceType={node.serviceType} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{node.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <RiskBadge level={node.level} risk={node.risk} />
                    {node.spof && <span className="chip border-orange-500/40 bg-orange-500/10 text-orange-300">SPOF</span>}
                  </div>
                </div>
                <button className="btn-ghost p-1" onClick={() => setSelected(null)} aria-label="Clear selection">
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-ink-850 p-2">
                  <p className="text-[11px] text-ink-400">Compromise chance</p>
                  <p className="font-semibold">{pct(node.P)}</p>
                </div>
                <div className="rounded-lg bg-ink-850 p-2">
                  <p className="text-[11px] text-ink-400">Inherited</p>
                  <p className="font-semibold text-orange-300">{pct(node.inherited)}</p>
                </div>
              </div>

              {attackMode ? (
                <div className="mt-4">
                  <p className="label text-rose-300">If {node.name} is compromised</p>
                  {falls.length === 0 ? (
                    <p className="text-sm text-ink-400">Nothing else falls with high probability.</p>
                  ) : (
                    <p className="mb-2 text-sm text-ink-300">
                      <span className="font-semibold text-rose-300">{falls.length}</span> account{falls.length === 1 ? '' : 's'} likely fall:
                    </p>
                  )}
                  <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                    {node.dependents.slice(0, 30).map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm hover:bg-ink-800">
                        <button className="truncate text-left text-ink-200 hover:text-brand-300" onClick={() => setSelected(d.id)}>
                          {byId.get(d.id)?.name}
                        </button>
                        <span className="font-mono text-xs" style={{ color: d.prob >= 0.6 ? '#f43f5e' : d.prob >= 0.4 ? '#fb923c' : '#7c8aa5' }}>
                          {pct(d.prob)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-4 space-y-4 text-sm">
                  <div>
                    <p className="label">Can be unlocked by ({inbound.length})</p>
                    {inbound.length === 0 && <p className="text-ink-500">Nothing</p>}
                    {inbound.map((e) => (
                      <button key={e.id} onClick={() => setSelected(e.sourceId)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-ink-800">
                        <span className="size-2 rounded-full" style={{ background: LINK_COLORS[e.type] }} />
                        <span className="flex-1 truncate">{byId.get(e.sourceId)?.name}</span>
                        <span className="text-xs text-ink-500">{meta?.linkTypes[e.type]?.label}</span>
                      </button>
                    ))}
                  </div>
                  <div>
                    <p className="label">Unlocks ({outbound.length})</p>
                    {outbound.length === 0 && <p className="text-ink-500">Nothing</p>}
                    {outbound.map((e) => (
                      <button key={e.id} onClick={() => setSelected(e.targetId)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-ink-800">
                        <span className="size-2 rounded-full" style={{ background: LINK_COLORS[e.type] }} />
                        <span className="flex-1 truncate">{byId.get(e.targetId)?.name}</span>
                        <span className="text-xs text-ink-500">{meta?.linkTypes[e.type]?.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Link to={`/accounts/${node.id}`} className="btn-secondary mt-5 w-full">
                Full details <ArrowRight className="size-4" />
              </Link>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
