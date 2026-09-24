interface DocumentProgressBarProps {
  signed: number;
  total: number;
  className?: string;
}

export function DocumentProgressBar({ signed, total, className = '' }: DocumentProgressBarProps) {
  if (total <= 0) return null;
  const percent = Math.min(100, Math.max(0, Math.round((signed / total) * 100)));

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className="h-1.5 w-20 sm:w-28 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={signed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${signed} of ${total} signatures completed`}
      >
        <div
          className={`h-full transition-all duration-300 ${
            percent === 100 ? 'bg-emerald-500' : 'bg-brand-600'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs font-medium text-slate-500">{percent}%</span>
    </div>
  );
}
