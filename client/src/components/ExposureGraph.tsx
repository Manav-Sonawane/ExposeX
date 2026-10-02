import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { LEVEL_STYLES, LINK_COLORS } from '../lib/format';
import type { GraphData } from '../lib/types';

export interface Simulation {
  sourceId: number;
  probs: Map<number, number>; // node id -> takeover probability
  pathEdges: Set<string>; // "src-dst-type"
}

interface Props {
  data: GraphData;
  selectedId?: number | null;
  onSelect?: (id: number | null) => void;
  simulation?: Simulation | null;
  colorBy?: 'risk' | 'reuse';
  compact?: boolean;
  className?: string;
}

const REUSE_PALETTE = ['#a78bfa', '#f472b6', '#38bdf8', '#facc15', '#4ade80', '#fb923c', '#e879f9', '#2dd4bf'];

function nodeColor(n: GraphData['nodes'][number], colorBy: 'risk' | 'reuse', groups: GraphData['groups']) {
  if (colorBy === 'reuse') {
    if (!n.passwordGroupId) return '#334155';
    const idx = groups.findIndex((g) => g.id === n.passwordGroupId);
    return REUSE_PALETTE[idx % REUSE_PALETTE.length];
  }
  return LEVEL_STYLES[n.level].hex;
}

function toElements(data: GraphData, colorBy: 'risk' | 'reuse', compact: boolean): ElementDefinition[] {
  const maxBlast = Math.max(1, ...data.nodes.map((n) => n.blastCount));
  const nodes: ElementDefinition[] = data.nodes.map((n) => ({
    group: 'nodes',
    data: {
      id: String(n.id),
      label: n.name.length > 22 ? `${n.name.slice(0, 20)}…` : n.name,
      color: nodeColor(n, colorBy, data.groups),
      size: (compact ? 18 : 26) + (compact ? 22 : 34) * Math.sqrt(n.blastCount / maxBlast) + n.importance * 1.5,
      kind: n.kind,
      spof: n.spof ? 1 : 0,
    },
  }));
  const edges: ElementDefinition[] = data.edges.map((e) => ({
    group: 'edges',
    data: {
      id: `${e.sourceId}-${e.targetId}-${e.type}`,
      source: String(e.sourceId),
      target: String(e.targetId),
      color: LINK_COLORS[e.type] ?? '#64748b',
      width: 1 + e.t * 3,
      type: e.type,
    },
  }));
  return [...nodes, ...edges];
}

