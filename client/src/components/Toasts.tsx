import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ShieldAlert, Bell, CheckCircle2, Info } from 'lucide-react';
import clsx from 'clsx';

export interface ToastInput {
  title: string;
  body?: string;
  tone?: 'default' | 'success' | 'danger' | 'info';
  href?: string;
}
interface ToastItem extends ToastInput {
  id: number;
}

let push: (t: ToastInput) => void = () => {};
let seq = 0;

export function toast(t: ToastInput) {
  push(t);
}

const ICONS = { default: Bell, success: CheckCircle2, danger: ShieldAlert, info: Info };
const TONES = {
  default: 'border-ink-600',
  success: 'border-emerald-500/50',
  danger: 'border-rose-500/60',
  info: 'border-cyan-500/50',
};
const ICON_TONES = { default: 'text-ink-300', success: 'text-emerald-400', danger: 'text-rose-400', info: 'text-cyan-400' };

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    push = (t) => {
      const id = ++seq;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === 'danger' ? 9000 : 5000);
    };
    return () => {
      push = () => {};
    };
  }, []);
  const close = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {items.map((t) => {
        const tone = t.tone ?? 'default';
        const Icon = ICONS[tone];
        const content = (
          <div className="flex gap-3">
            <Icon className={clsx('mt-0.5 size-5 shrink-0', ICON_TONES[tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-100">{t.title}</p>
              {t.body && <p className="mt-0.5 line-clamp-3 text-xs text-ink-300">{t.body}</p>}
            </div>
          </div>
        );
        return (
          <div key={t.id} className={clsx('animate-fade-in pointer-events-auto relative rounded-xl border bg-ink-850/95 p-3.5 pr-9 shadow-2xl backdrop-blur', TONES[tone])}>
            {t.href ? (
              <Link to={t.href} onClick={() => close(t.id)} className="block">
                {content}
              </Link>
            ) : (
              content
            )}
            <button onClick={() => close(t.id)} className="absolute top-2.5 right-2.5 rounded p-0.5 text-ink-400 hover:text-ink-100" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
