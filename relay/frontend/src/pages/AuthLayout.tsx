import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Logo } from '../components/Logo';

/** Shared frame for sign-in and sign-up: brand panel left, form right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(420px,5fr)_7fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-rail p-10 text-rail-ink lg:flex">
        <Logo />
        <div className="max-w-md">
          <h1 className="text-[34px] leading-[1.12] font-semibold text-white">Every approval routed, timed and on the record.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-rail-muted">
            Raise a request and RELAY sends it to the right people in order. Deadlines escalate on their own, and every step lands in the audit log.
          </p>
          <SampleRoute />
        </div>
        <p className="text-[12.5px] text-rail-muted">Event-driven on Kafka, MongoDB and Redis.</p>
      </aside>
      <main className="flex flex-col bg-canvas">
        <div className="flex h-16 items-center bg-rail px-5 lg:hidden">
          <Logo />
        </div>
        <div className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:px-8">{children}</div>
      </main>
    </div>
  );
}

function SampleRoute() {
  const stations = [
    { role: 'Manager', state: 'done', note: 'Approved in 2h' },
    { role: 'Finance', state: 'now', note: '18h left' },
    { role: 'Director', state: 'next', note: 'Next' },
  ] as const;
  return (
    <figure className="mt-10 rounded-xl border border-white/8 bg-white/[0.03] p-5" aria-label="Example: a ₹2,40,000 laptop purchase approved by Manager and now with Finance">
      <figcaption className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium text-white">Laptops for new joiners</span>
        <span className="tnum text-rail-ink">₹2,40,000</span>
      </figcaption>
      <ol className="mt-5 flex items-start">
        {stations.map((s, i) => (
          <li key={s.role} className="flex flex-1 items-start last:flex-none">
            <div className="flex flex-col items-center">
              <span
                className={
                  s.state === 'done'
                    ? 'grid size-5 place-items-center rounded-full bg-[#3fcf8e] text-rail'
                    : s.state === 'now'
                      ? 'size-5 animate-signal rounded-full border-[3px] border-[#7f8cff] bg-rail'
                      : 'size-5 rounded-full border-2 border-rail-muted bg-rail'
                }
              >
                {s.state === 'done' && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="mt-2 text-[13px] font-medium text-white">{s.role}</span>
              <span className="text-[12px] text-rail-muted">{s.note}</span>
            </div>
            {i < stations.length - 1 && <span className={`mt-[9px] h-[3px] flex-1 rounded-full ${s.state === 'done' ? 'bg-[#3fcf8e]' : 'bg-white/15'}`} />}
          </li>
        ))}
      </ol>
    </figure>
  );
}
