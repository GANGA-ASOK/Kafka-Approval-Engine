import { cn } from '../lib/cn';
import { dateTimeSeconds, relative } from '../lib/format';
import { describeEvent, eventIcon, eventLabel, eventMeta, sourceLabel, toneClasses } from '../lib/labels';
import type { AuditEntry } from '../lib/types';

/** A request's event history rendered as a readable activity feed. */
export function ActivityFeed({ entries }: { entries: AuditEntry[] }) {
  return (
    <ol className="relative space-y-0">
      {entries.map((e, i) => {
        const Icon = eventIcon(e.event_type);
        const tone = eventMeta[e.event_type]?.tone ?? 'neutral';
        return (
          <li key={e.id ?? e.event_id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < entries.length - 1 && <span className="absolute top-8 bottom-1 left-[13px] w-px bg-line" aria-hidden />}
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', toneClasses[tone].badge)} aria-hidden>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm text-ink">{describeEvent(e)}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12.5px] text-muted">
                <span className="font-medium text-ink-2">{eventLabel(e.event_type)}</span>
                <time dateTime={e.occurred_at} title={dateTimeSeconds(e.occurred_at)}>
                  {relative(e.occurred_at)}
                </time>
                <span>via {sourceLabel(e.source)}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
