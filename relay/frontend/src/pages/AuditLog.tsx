import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, FilterX, Radio, ScrollText, Search } from 'lucide-react';
import { useUser } from '../lib/auth-context';
import { cn } from '../lib/cn';
import { dateTimeSeconds, relative } from '../lib/format';
import { useDebounced, useDocumentTitle, useNow } from '../lib/hooks';
import { describeEvent, eventIcon, eventLabel, eventMeta, roleLabel, sourceLabel, sourceMeta, toneClasses } from '../lib/labels';
import { useAudit } from '../lib/queries';
import type { AuditEntry, AuditQuery } from '../lib/types';
import { EVENT_SOURCES } from '../lib/types';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { Field, Input, Select } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { PageHeader } from '../components/ui/Panel';
import { JsonView } from '../components/JsonView';

const EVENT_GROUPS: { label: string; types: string[] }[] = [
  { label: 'People and the monitor', types: ['REQUEST_SUBMITTED', 'APPROVAL_DECISION', 'REQUEST_CANCEL_REQUESTED', 'SLA_BREACHED'] },
  {
    label: 'Workflow outcomes',
    types: ['REQUEST_ROUTED', 'STEP_ACTIVATED', 'STEP_APPROVED', 'STEP_REJECTED', 'REQUEST_ESCALATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_CANCELLED'],
  },
  { label: 'Operations', types: ['EVENT_DEAD_LETTERED', 'EVENT_REPLAYED'] },
];

const PAGE_SIZES = [25, 50, 100];

/** Local calendar day → ISO bounds. */
function dayStart(d: string) {
  return d ? new Date(`${d}T00:00:00`).toISOString() : undefined;
}
function dayEnd(d: string) {
  return d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined;
}

