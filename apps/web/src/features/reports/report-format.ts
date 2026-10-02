import type { DropOff } from '@envelope/shared';

/** "3 h 30 min", "1 d 2 h", "45 min", "under a minute"; an em dash when there is nothing to show. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
}

/** 0.2857 becomes "29%"; null (nothing sent) becomes an em dash. */
export function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export interface FunnelRow {
  key: 'invited' | 'opened' | 'consented' | 'signed';
  label: string;
  count: number;
  /** Of everyone invited, as a fraction. */
  share: number;
}

/** Where invited signers and approvers got to, in the order they get there. */
export function funnelRows(dropOff: DropOff): FunnelRow[] {
  const share = (count: number) => (dropOff.invited === 0 ? 0 : count / dropOff.invited);
  return [
    { key: 'invited', label: 'Invited', count: dropOff.invited, share: share(dropOff.invited) },
    {
      key: 'opened',
      label: 'Opened the link',
      count: dropOff.opened,
      share: share(dropOff.opened),
    },
    {
      key: 'consented',
      label: 'Agreed to sign electronically',
      count: dropOff.consented,
      share: share(dropOff.consented),
    },
    {
      key: 'signed',
      label: 'Signed or approved',
      count: dropOff.signed,
      share: share(dropOff.signed),
    },
  ];
}

/** "1 Oct" for a `YYYY-MM-DD` day. */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
