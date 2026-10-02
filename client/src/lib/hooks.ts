import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getToken } from './api';
import type { Meta, Notification } from './types';
import { toast } from '../components/Toasts';

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/meta'), staleTime: Infinity });
}

/** Queries derived from the footprint. Invalidate them all after any change. */
export const FOOTPRINT_KEYS = [['dashboard'], ['accounts'], ['account'], ['graph'], ['fixes'], ['breaches'], ['groups'], ['notifications']];

export function useInvalidateFootprint() {
  const qc = useQueryClient();
  return () => Promise.all(FOOTPRINT_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

/** Subscribe to server-sent events: live breach alerts, reminders and score updates. */
export function useLiveEvents(enabled: boolean) {
  const invalidate = useInvalidateFootprint();
  useEffect(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    const onFootprint = () => invalidate();
    const onNotification = (e: MessageEvent) => {
      const n = JSON.parse(e.data) as Notification;
      toast({
        tone: n.type === 'breach' ? 'danger' : n.type === 'reminder' ? 'info' : 'default',
        title: n.title,
        body: n.body ?? undefined,
        href: n.type === 'breach' && n.data?.breachId ? `/alerts?breach=${n.data.breachId}` : n.type === 'reminder' ? '/alerts' : undefined,
      });
      invalidate();
    };
    es.addEventListener('footprint', onFootprint);
    es.addEventListener('notification', onNotification as EventListener);
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