function csvCell(v: unknown) {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: AuditEntry[]) {
  const header = ['occurred_at', 'event_type', 'event', 'summary', 'request_id', 'request_title', 'actor_name', 'actor_role', 'actor_id', 'source', 'event_id', 'payload'];
  const lines = rows.map((e) =>
    [e.occurred_at, e.event_type, eventLabel(e.event_type), describeEvent(e), e.request_id, e.request_title, e.actor_name, e.actor_role, e.actor_id, e.source, e.event_id, e.payload]
      .map(csvCell)
      .join(','),
  );
  const blob = new Blob([[header.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `relay-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditLog() {
  useDocumentTitle('Audit log');
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const limit = PAGE_SIZES.includes(Number(get('limit'))) ? Number(get('limit')) : 25;
  const skip = Number(get('skip')) || 0;
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const update = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || (k === 'skip' && v === 0)) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('skip' in patch)) next.delete('skip');
    setParams(next, { replace: true });
  };

  // Request id is typed, so debounce it before it hits the URL/API.
  const [reqText, setReqText] = useState(get('request_id'));
  const reqDebounced = useDebounced(reqText.trim(), 350);
  useEffect(() => {
    if (reqDebounced !== get('request_id')) update({ request_id: reqDebounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqDebounced]);
  useEffect(() => {
    setReqText(get('request_id'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('request_id')]);

  const query: AuditQuery = {
    event_type: get('event_type') || undefined,
    request_id: get('request_id') || undefined,
    source: get('source') || undefined,
    from: dayStart(get('from')),
    to: dayEnd(get('to')),
    limit,
    skip,
  };
  const audit = useAudit(query, live);
  const items = useMemo(() => audit.data?.items ?? [], [audit.data]);
  const selectedTypes = get('event_type').split(',').filter(Boolean);
  const toggleType = (t: string) => {
    const next = selectedTypes.includes(t) ? selectedTypes.filter((x) => x !== t) : [...selectedTypes, t];
    update({ event_type: next.join(',') });
  };
  const hasFilters = ['event_type', 'request_id', 'source', 'from', 'to'].some((k) => params.get(k));

  // Highlight rows that arrived since the previous refresh (live tail).
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = items.map((e) => e.id ?? e.event_id);
    if (seen.current && live) {
      const n = new Set(ids.filter((id) => !seen.current!.has(id)));
      if (n.size) {
        setFresh(n);
        const t = window.setTimeout(() => setFresh(new Set()), 2500);
        seen.current = new Set(ids);
        return () => window.clearTimeout(t);
      }
    }
    seen.current = new Set(ids);
  }, [items, live]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of items) m.set(e.event_type, (m.get(e.event_type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleLive = () => {
    if (!live && skip > 0) update({ skip: 0 });
    setLive((v) => !v);
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description={
          user.role === 'EMPLOYEE'
            ? 'Every event on your requests: who did what, when, and which part of RELAY handled it.'
            : 'Every event RELAY processed, newest first: who did what, when, and which part of the system handled it.'
        }
        actions={
          <>
            <LiveToggle live={live} onToggle={toggleLive} updatedAt={audit.dataUpdatedAt} fetching={audit.isFetching} />
            <Button onClick={() => exportCsv(items)} disabled={!items.length} icon={<Download className="size-4" aria-hidden />}>
              Export page as CSV
            </Button>
          </>
        }
      />

      {/* Filters */}
      <section aria-label="Filters" className="mb-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1.2fr_1fr_0.9fr_0.9fr_auto] lg:items-end">
          <Field label="Event">
            {(p) => (
              <Select {...p} value={selectedTypes.length > 1 ? '__multi' : get('event_type')} onChange={(e) => update({ event_type: e.target.value === '__multi' ? get('event_type') : e.target.value })}>
                <option value="">All events</option>
                {selectedTypes.length > 1 && (
                  <option value="__multi">{selectedTypes.length} event types selected</option>
                )}
                {EVENT_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.types.map((t) => (
                      <option key={t} value={t}>
                        {eventLabel(t)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Request ID">
            {(p) => (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
                <Input {...p} type="search" className="pl-9 font-mono text-[13px]" placeholder="REQ-…" value={reqText} onChange={(e) => setReqText(e.target.value)} />
              </div>
            )}
          </Field>
          <Field label="Handled by">
            {(p) => (
              <Select {...p} value={get('source')} onChange={(e) => update({ source: e.target.value })}>
                <option value="">Any part of RELAY</option>
                {EVENT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {sourceMeta[s]?.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From">{(p) => <Input {...p} type="date" value={get('from')} max={get('to') || undefined} onChange={(e) => update({ from: e.target.value })} />}</Field>
          <Field label="To">{(p) => <Input {...p} type="date" value={get('to')} min={get('from') || undefined} onChange={(e) => update({ to: e.target.value })} />}</Field>
          <Button
            variant="ghost"
            disabled={!hasFilters}
            onClick={() => {
              setReqText('');
              setParams(new URLSearchParams(limit !== 25 ? { limit: String(limit) } : {}), { replace: true });
            }}
            icon={<FilterX className="size-4" aria-hidden />}
          >
            Clear
          </Button>
        </div>
      </section>

      {/* Summary chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Events on this page by type">
        <span className="mr-1 text-[13px] text-muted">
          {audit.data ? (
            <>
              <strong className="tnum font-semibold text-ink">{audit.data.total.toLocaleString('en-IN')}</strong> {audit.data.total === 1 ? 'event' : 'events'}
              {hasFilters ? ' match' : ' recorded'}
              {counts.length > 0 && '. On this page:'}
            </>
          ) : (
            <Skeleton className="inline-block h-4 w-32 align-middle" />
          )}
        </span>
        {counts.map(([type, n]) => {
          const Icon = eventIcon(type);
          const active = selectedTypes.includes(type);
          const tone = eventMeta[type]?.tone ?? 'neutral';
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => toggleType(type)}
              title={active ? `Stop filtering on “${eventLabel(type)}”` : `Filter on “${eventLabel(type)}” (pick several to combine)`}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium transition-colors',
                active ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
              )}
            >
              <Icon className={cn('size-3.5', toneClasses[tone].text)} aria-hidden />
              {eventLabel(type)}
              <span className="tnum text-muted">{n}</span>
            </button>
          );
        })}
      </div>

      <section aria-label="Events" className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
        {audit.isPending ? (
          <div className="divide-y divide-line">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="ml-auto h-3.5 w-24" />
              </div>
            ))}
          </div>
        ) : audit.isError ? (
          <ErrorState error={audit.error} onRetry={() => audit.refetch()} title="Couldn't load the audit log" />
        ) : items.length === 0 ? (
          <EmptyState icon={hasFilters ? <Search className="size-5" /> : <ScrollText className="size-5" />} title={hasFilters ? 'No events match these filters' : 'No events yet'}>
            {hasFilters ? 'Widen the date range or clear a filter.' : 'Submit a request and its events show up here within a second or two.'}
          </EmptyState>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Audit events, newest first</caption>
                <thead className="border-b border-line bg-raised text-[12.5px] text-muted">
                  <tr>
                    <th scope="col" className="w-10 py-2.5 pl-4">
                      <span className="sr-only">Expand</span>
                    </th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">Event</th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">Request</th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">Actor</th>
                    <th scope="col" className="py-2.5 pr-4 font-medium">Handled by</th>
                    <th scope="col" className="py-2.5 pr-5 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((e) => {
                    const id = e.id ?? e.event_id;
                    const open = expanded.has(id);
                    return (
                      <Fragment key={id}>
                        <tr className={cn('group align-top transition-colors hover:bg-raised', fresh.has(id) && 'bg-accent-soft', open && 'bg-raised')}>
                          <td className="py-3 pl-4">
                            <button
                              type="button"
                              onClick={() => toggle(id)}
                              aria-expanded={open}
                              aria-controls={`detail-${id}`}
                              aria-label={open ? 'Hide event details' : 'Show event details'}
                              className="grid size-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
                            >
                              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </button>
                          </td>
                          <td className="py-3 pr-4">
                            <EventCell e={e} />
                          </td>
                          <td className="max-w-56 py-3 pr-4">
                            <RequestCell e={e} onFilter={(rid) => update({ request_id: rid })} />
                          </td>
                          <td className="py-3 pr-4">
                            <ActorCell e={e} />
                          </td>
                          <td className="py-3 pr-4">
                            <SourcePill source={e.source} />
                          </td>
                          <td className="py-3 pr-5 text-right whitespace-nowrap">
                            <WhenCell at={e.occurred_at} />
                          </td>
                        </tr>
                        {open && (
                          <tr id={`detail-${id}`} className="bg-raised">
                            <td />
                            <td colSpan={5} className="pr-5 pb-4">
                              <EventDetails e={e} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="divide-y divide-line md:hidden">
              {items.map((e) => {
                const id = e.id ?? e.event_id;
                const open = expanded.has(id);
                return (
                  <li key={id} className={cn('px-4 py-3.5', fresh.has(id) && 'bg-accent-soft')}>
                    <div className="flex items-start justify-between gap-3">
                      <EventCell e={e} />
                      <WhenCell at={e.occurred_at} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-10 text-[13px]">
                      <ActorCell e={e} inline />
                      <SourcePill source={e.source} />
                      {e.request_id && (
                        <Link to={`/requests/${e.request_id}`} className="font-mono text-[12px] text-accent hover:underline">
                          {e.request_id}
                        </Link>
                      )}
                    </div>
                    <button type="button" onClick={() => toggle(id)} aria-expanded={open} className="mt-2 ml-10 inline-flex items-center gap-1 text-[13px] font-medium text-accent">
                      {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                      {open ? 'Hide details' : 'Details'}
                    </button>
                    {open && (
                      <div className="mt-2">
                        <EventDetails e={e} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line">
              <Pagination total={audit.data.total} limit={limit} skip={skip} onChange={(s) => update({ skip: s })} noun="events" />
              <label className="flex items-center gap-2 px-5 pb-3 text-[13px] whitespace-nowrap text-muted sm:pb-0">
                Rows per page
                <Select className="h-8 !w-20 text-[13px]" value={limit} onChange={(e) => update({ limit: e.target.value, skip: 0 })}>
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function LiveToggle({ live, onToggle, updatedAt, fetching }: { live: boolean; onToggle: () => void; updatedAt: number; fetching: boolean }) {
  const now = useNow(1000);
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={live}
      onClick={onToggle}
      className={cn(
        'inline-flex h-10 items-center gap-2.5 rounded-[var(--radius-control)] border px-3.5 text-sm font-medium transition-colors',
        live ? 'border-ok/40 bg-ok-soft text-ok' : 'border-line-strong bg-surface text-ink hover:bg-raised',
      )}
    >
      <span className={cn('relative flex h-5 w-9 items-center rounded-full p-0.5 transition-colors', live ? 'bg-ok' : 'bg-line-strong')} aria-hidden>
        <span className={cn('size-4 rounded-full bg-white shadow transition-transform', live && 'translate-x-4')} />
      </span>
      <Radio className={cn('size-4', live && fetching && 'animate-pulse')} aria-hidden />
      {live ? <span className="tnum">Live{ago != null ? `, ${ago}s ago` : ''}</span> : 'Live tail'}
    </button>
  );
}

function EventCell({ e }: { e: AuditEntry }) {
  const Icon = eventIcon(e.event_type);
  const tone = eventMeta[e.event_type]?.tone ?? 'neutral';
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', toneClasses[tone].badge)} aria-hidden>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-ink">{eventLabel(e.event_type)}</p>
        <p className="mt-0.5 line-clamp-2 max-w-md text-[13px] text-muted">{describeEvent(e)}</p>
      </div>
    </div>
  );
}

function RequestCell({ e, onFilter }: { e: AuditEntry; onFilter: (id: string) => void }) {
  if (!e.request_id) return <span className="text-faint">—</span>;
  return (
    <div className="min-w-0">
      <Link to={`/requests/${e.request_id}`} className="font-mono text-[12.5px] text-accent hover:underline">
        {e.request_id}
      </Link>
      {e.request_title && <p className="truncate text-[13px] text-muted">{e.request_title}</p>}
      <button type="button" onClick={() => onFilter(e.request_id!)} className="text-[12px] text-faint opacity-0 group-hover:opacity-100 hover:text-accent focus-visible:opacity-100">
        Only this request
      </button>
    </div>
  );
}

function ActorCell({ e, inline }: { e: AuditEntry; inline?: boolean }) {
  const system = !e.actor_id || e.actor_id === 'system';
  if (system) return <span className="text-muted">RELAY (automatic)</span>;
  return (
    <div className={inline ? 'flex items-center gap-2' : ''}>
      <p className="font-medium text-ink-2">{e.actor_name ?? e.actor_id}</p>
      {e.actor_role && <p className="text-[12.5px] text-muted">{roleLabel(e.actor_role)}</p>}
    </div>
  );
}

function SourcePill({ source }: { source: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md border border-line bg-raised px-2 text-[12px] font-medium whitespace-nowrap text-ink-2" title={sourceMeta[source]?.description}>
      {sourceLabel(source)}
    </span>
  );
}

function WhenCell({ at }: { at: string }) {
  useNow(30_000);
  return (
    <time dateTime={at} title={dateTimeSeconds(at)} className="text-[13px] whitespace-nowrap text-muted">
      {relative(at)}
    </time>
  );
}

function EventDetails({ e }: { e: AuditEntry }) {
  return (
    <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 lg:grid-cols-[280px_1fr]">
      <dl className="space-y-2 text-[13px]">
        <Detail label="Event ID" value={<code className="font-mono text-[12px] break-all">{e.event_id}</code>} />
        <Detail label="Event type" value={<code className="font-mono text-[12px]">{e.event_type}</code>} />
        <Detail label="Happened" value={dateTimeSeconds(e.occurred_at)} />
        {e.recorded_at && <Detail label="Recorded" value={dateTimeSeconds(e.recorded_at)} />}
        {e.correlation_id && <Detail label="Correlation ID" value={<code className="font-mono text-[12px] break-all">{e.correlation_id}</code>} />}
        {e.attempt != null && e.attempt > 0 && <Detail label="Delivery attempt" value={`${e.attempt + 1} (after ${e.attempt} ${e.attempt === 1 ? 'retry' : 'retries'})`} />}
        <Detail label="Actor ID" value={<code className="font-mono text-[12px] break-all">{e.actor_id ?? 'system'}</code>} />
        <Detail label="Source" value={`${sourceLabel(e.source)} (${sourceMeta[e.source]?.description ?? e.source})`} />
      </dl>
      <JsonView value={e.payload} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink-2">{value}</dd>
    </div>
  );
}
