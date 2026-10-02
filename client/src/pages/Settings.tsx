import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Upload, RefreshCw, Trash2, Save, CalendarClock, Siren, UserX } from 'lucide-react';
import { api, del, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useInvalidateFootprint } from '../lib/hooks';
import { timeAgo } from '../lib/format';
import type { User } from '../lib/types';
import { Modal, PageHeader, Spinner } from '../components/ui';
import { toast } from '../components/Toasts';

const SIM_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 2, label: 'Every 2 minutes (demo)' },
  { value: 60, label: 'Hourly' },
  { value: 60 * 24, label: 'Daily' },
  { value: 60 * 24 * 7, label: 'Weekly' },
];
const REVIEW_OPTIONS = [
  { value: 0, label: 'Never' },
  { value: 7, label: 'Weekly' },
  { value: 30, label: 'Monthly' },
  { value: 90, label: 'Quarterly' },
  { value: 180, label: 'Every 6 months' },
];

export default function SettingsPage() {
  const { user, setUser, logout } = useAuth();
  const invalidate = useInvalidateFootprint();
  const [name, setName] = useState(user?.name ?? '');
  const [confirm, setConfirm] = useState<null | 'reset' | 'clear' | 'delete'>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: (body: Partial<User>) => patch<User>('/me', body),
    onSuccess: (u) => {
      setUser(u);
      toast({ tone: 'success', title: 'Settings saved' });
    },
  });

  const danger = useMutation({
    mutationFn: async (kind: 'reset' | 'clear' | 'delete') => {
      if (kind === 'reset') return post('/reset-sample');
      if (kind === 'clear') return post('/clear');
      return del('/me');
    },
    onSuccess: (_r, kind) => {
      setConfirm(null);
      if (kind === 'delete') return logout();
      toast({ tone: 'success', title: kind === 'reset' ? 'Sample footprint loaded' : 'Footprint cleared' });
      invalidate();
    },
  });

  async function exportData() {
    const data = await api('/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exposex-footprint-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importData(file: File) {
    try {
      const data = JSON.parse(await file.text());
      const r = await post<{ accounts: number }>('/import', data);
      toast({ tone: 'success', title: 'Import complete', body: `${r.accounts} items imported.` });
      invalidate();
    } catch (e) {
      toast({ tone: 'danger', title: 'Import failed', body: e instanceof Error ? e.message : 'Invalid file' });
    }
  }

  if (!user) return null;
  const confirmText = {
    reset: { title: 'Load sample footprint?', body: 'This replaces your current inventory, history and alerts with the demo data set.', cta: 'Replace with sample' },
    clear: { title: 'Clear everything?', body: 'This permanently deletes all accounts, connections, breaches, history and alerts. Your login stays.', cta: 'Clear footprint' },
    delete: { title: 'Delete your ExposeX account?', body: 'Your login and all data are permanently deleted. This cannot be undone.', cta: 'Delete account' },
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-4xl gap-4">
        <section className="card card-pad">
          <p className="section-title mb-4">Profile</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-60 flex-1">
              <label className="label" htmlFor="s-name">Display name</label>
              <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="min-w-60 flex-1">
              <label className="label">Email</label>
              <input className="input opacity-60" value={user.email} disabled />
            </div>
            <button className="btn-primary" onClick={() => save.mutate({ name })} disabled={save.isPending || !name.trim()}>
              <Save className="size-4" /> Save
            </button>
          </div>
        </section>

        <section className="card card-pad">
          <p className="section-title mb-1">Reminders & alerts</p>
          <p className="mb-4 text-sm text-ink-400">Notifications arrive live in the app and are listed under Alerts.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label flex items-center gap-1.5" htmlFor="s-review">
                <CalendarClock className="size-3.5" /> Periodic review prompt
              </label>
              <select id="s-review" className="input" value={user.reviewIntervalDays} onChange={(e) => save.mutate({ reviewIntervalDays: Number(e.target.value) })}>
                {REVIEW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-500">Last review: {user.lastReviewAt ? timeAgo(user.lastReviewAt) : 'never'}</p>
            </div>
            <div>
              <label className="label flex items-center gap-1.5" htmlFor="s-sim">
                <Siren className="size-3.5" /> Simulated breach notifications
              </label>
              <select id="s-sim" className="input" value={user.breachSimMinutes} onChange={(e) => save.mutate({ breachSimMinutes: Number(e.target.value) })}>
                {SIM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-500">Practice drills: a random service in your inventory is "breached" and you get the full impact report.</p>
            </div>
          </div>
        </section>

        <section className="card card-pad">
          <p className="section-title mb-1">Your data</p>
          <p className="mb-4 text-sm text-ink-400">Export your inventory as JSON, or import one. ExposeX never stores real passwords, only reuse labels.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={exportData}>
              <Download className="size-4" /> Export JSON
            </button>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Import JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importData(f);
                e.target.value = '';
              }}
            />
            <button className="btn-secondary" onClick={() => setConfirm('reset')}>
              <RefreshCw className="size-4" /> Load sample footprint
            </button>
          </div>
        </section>

        <section className="card card-pad border-rose-500/20">
          <p className="section-title mb-4 text-rose-300">Danger zone</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-danger" onClick={() => setConfirm('clear')}>
              <Trash2 className="size-4" /> Clear all footprint data
            </button>
            <button className="btn-danger" onClick={() => setConfirm('delete')}>
              <UserX className="size-4" /> Delete my account
            </button>
          </div>
        </section>
      </div>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? confirmText[confirm].title : ''}>
        {confirm && (
          <>
            <p className="text-sm text-ink-300">{confirmText[confirm].body}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
              <button className={confirm === 'reset' ? 'btn-primary' : 'btn-danger'} onClick={() => danger.mutate(confirm)} disabled={danger.isPending}>
                {danger.isPending && <Spinner className="size-4" />} {confirmText[confirm].cta}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
