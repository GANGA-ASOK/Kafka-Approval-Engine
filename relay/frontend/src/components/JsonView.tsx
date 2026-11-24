import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function JsonView({ value, label = 'Payload' }: { value: unknown; label?: string }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value ?? {}, null, 2);
  return (
    <div className="relative rounded-lg border border-line bg-sunken">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-line hover:text-ink"
          onClick={() => {
            navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto p-3 font-mono text-[12px] leading-relaxed text-ink-2">{text}</pre>
    </div>
  );
}
