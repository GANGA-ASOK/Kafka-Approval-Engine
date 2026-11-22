import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { roleMeta, statusMeta, stepStatusMeta, toneClasses, type Tone } from '../lib/labels';
import type { RequestStatus, Role, StepStatus } from '../lib/types';

export function Badge({ tone = 'neutral', children, icon, className }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap', toneClasses[tone].badge, className)}>
      {icon}
      {children}
    </span>
  );
}

export function StatusBadge({ status, processing }: { status: RequestStatus; processing?: boolean }) {
  if (processing) {
    return (
      <Badge tone="warn" icon={<span className="size-1.5 animate-pulse rounded-full bg-amber" aria-hidden />}>
        Processing…
      </Badge>
    );
  }
  const m = statusMeta[status] ?? { label: status, tone: 'neutral' as Tone, icon: null };
  const Icon = m.icon;
  return (
    <Badge tone={m.tone} icon={Icon ? <Icon className="size-3.5" aria-hidden /> : null}>
      <span title={statusMeta[status]?.hint}>{m.label}</span>
    </Badge>
  );
}

export function StepStatusBadge({ status }: { status: StepStatus }) {
  const m = stepStatusMeta[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

/** Role chip: a coloured stripe marker plus the human role name. */
export function RoleBadge({ role, className, subtle }: { role: Role | string | null | undefined; className?: string; subtle?: boolean }) {
  const m = role ? roleMeta[role as Role] : undefined;
  if (!m) return <span className="text-muted">—</span>;
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium whitespace-nowrap',
        subtle ? 'text-ink-2' : 'border border-line bg-raised text-ink-2',
        className,
      )}
    >
      <span className={cn('h-2.5 w-1 rounded-full', m.bg)} aria-hidden />
      {m.label}
    </span>
  );
}
