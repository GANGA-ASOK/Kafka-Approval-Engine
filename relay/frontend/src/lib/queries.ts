import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { AuditQuery, DeadLetterStatus } from './types';
import { FINAL_STATUSES } from './types';

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 15_000 });
}

export function useRequests(params: { scope: 'mine' | 'inbox' | 'all'; status?: string; q?: string; limit?: number; skip?: number }, opts: { live?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['requests', params],
    queryFn: () => api.listRequests(params),
    placeholderData: keepPreviousData,
    refetchInterval: opts.live ? 10_000 : false,
    enabled: opts.enabled ?? true,
  });
}

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['request', id],
    queryFn: () => api.getRequest(id!),
    enabled: !!id,
    // Keep refreshing while the request is still moving through its workflow.
    refetchInterval: (q) => {
      const r = q.state.data;
      if (!r) return false;
      return FINAL_STATUSES.includes(r.status) ? false : r.status === 'SUBMITTED' ? 1500 : 5000;
    },
  });
}

export function useTimeline(id: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['timeline', id],
    queryFn: () => api.timeline(id!),
    enabled: !!id,
    refetchInterval: live ? 5000 : false,
  });
}

export function useWorkflows() {
  return useQuery({ queryKey: ['workflows'], queryFn: api.workflows, staleTime: 60_000 });
}

export function useAudit(query: AuditQuery, live: boolean) {
  return useQuery({
    queryKey: ['audit', query],
    queryFn: () => api.audit(query),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 3000 : false,
  });
}

export function useDeadLetters(status: DeadLetterStatus | 'ALL') {
  return useQuery({ queryKey: ['dlq', status], queryFn: () => api.deadLetters(status), refetchInterval: 10_000 });
}

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: api.users });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 15_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
}
