import type { EnvelopeStatus } from '@envelope/shared';

const STYLES: Record<EnvelopeStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-slate-100 text-slate-700 ring-slate-200' },
  SENT: { label: 'Sent', className: 'bg-sky-50 text-sky-800 ring-sky-200' },
  DELIVERED: { label: 'Delivered', className: 'bg-sky-50 text-sky-800 ring-sky-200' },
  PARTIALLY_SIGNED: {
    label: 'Partly signed',
    className: 'bg-amber-50 text-amber-800 ring-amber-200',
  },
  EXPIRED: { label: 'Expired', className: 'bg-orange-50 text-orange-800 ring-orange-200' },
  COMPLETED: { label: 'Completed', className: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  DECLINED: { label: 'Declined', className: 'bg-red-50 text-red-800 ring-red-200' },
  VOIDED: { label: 'Voided', className: 'bg-red-50 text-red-800 ring-red-200' },
};

export function StatusBadge({ status }: { status: EnvelopeStatus }) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style.className}`}
    >
      {style.label}
    </span>
  );
}
