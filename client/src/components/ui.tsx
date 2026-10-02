import { useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import { X, Mail, Smartphone, Puzzle, Landmark, Users, ShoppingBag, Cloud, Briefcase, Code2, Gamepad2, HeartPulse, Plane, Film, Fingerprint, MessageCircle, Building2, Radio, Wrench, Globe, Loader2 } from 'lucide-react';
import { LEVEL_STYLES, scoreColor } from '../lib/format';
import type { Kind, Level } from '../lib/types';

export function RiskBadge({ level, risk, className }: { level: Level; risk?: number; className?: string }) {
  const s = LEVEL_STYLES[level];
  return (
    <span className={clsx('chip', s.text, s.bg, s.border, className)}>
      <span className="size-1.5 rounded-full" style={{ background: s.hex }} />
      {s.label}
      {risk !== undefined && <span className="font-mono opacity-80">{risk}</span>}
    </span>
  );
}

export function RiskBar({ value, level }: { value: number; level: Level }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, value)}%`, background: LEVEL_STYLES[level].hex }} />
    </div>
  );
}

const SERVICE_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  identity: Fingerprint,
  finance: Landmark,
  government: Building2,
  cloud: Cloud,
  work: Briefcase,
  health: HeartPulse,
  dev: Code2,
  social: Users,
  communication: MessageCircle,
  shopping: ShoppingBag,
  travel: Plane,
  entertainment: Film,
  gaming: Gamepad2,
  carrier: Radio,
  utility: Wrench,
  other: Globe,
};

export function ServiceIcon({ kind, serviceType, className }: { kind: Kind; serviceType: string; className?: string }) {
  const Icon = kind === 'phone' ? Smartphone : kind === 'app' ? Puzzle : SERVICE_ICONS[serviceType] ?? Globe;
  return (
    <span className={clsx('inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-200', className)}>
      <Icon className="size-[18px]" />
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-ink-400', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="card card-pad border-rose-500/30 text-sm text-rose-300">
      {error instanceof Error ? error.message : 'Something went wrong.'}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: typeof Mail; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-600 px-6 py-12 text-center">
      <Icon className="mb-3 size-8 text-ink-500" />
      <p className="font-semibold text-ink-200">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-ink-400">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx('card animate-fade-in my-8 w-full', wide ? 'max-w-3xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
          <h2 className="font-semibold text-ink-100">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Semi-circular score gauge. */
export function ScoreGauge({ score, size = 200, label }: { score: number; size?: number; label?: string }) {
  const stroke = size * 0.085;
  const r = (size - stroke) / 2;
  const c = Math.PI * r;
  const color = scoreColor(score);
  const h = size / 2 + stroke;
  return (
    <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} role="img" aria-label={`Privacy score ${score} out of 100`}>
      <path d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`} fill="none" stroke="var(--color-ink-700)" strokeWidth={stroke} strokeLinecap="round" />
      <path
        d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`}
        style={{ transition: 'stroke-dasharray 0.8s ease, stroke 0.4s' }}
      />
      <text x="50%" y={size / 2 - size * 0.04} textAnchor="middle" fill="var(--color-ink-100)" fontSize={size * 0.24} fontWeight={700}>
        {score}
      </text>
      {label && (
        <text x="50%" y={size / 2 + size * 0.09} textAnchor="middle" fill={color} fontSize={size * 0.07} fontWeight={600}>
          {label}
        </text>
      )}
    </svg>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="card card-pad">
      <p className="text-xs font-medium tracking-wide text-ink-400 uppercase">{label}</p>
      <p className={clsx('mt-1.5 text-2xl font-semibold', tone ?? 'text-ink-100')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-400">{sub}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-200">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-5 w-9 rounded-full transition', checked ? 'bg-brand-500' : 'bg-ink-600')}
      >
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

/** Multi-select chips used by forms and filters. */
export function ChipSelect({ options, value, onChange, className }: { options: { value: string; label: string; hint?: string }[]; value: string[]; onChange: (v: string[]) => void; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={clsx(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition',
              on ? 'border-brand-400/60 bg-brand-500/15 text-brand-300' : 'border-ink-600 bg-ink-850 text-ink-300 hover:border-ink-500 hover:text-ink-100',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
