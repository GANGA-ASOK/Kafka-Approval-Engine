import { cn } from '../lib/cn';

/** Three stations on a line: the request travelling through its approvers. */
export function Logo({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 40 24" className="h-6 w-10" aria-hidden>
        <path d="M5 12h30" stroke={tone === 'light' ? '#7f8cff' : '#3346d3'} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="6" cy="12" r="4.5" fill={tone === 'light' ? '#ffffff' : '#172036'} />
        <circle cx="20" cy="12" r="4.5" fill={tone === 'light' ? '#ffffff' : '#172036'} />
        <circle cx="34" cy="12" r="4.5" fill="#f2a81d" />
      </svg>
      <span className={cn('text-[17px] font-bold tracking-[0.14em]', tone === 'light' ? 'text-white' : 'text-ink')} style={{ fontStretch: '88%' }}>
        RELAY
      </span>
    </span>
  );
}
