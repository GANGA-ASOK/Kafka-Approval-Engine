import { useHealth } from '../lib/queries';
import { cn } from '../lib/cn';
import type { ComponentState } from '../lib/types';

const names = { mongo: 'MongoDB', redis: 'Redis', kafka: 'Kafka' } as const;

function dot(state: ComponentState | 'unknown') {
  if (state === 'up') return 'bg-[#3fcf8e]';
  if (state === 'disabled') return 'bg-rail-muted';
  if (state === 'down') return 'bg-[#ff6b5f]';
  return 'bg-rail-muted/50';
}

function stateText(state: ComponentState | 'unknown') {
  return state === 'up' ? 'running' : state === 'down' ? 'down' : state === 'disabled' ? 'not used (in-memory bus)' : 'unknown';
}

/** Small live system status for the sidebar: one dot per backing service. */
export function HealthIndicator() {
  const { data, isError, isPending } = useHealth();
  const comps = data?.components;
  const overall = isError ? 'API unreachable' : isPending ? 'Checking systems…' : data?.status === 'ok' ? 'All systems running' : 'Some systems degraded';
  const summary = (Object.keys(names) as (keyof typeof names)[])
    .map((k) => `${names[k]}: ${stateText(comps?.[k] ?? 'unknown')}`)
    .join(', ');
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5" role="status" aria-live="polite" title={isError ? 'The backend did not answer /health' : summary}>
      <p className={cn('text-[12.5px] font-medium', isError ? 'text-[#ff8a80]' : 'text-rail-ink')}>{overall}</p>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1" aria-label={summary}>
        {(Object.keys(names) as (keyof typeof names)[]).map((k) => {
          const state: ComponentState | 'unknown' = isError ? 'down' : (comps?.[k] ?? 'unknown');
          return (
            <li key={k} className="flex items-center gap-1.5 text-[12px] text-rail-muted">
              <span className={cn('size-2 rounded-full', dot(state))} aria-hidden />
              {names[k]}
            </li>
          );
        })}
        {data?.workers !== undefined && (
          <li className="flex items-center gap-1.5 text-[12px] text-rail-muted">
            <span className={cn('size-2 rounded-full', dot(data.workers ? 'up' : 'disabled'))} aria-hidden />
            Workers
          </li>
        )}
      </ul>
    </div>
  );
}
