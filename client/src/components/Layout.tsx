import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { LayoutDashboard, List, Share2, ListChecks, BellRing, Settings, LogOut, Menu, X, ShieldHalf } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useLiveEvents } from '../lib/hooks';
import type { Notification } from '../lib/types';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2.5', className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-violet-500 text-ink-950">
        <ShieldHalf className="size-5" />
      </span>
      <span className="text-lg font-bold tracking-tight">
        Expose<span className="text-brand-400">X</span>
      </span>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useLiveEvents(!!user);

  const notes = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: Notification[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  });
  const fixes = useQuery({ queryKey: ['fixes'], queryFn: () => api<{ fixes: unknown[] }>('/fixes') });

  const nav = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/inventory', label: 'Inventory', icon: List },
    { to: '/graph', label: 'Exposure map', icon: Share2 },
    { to: '/fixes', label: 'Fix checklist', icon: ListChecks, badge: fixes.data?.fixes.length },
    { to: '/alerts', label: 'Alerts', icon: BellRing, badge: notes.data?.unread, hot: true },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4">
      <Logo className="mb-6 px-2" />
      {nav.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive ? 'bg-brand-500/10 text-brand-300' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
            )
          }
        >
          <n.icon className="size-[18px]" />
          <span className="flex-1">{n.label}</span>
          {!!n.badge && (
            <span className={clsx('rounded-full px-1.5 py-px text-[11px] font-semibold', n.hot ? 'bg-rose-500 text-white' : 'bg-ink-700 text-ink-200')}>
              {n.badge > 99 ? '99+' : n.badge}
            </span>
          )}
        </NavLink>
      ))}
      <div className="mt-auto border-t border-ink-700 pt-4">
        <div className="mb-3 px-3">
          <p className="truncate text-sm font-medium text-ink-100">{user?.name}</p>
          <p className="truncate text-xs text-ink-400">{user?.email}</p>
        </div>
        <button onClick={logout} className="btn-ghost w-full justify-start">
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-ink-800 bg-ink-900/60 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-ink-700 bg-ink-900" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-800 bg-ink-950/80 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen((o) => !o)} className="btn-ghost p-2" aria-label="Menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Logo />
          <NavLink to="/alerts" className="relative btn-ghost p-2" aria-label="Alerts">
            <BellRing className="size-5" />
            {!!notes.data?.unread && <span className="absolute top-1 right-1 size-2 rounded-full bg-rose-500" />}
          </NavLink>
        </header>
        <main key={location.pathname} className="animate-fade-in mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
