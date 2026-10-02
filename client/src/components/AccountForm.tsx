import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Mail, Smartphone, Puzzle, Info } from 'lucide-react';
import { api, patch, post } from '../lib/api';
import { useInvalidateFootprint, useMeta } from '../lib/hooks';
import type { Account, EnrichedAccount, Group, Kind } from '../lib/types';
import { ChipSelect, Spinner, Toggle } from './ui';
import { toast } from './Toasts';

const today = () => new Date().toISOString().slice(0, 10);

interface Props {
  initial?: Account;
  defaultKind?: Kind;
  onDone: (a: Account) => void;
}

export default function AccountForm({ initial, defaultKind = 'account', onDone }: Props) {
  const meta = useMeta().data;
  const invalidate = useInvalidateFootprint();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<Group[]>('/groups') });
  const others = useQuery({
    queryKey: ['accounts', 'all-for-form'],
    queryFn: () => api<{ accounts: EnrichedAccount[] }>('/accounts?sort=name&dir=asc'),
  });

  const [f, setF] = useState({
    kind: initial?.kind ?? defaultKind,
    name: initial?.name ?? '',
    serviceType: initial?.serviceType ?? (defaultKind === 'phone' ? 'carrier' : defaultKind === 'app' ? 'utility' : 'email'),
    domain: initial?.domain ?? '',
    identifier: initial?.identifier ?? '',
    importance: initial?.importance ?? 3,
    twofa: initial?.twofa ?? 'none',
    signInMethods: initial?.signInMethods ?? (defaultKind === 'phone' ? [] : ['password']),
    passwordGroupId: initial?.passwordGroupId ?? null,
    permissions: initial?.permissions ?? [],
    dataShared: initial?.dataShared ?? [],
    carrierPin: initial?.carrierPin ?? false,
    lastActive: initial?.lastActive ?? today(),
    memberSince: initial?.memberSince ?? '',
    notes: initial?.notes ?? '',
  });
  const [newGroup, setNewGroup] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [ssoProvider, setSsoProvider] = useState('');
  const [oauthTarget, setOauthTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const accounts = useMemo(() => (others.data?.accounts ?? []).filter((a) => a.id !== initial?.id), [others.data, initial]);
  const emails = accounts.filter((a) => a.kind === 'account' && (a.serviceType === 'email' || a.serviceType === 'identity'));
  const phones = accounts.filter((a) => a.kind === 'phone');
  const providers = accounts.filter((a) => a.kind === 'account');

  if (!meta) return <Spinner />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let passwordGroupId = f.passwordGroupId;
      if (passwordGroupId === -1) {
        if (!newGroup.trim()) throw new Error('Give the shared-password group a label');
        passwordGroupId = (await post<Group>('/groups', { label: newGroup.trim() })).id;
      }
      const body = {
        ...f,
        domain: f.domain || null,
        identifier: f.identifier || null,
        memberSince: f.memberSince || null,
        lastActive: f.lastActive || null,
        notes: f.notes || null,
        passwordGroupId: f.kind === 'phone' ? null : passwordGroupId,
      };
      const saved = initial ? await patch<Account>(`/accounts/${initial.id}`, body) : await post<Account>('/accounts', body);
      const links: { sourceId: number; targetId: number; type: string }[] = [];
      if (recoveryEmail) links.push({ sourceId: Number(recoveryEmail), targetId: saved.id, type: 'recovery_email' });
      if (recoveryPhone) links.push({ sourceId: Number(recoveryPhone), targetId: saved.id, type: 'recovery_phone' });
      if (ssoProvider) links.push({ sourceId: Number(ssoProvider), targetId: saved.id, type: 'sso' });
      if (oauthTarget) links.push({ sourceId: saved.id, targetId: Number(oauthTarget), type: 'oauth' });
      for (const l of links) await post('/links', l);
      await invalidate();
      toast({ tone: 'success', title: initial ? 'Saved' : `${saved.name} added`, body: links.length ? `${links.length} connection(s) mapped.` : undefined });
      onDone(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const isApp = f.kind === 'app';
  const isPhone = f.kind === 'phone';
  const opts = (rec: Record<string, { label: string }>) => Object.entries(rec).map(([value, v]) => ({ value, label: v.label }));

  return (
    <form onSubmit={submit} className="space-y-5">
      {!initial && (
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['account', 'Online account', Mail],
              ['phone', 'Phone number', Smartphone],
              ['app', 'Third-party app', Puzzle],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              type="button"
              key={k}
              onClick={() =>
                setF((x) => ({
                  ...x,
                  kind: k,
                  serviceType: k === 'phone' ? 'carrier' : k === 'app' ? 'utility' : x.serviceType === 'carrier' || x.serviceType === 'utility' ? 'email' : x.serviceType,
                  signInMethods: k === 'phone' ? [] : x.signInMethods.length ? x.signInMethods : ['password'],
                  importance: k === 'phone' ? 5 : x.importance,
                }))
              }
              className={clsx(
                'flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition',
                f.kind === k ? 'border-brand-400/60 bg-brand-500/10 text-brand-300' : 'border-ink-600 text-ink-300 hover:border-ink-500',
              )}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="f-name">{isPhone ? 'Label (e.g. Mobile ••• 4821)' : 'Name'}</label>
          <input id="f-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} autoFocus />
        </div>
        {!isPhone && (
          <>
            <div>
              <label className="label" htmlFor="f-type">Service type</label>
              <select
                id="f-type"
                className="input"
                value={f.serviceType}
                onChange={(e) => {
                  set('serviceType', e.target.value);
                  if (!initial) set('importance', meta.serviceTypes[e.target.value]?.defaultImportance ?? 3);
                }}
              >
                {Object.entries(meta.serviceTypes).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="f-domain">Website / domain</label>
              <input id="f-domain" className="input" placeholder="example.com" value={f.domain} onChange={(e) => set('domain', e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="f-ident">{isPhone ? 'Carrier' : 'Username / login label'}</label>
          <input id="f-ident" className="input" placeholder={isPhone ? 'e.g. Verizon' : 'optional'} value={f.identifier} onChange={(e) => set('identifier', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-imp">Importance: {f.importance}/5</label>
          <input id="f-imp" type="range" min={1} max={5} value={f.importance} onChange={(e) => set('importance', Number(e.target.value))} className="w-full accent-cyan-400" />
          <p className="text-[11px] text-ink-500">How bad would losing this be?</p>
        </div>
        <div>
          <label className="label" htmlFor="f-last">Last used</label>
          <input id="f-last" type="date" className="input" value={f.lastActive ?? ''} max={today()} onChange={(e) => set('lastActive', e.target.value)} />
        </div>
        {!isPhone && !isApp && (
          <div>
            <label className="label" htmlFor="f-since">Member since</label>
            <input id="f-since" type="date" className="input" value={f.memberSince ?? ''} max={today()} onChange={(e) => set('memberSince', e.target.value)} />
          </div>
        )}
      </div>

      {isPhone ? (
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <Toggle checked={f.carrierPin} onChange={(v) => set('carrierPin', v)} label="Carrier PIN / port-out lock enabled" />
          <p className="mt-2 text-xs text-ink-400">Without one, an attacker can talk your carrier into moving your number to their SIM and receive your reset codes.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {!isApp && (
              <div>
                <label className="label" htmlFor="f-2fa">Two-factor authentication</label>
                <select id="f-2fa" className="input" value={f.twofa} onChange={(e) => set('twofa', e.target.value)}>
                  {Object.entries(meta.twofa).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="f-pw">Password shared with</label>
              <select
                id="f-pw"
                className="input"
                value={f.passwordGroupId ?? ''}
                onChange={(e) => set('passwordGroupId', e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Unique password (not shared)</option>
                {(groups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label} ({g.size} account{g.size === 1 ? '' : 's'})
                  </option>
                ))}
                <option value={-1}>+ New shared-password group…</option>
              </select>
              {f.passwordGroupId === -1 && (
                <input className="input mt-2" placeholder='Label, e.g. "my usual password"' value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
              )}
            </div>
          </div>
          <div>
            <label className="label">Sign-in methods</label>
            <ChipSelect options={Object.entries(meta.signInMethods).map(([value, label]) => ({ value, label }))} value={f.signInMethods} onChange={(v) => set('signInMethods', v)} />
          </div>
        </>
      )}

      {!isPhone && (
        <div>
          <label className="label">{isApp ? 'Permissions granted to this app' : 'Device / app permissions'}</label>
          <ChipSelect options={opts(meta.permissions)} value={f.permissions} onChange={(v) => set('permissions', v)} />
        </div>
      )}
      <div>
        <label className="label">Data this service holds about you</label>
        <ChipSelect options={opts(meta.dataClasses)} value={f.dataShared} onChange={(v) => set('dataShared', v)} />
      </div>

      {!initial && (
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink-200">
            <Info className="size-4 text-brand-300" /> Connections
          </p>
          <p className="mb-3 text-xs text-ink-400">These links are how risk spreads between accounts. You can add more later from the account page.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {!isPhone && (
              <div>
                <label className="label" htmlFor="f-re">Recovery email</label>
                <select id="f-re" className="input" value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)}>
                  <option value="">None / not listed</option>
                  {emails.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            {!isPhone && (
              <div>
                <label className="label" htmlFor="f-rp">Recovery phone</label>
                <select id="f-rp" className="input" value={recoveryPhone} onChange={(e) => setRecoveryPhone(e.target.value)}>
                  <option value="">None / not listed</option>
                  {phones.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            {!isPhone && (
              <div>
                <label className="label" htmlFor="f-sso">Signs in with (SSO)</label>
                <select id="f-sso" className="input" value={ssoProvider} onChange={(e) => setSsoProvider(e.target.value)}>
                  <option value="">Not using single sign-on</option>
                  {providers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
            {isApp && (
              <div>
                <label className="label" htmlFor="f-oauth">Has access to (OAuth)</label>
                <select id="f-oauth" className="input" value={oauthTarget} onChange={(e) => setOauthTarget(e.target.value)}>
                  <option value="">No account access</option>
                  {providers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <label className="label" htmlFor="f-notes">Notes</label>
        <textarea id="f-notes" className="input min-h-16" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} />
      </div>

      {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner className="size-4 text-ink-950" />}
          {initial ? 'Save changes' : 'Add to inventory'}
        </button>
      </div>
    </form>
  );
}
