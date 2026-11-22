import { money } from './format';
import type { RuleConditions } from './types';

/** "₹10,000 up to ₹1,00,000, Engineering only" */
export function conditionsText(c: RuleConditions): string {
  const parts: string[] = [];
  const min = c.min_amount ?? null;
  const max = c.max_amount ?? null;
  if (min != null && max != null) parts.push(`${money(min)} up to ${money(max)}`);
  else if (min != null) parts.push(`${money(min)} and above`);
  else if (max != null) parts.push(`Under ${money(max)}`);
  else parts.push('Any amount');
  if (c.departments?.length) parts.push(`${c.departments.join(', ')} only`);
  if (c.request_types?.length) parts.push(`${c.request_types.map((t) => t.charAt(0) + t.slice(1).toLowerCase()).join(', ')} requests`);
  return parts.join(', ');
}

