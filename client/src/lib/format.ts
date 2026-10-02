import type { Level } from './types';

export const LEVEL_STYLES: Record<Level, { text: string; bg: string; border: string; hex: string; label: string }> = {
  critical: { text: 'text-rose-300', bg: 'bg-rose-500/15', border: 'border-rose-500/40', hex: '#f43f5e', label: 'Critical' },
  high: { text: 'text-orange-300', bg: 'bg-orange-500/15', border: 'border-orange-500/40', hex: '#fb923c', label: 'High' },
  medium: { text: 'text-yellow-200', bg: 'bg-yellow-400/10', border: 'border-yellow-400/40', hex: '#facc15', label: 'Medium' },
  low: { text: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', hex: '#34d399', label: 'Low' },
};

export function scoreColor(score: number) {
  if (score >= 80) return '#34d399';
  if (score >= 60) return '#a3e635';
  if (score >= 40) return '#facc15';
  if (score >= 25) return '#fb923c';
  return '#f43f5e';
}

export function scoreLabel(score: number) {
  if (score >= 80) return 'Well protected';
  if (score >= 60) return 'Fair';
  if (score >= 40) return 'Exposed';
  if (score >= 25) return 'Highly exposed';
  return 'Critical';
}

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export function parseServerDate(s: string) {
  // SQLite datetime('now') is UTC without a zone marker.
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
}

export function timeAgo(s: string | null | undefined) {
  if (!s) return 'never';
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : parseServerDate(s);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [86400 * 30, 'month'],
    [86400 * 365, 'year'],
  ];
  let unit = units[0];
  for (const u of units) if (Math.abs(sec) >= u[0]) unit = u;
  const n = Math.round(sec / unit[0]);
  return `${n} ${unit[1]}${n === 1 ? '' : 's'} ago`;
}

export function inactiveLabel(days: number | null) {
  if (days === null) return 'Unknown';
  if (days <= 1) return 'Today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export const ACTIVITY_LABELS: Record<string, string> = {
  active30: 'Used in last 30 days',
  active90: 'Used in last 90 days',
  stale: '3–12 months ago',
  dormant: 'Over a year ago',
  unknown: 'Unknown',
};

export const FIX_CATEGORY: Record<string, { label: string; color: string }> = {
  breach: { label: 'Breach', color: 'text-rose-300 bg-rose-500/10 border-rose-500/30' },
  '2fa': { label: '2FA', color: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30' },
  password: { label: 'Password', color: 'text-violet-300 bg-violet-500/10 border-violet-500/30' },
  permission: { label: 'Permission', color: 'text-amber-200 bg-amber-500/10 border-amber-500/30' },
  cleanup: { label: 'Cleanup', color: 'text-slate-300 bg-slate-500/10 border-slate-500/30' },
  phone: { label: 'Phone', color: 'text-sky-300 bg-sky-500/10 border-sky-500/30' },
  recovery: { label: 'Recovery', color: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30' },
};

export const LINK_COLORS: Record<string, string> = {
  recovery_email: '#a78bfa',
  recovery_phone: '#38bdf8',
  sso: '#22d3ee',
  oauth: '#fb923c',
  controls: '#f43f5e',
  linked: '#64748b',
};