export default function ExposureGraph({ data, selectedId, onSelect, simulation, colorBy = 'risk', compact = false, className }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const signature = useRef('');

  // Create once.
  useEffect(() => {
    const cy = cytoscape({
      container: container.current,
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.25,
      boxSelectionEnabled: false,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.9,
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            color: '#cbd5e1',
            'font-size': compact ? 9 : 11,
            'font-family': 'Inter, sans-serif',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-outline-color': '#070b14',
            'text-outline-width': 2,
            'border-width': 2,
            'border-color': '#0b1120',
            'transition-property': 'opacity, background-color, border-color, border-width',
            'transition-duration': 250,
          },
        },
        { selector: 'node[kind = "phone"]', style: { shape: 'round-diamond' } },
        { selector: 'node[kind = "app"]', style: { shape: 'round-hexagon' } },
        { selector: 'node[spof = 1]', style: { 'border-width': 4, 'border-color': '#f8fafc', 'border-style': 'double' } },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'curve-style': 'bezier',
            opacity: 0.55,
            'transition-property': 'opacity, line-color, width',
            'transition-duration': 250,
          },
        },
        { selector: 'edge[type = "linked"]', style: { 'line-style': 'dashed' } },
        { selector: 'node.selected', style: { 'border-color': '#22d3ee', 'border-width': 4 } },
        { selector: '.faded', style: { opacity: 0.12 } },
        { selector: 'edge.hl', style: { opacity: 1, width: 3.5, 'z-index': 10 } },
        { selector: 'node.compromised', style: { 'background-color': '#f43f5e', 'border-color': '#fecdd3' } },
        { selector: 'node.source', style: { 'background-color': '#be123c', 'border-color': '#fff', 'border-width': 5 } },
      ],
    });
    cy.on('tap', 'node', (e) => onSelectRef.current?.(Number(e.target.id())));
    cy.on('tap', (e) => {
      if (e.target === cy) onSelectRef.current?.(null);
    });
    cy.on('mouseover', 'node', () => container.current && (container.current.style.cursor = 'pointer'));
    cy.on('mouseout', 'node', () => container.current && (container.current.style.cursor = 'default'));
    cyRef.current = cy;
    // A fresh instance has no elements yet (React StrictMode mounts twice in dev),
    // so force the sync effect below to add them and run the layout.
    signature.current = '';

    // Keep the canvas sized to its container and re-fit when it changes.
    let lastSize = '';
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const size = `${Math.round(width)}x${Math.round(height)}`;
      if (!width || !height || size === lastSize) return;
      const first = lastSize === '' || lastSize.startsWith('0x') || lastSize.endsWith('x0');
      lastSize = size;
      cy.resize();
      if (first || cy.elements().length) cy.fit(undefined, compact ? 16 : 40);
    });
    if (container.current) ro.observe(container.current);

    return () => {
      ro.disconnect();
      cyRef.current = null;
      cy.destroy();
    };
  }, [compact]);

  // Sync elements; only re-run layout when the set of nodes/edges changes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const els = toElements(data, colorBy, compact);
    const sig = els.map((e) => e.data.id).sort().join('|');
    if (sig !== signature.current) {
      const positions = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }]));
      cy.elements().remove();
      cy.add(els);
      const fresh = cy.nodes().filter((n) => !positions.has(n.id()));
      cy.nodes().forEach((n) => {
        const p = positions.get(n.id());
        if (p) n.position(p);
      });
      const firstRun = positions.size === 0 || fresh.length > cy.nodes().length / 3;
      cy.layout({
        name: 'cose',
        animate: !firstRun,
        animationDuration: 500,
        randomize: firstRun,
        fit: true,
        padding: compact ? 16 : 40,
        nodeRepulsion: () => (compact ? 9000 : 16000),
        idealEdgeLength: () => (compact ? 60 : 95),
        edgeElasticity: () => 80,
        gravity: 0.35,
        numIter: 1500,
        nodeDimensionsIncludeLabels: true,
      } as cytoscape.LayoutOptions).run();
      signature.current = sig;
    } else {
      for (const el of els) cy.getElementById(el.data.id!).data(el.data);
    }
  }, [data, colorBy, compact]);

  // Selection & simulation styling.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('faded hl compromised source selected');
      if (simulation) {
        cy.nodes().forEach((n) => {
          const id = Number(n.id());
          if (id === simulation.sourceId) n.addClass('source');
          else if ((simulation.probs.get(id) ?? 0) >= 0.4) n.addClass('compromised');
          else if ((simulation.probs.get(id) ?? 0) < 0.05) n.addClass('faded');
        });
        cy.edges().forEach((e) => {
          if (simulation.pathEdges.has(e.id())) e.addClass('hl');
          else e.addClass('faded');
        });
      } else if (selectedId != null) {
        const node = cy.getElementById(String(selectedId));
        if (node.nonempty()) {
          node.addClass('selected');
          const hood = node.closedNeighborhood();
          cy.elements().not(hood).addClass('faded');
          hood.edges().addClass('hl');
        }
      }
    });
  }, [selectedId, simulation, data]);

  return <div ref={container} className={className ?? 'h-full w-full'} />;
}

export function GraphLegend({ colorBy = 'risk' }: { colorBy?: 'risk' | 'reuse' }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-400">
      {colorBy === 'risk' &&
        (['critical', 'high', 'medium', 'low'] as const).map((l) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: LEVEL_STYLES[l].hex }} />
            {LEVEL_STYLES[l].label}
          </span>
        ))}
      {colorBy === 'reuse' && (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-slate-600" /> Unique password · colors = shared-password groups
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rotate-45 rounded-[2px] border border-ink-400" /> Phone
      </span>
      <span className="inline-flex items-center gap-1.5">⬢ App</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full border-[3px] border-double border-white" /> Single point of failure
      </span>
      {Object.entries({ recovery_email: 'Recovery email', recovery_phone: 'Recovery phone', sso: 'SSO', oauth: 'App access', controls: 'Controls', linked: 'Linked' }).map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: LINK_COLORS[k] }} />
          {v}
        </span>
      ))}
    </div>
  );
}
