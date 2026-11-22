import { roleLabel } from '../lib/labels';

export function ChainText({ roles }: { roles: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {roles.map((r, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && (
            <svg viewBox="0 0 16 8" className="h-2 w-4 text-faint" aria-hidden>
              <path d="M0 4h13M10 1l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
          <span className="font-medium text-ink-2">{roleLabel(r)}</span>
        </span>
      ))}
    </span>
  );
}
