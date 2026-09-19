import { useId } from 'react';

/** The intervals offered. Null is off. */
export const REMINDER_CHOICES = [1, 2, 3, 5, 7] as const;

export function describeReminders(days: number | null): string {
  if (days === null) return 'Off';
  return days === 1 ? 'Every day' : `Every ${days} days`;
}

/**
 * Automatic reminders (docs/16 step 10): how often people who have not signed
 * are emailed a new link, plus one "expires soon" email. Off stops both.
 */
export function ReminderChoice({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: number | null;
  onChange: (days: number | null) => void;
  disabled?: boolean;
  /** One line, for the envelope page. */
  compact?: boolean;
}) {
  const id = useId();
  const choices: (number | null)[] = [...REMINDER_CHOICES, null];
  // A value set through the API that the list does not offer still shows.
  if (value !== null && !choices.includes(value)) choices.unshift(value);

  return (
    <div className={compact ? 'flex items-center gap-2' : 'space-y-1'}>
      <label
        htmlFor={id}
        className={compact ? 'text-xs text-slate-500' : 'block text-sm font-medium text-slate-800'}
      >
        Automatic reminders
      </label>
      <select
        id={id}
        value={value ?? 'off'}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value === 'off' ? null : Number(event.target.value))
        }
        className={
          compact
            ? 'rounded-md border border-slate-300 px-2 py-1 text-xs'
            : 'rounded-lg border border-slate-300 px-3 py-2 text-sm'
        }
      >
        {choices.map((days) => (
          <option key={days ?? 'off'} value={days ?? 'off'}>
            {describeReminders(days)}
          </option>
        ))}
      </select>
      {!compact && (
        <p className="text-xs text-slate-500">
          Anyone who has not signed gets a new link this often, and a warning before the deadline.
        </p>
      )}
    </div>
  );
}
