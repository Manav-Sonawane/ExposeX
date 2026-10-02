import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Share2, ListChecks, ShieldAlert, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Logo } from '../components/Layout';
import { Toggle, Spinner } from '../components/ui';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register, demo } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [sample, setSample] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy('form');
    try {
      if (mode === 'login') await login(email, password);
      else await register({ email, name, password, sample });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function tryDemo() {
    setError(null);
    setBusy('demo');
    try {
      await demo();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start demo');
    } finally {
      setBusy(null);
    }
  }

  const features = [
    { icon: Share2, title: 'Map every connection', body: 'Recovery emails, phone numbers, single sign-on and app grants, drawn as one graph.' },
    { icon: ShieldAlert, title: 'Risk that spreads', body: 'Scores account for the whole network. A weak inbox makes every account it can reset weak too.' },
    { icon: ListChecks, title: 'Fix what matters first', body: 'Each action is simulated against your footprint and ranked by how much total risk it removes.' },
  ];

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-ink-800 bg-ink-900 p-12 lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-40 -left-40 size-[520px] rounded-full bg-brand-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-40 -bottom-40 size-[520px] rounded-full bg-violet-500/10 blur-3xl" />
        <Logo />
        <div className="relative my-auto max-w-lg">
          <h1 className="text-4xl leading-tight font-bold tracking-tight">
            One compromised account
            <br />
            <span className="bg-gradient-to-r from-brand-300 to-violet-300 bg-clip-text text-transparent">can open the door to ten.</span>
          </h1>
          <p className="mt-4 text-ink-300">
            ExposeX maps your digital footprint, finds your single points of failure, and tells you exactly which fix removes the most risk.
          </p>
          <div className="mt-10 space-y-5">
            {features.map((f) => (
              <div key={f.title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-brand-300">
                  <f.icon className="size-5" />
                </span>
                <div>
                  <p className="font-semibold text-ink-100">{f.title}</p>
                  <p className="text-sm text-ink-400">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-ink-500">ExposeX never stores real passwords. Only labels showing which accounts share one.</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Logo className="mb-8 lg:hidden" />
          <h2 className="text-2xl font-semibold">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="mt-1 text-sm text-ink-400">
            {mode === 'login' ? 'Sign in to review your exposure.' : 'Start mapping your digital footprint.'}
          </p>

          <button onClick={tryDemo} disabled={!!busy} className="btn-secondary mt-6 w-full border-brand-500/40 py-2.5">
            {busy === 'demo' ? <Spinner className="size-4" /> : <Sparkles className="size-4 text-brand-300" />}
            Explore instantly with a demo footprint
          </button>
          <div className="my-6 flex items-center gap-3 text-xs text-ink-500">
            <div className="h-px flex-1 bg-ink-700" /> or <div className="h-px flex-1 bg-ink-700" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="label" htmlFor="name">Name</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 8 : 1}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>
            {mode === 'register' && <Toggle checked={sample} onChange={setSample} label="Pre-fill with a sample footprint" />}
            {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
            <button type="submit" className="btn-primary w-full py-2.5" disabled={!!busy}>
              {busy === 'form' && <Spinner className="size-4 text-ink-950" />}
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-400">
            {mode === 'login' ? (
              <>
                New here? <Link to="/register" className="font-medium text-brand-300 hover:underline">Create an account</Link>
              </>
            ) : (
              <>
                Already have an account? <Link to="/login" className="font-medium text-brand-300 hover:underline">Sign in</Link>
              </>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
