import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, FilePlus2, ListChecks, Search, X } from 'lucide-react';
import { useUser } from '../lib/auth-context';
import { parseDate } from '../lib/format';
import { useDebounced, useDocumentTitle } from '../lib/hooks';
import { statusMeta } from '../lib/labels';
import { useRequests } from '../lib/queries';
import { currentStep } from '../lib/sla';
import type { RequestStatus } from '../lib/types';
import { LinkButton } from '../components/ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/Feedback';
import { Input } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { PageHeader, Panel } from '../components/ui/Panel';
import { Segmented } from '../components/ui/Segmented';
import { RequestRow } from '../components/RequestRow';

const PAGE = 20;

type StatusFilter = 'ALL' | RequestStatus;

function useListParams() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as StatusFilter) || 'ALL';
  const q = params.get('q') ?? '';
  const skip = Number(params.get('skip') ?? 0) || 0;
  const update = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || v === 'ALL' || v === 0) next.delete(k);
      else next.set(k, String(v));
    }
    setParams(next, { replace: true });
  };
  return { status, q, skip, update, params };
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text, 300);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
      <Input type="search" aria-label={placeholder} placeholder={placeholder} className="pr-8 pl-9" value={text} onChange={(e) => setText(e.target.value)} />
      {text && (
        <button type="button" className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-faint hover:text-ink" onClick={() => setText('')} aria-label="Clear search">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

const statusOptions = (list: StatusFilter[]) => list.map((s) => ({ value: s, label: s === 'ALL' ? 'All' : statusMeta[s].label }));

export function MyRequests() {
  useDocumentTitle('My requests');
  const user = useUser();
  const { status, q, skip, update, params } = useListParams();
  const scope = user.role !== 'EMPLOYEE' && params.get('scope') === 'all' ? 'all' : 'mine';
  const query = useRequests({ scope, status: status === 'ALL' ? undefined : status, q: q || undefined, limit: PAGE, skip }, { live: true });
  const filtered = status !== 'ALL' || !!q;

  return (
    <>
      <PageHeader
        title={scope === 'all' ? 'All requests' : 'My requests'}
        description={scope === 'all' ? 'Every request in the organisation. Open one to see its route and history.' : 'Everything you have raised, newest first.'}
        actions={
          <LinkButton to="/requests/new" variant="primary" icon={<FilePlus2 className="size-4" aria-hidden />}>
            New request
          </LinkButton>
        }
      />
      <Panel bodyClassName="">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {user.role !== 'EMPLOYEE' && (
              <Segmented
                label="Whose requests"
                value={scope}
                onChange={(v) => update({ scope: v === 'all' ? 'all' : null, skip: 0 })}
                options={[
                  { value: 'mine', label: 'Mine' },
                  { value: 'all', label: 'Everyone' },
                ]}
              />
            )}
            <Segmented
              label="Filter by status"
              value={status}
              onChange={(v) => update({ status: v, skip: 0 })}
              options={statusOptions(['ALL', 'PENDING_APPROVAL', 'ESCALATED', 'APPROVED', 'REJECTED', 'CANCELLED'])}
            />
          </div>
          <SearchBox value={q} onChange={(v) => update({ q: v, skip: 0 })} placeholder="Search title or ID" />
        </div>
        {query.isPending ? (
          <SkeletonRows rows={5} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={<Search className="size-5" />} title="No requests match these filters" action={<LinkButton to={scope === 'all' ? '?scope=all' : '.'} size="sm">Clear filters</LinkButton>}>
              Try a different status or search term.
            </EmptyState>
          ) : (
            <EmptyState
              icon={<ListChecks className="size-5" />}
              title={scope === 'all' ? 'No requests yet' : "You haven't raised any requests"}
              action={
                <LinkButton to="/requests/new" variant="primary" size="sm" icon={<FilePlus2 className="size-4" aria-hidden />}>
                  Raise a request
                </LinkButton>
              }
            >
              Requests you raise show up here with their approval progress and deadlines.
            </EmptyState>
          )
        ) : (
          <>
            <ul className="divide-y divide-line">
              {query.data.items.map((r) => (
                <RequestRow key={r.id} request={r} showRequester={scope === 'all'} />
              ))}
            </ul>
            <div className="border-t border-line">
              <Pagination total={query.data.total} limit={PAGE} skip={skip} onChange={(s) => update({ skip: s })} noun="requests" />
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

export function Inbox() {
  useDocumentTitle('Approvals inbox');
  const user = useUser();
  const { status, q, skip, update } = useListParams();
  const query = useRequests({ scope: 'inbox', status: status === 'ALL' ? undefined : status, q: q || undefined, limit: PAGE, skip }, { live: true });

  // Most urgent first: earliest deadline at the top.
  const items = useMemo(() => {
    const list = [...(query.data?.items ?? [])];
    const due = (r: (typeof list)[number]) => parseDate(currentStep(r)?.due_at ?? r.sla_due_at)?.getTime() ?? Infinity;
    return list.sort((a, b) => due(a) - due(b));
  }, [query.data]);

  return (
    <>
      <PageHeader
        title="Approvals inbox"
        description={
          user.role === 'ADMIN'
            ? 'Every active request. As an admin you can decide any step.'
            : `Requests waiting at the ${statusRoleText(user.role)} step. The most urgent deadline is at the top.`
        }
      />
      <Panel bodyClassName="">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 md:flex-row md:items-center md:justify-between">
          <Segmented label="Filter by status" value={status} onChange={(v) => update({ status: v, skip: 0 })} options={statusOptions(['ALL', 'PENDING_APPROVAL', 'ESCALATED'])} />
          <SearchBox value={q} onChange={(v) => update({ q: v, skip: 0 })} placeholder="Search title or ID" />
        </div>
        {query.isPending ? (
          <SkeletonRows rows={5} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="size-5" />} title={status !== 'ALL' || q ? 'Nothing matches these filters' : "You're all caught up"}>
            {status !== 'ALL' || q
              ? 'Clear the search or pick another status.'
              : 'When a request reaches your step it appears here. This page refreshes on its own.'}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {items.map((r) => (
                <RequestRow key={r.id} request={r} showRequester actions />
              ))}
            </ul>
            <div className="border-t border-line">
              <Pagination total={query.data.total} limit={PAGE} skip={skip} onChange={(s) => update({ skip: s })} noun="requests" />
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

function statusRoleText(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}
