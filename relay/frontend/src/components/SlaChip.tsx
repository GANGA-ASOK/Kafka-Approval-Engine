import { AlarmClock, AlarmClockOff, Timer } from 'lucide-react';
import { cn } from '../lib/cn';
import { dateTime } from '../lib/format';
import { useNow } from '../lib/hooks';
import { slaState } from '../lib/sla';

const styles = {
  ok: 'bg-ok-soft text-ok',
  soon: 'bg-warn-soft text-warn',
  breached: 'bg-bad-soft text-bad',
};

/** Live countdown to a step deadline. Green → amber when close → red "Breached". */
export function SlaChip({ dueAt, startedAt, breached = false, className }: { dueAt: string | null | undefined; startedAt?: string | null; breached?: boolean; className?: string }) {
  const now = useNow(1000);
  const s = slaState(dueAt, startedAt, breached, now);
  if (!s) return null;
  const Icon = s.level === 'breached' ? AlarmClockOff : s.level === 'soon' ? AlarmClock : Timer;
  const text = s.label;
  return (
    <span
      className={cn('tnum inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap', styles[s.level], className)}
      title={`Decision due ${dateTime(dueAt)}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {text}
    </span>
  );
}
