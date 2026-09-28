import { embedOriginSchema } from '@envelope/shared';

/**
 * One line per origin, validated the same way the shared schema does
 * (docs/18 workstream 7, ADR 0017), but pointing at which line is wrong
 * instead of one generic message.
 */
export function parseOriginsInput(text: string): { origins: string[]; errors: string[] } {
  const lines = text
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const errors: string[] = [];
  lines.forEach((line, index) => {
    if (!embedOriginSchema.safeParse(line).success) {
      errors.push(`Line ${index + 1}: "${line}" is not an exact HTTPS origin.`);
    }
  });
  if (new Set(lines).size !== lines.length) errors.push('Each origin can only appear once.');
  if (lines.length > 10) errors.push('Enter at most 10 origins.');
  return { origins: lines, errors };
}

/** Origins present in `before` but not in `after` — the ones about to stop working. */
export function removedOrigins(before: readonly string[], after: readonly string[]): string[] {
  return before.filter((origin) => !after.includes(origin));
}
