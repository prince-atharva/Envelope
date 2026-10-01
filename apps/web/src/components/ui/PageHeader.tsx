import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  flat = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  /** Drops the rule under the heading when tabs or a toolbar draw their own. */
  flat?: boolean;
}) {
  return (
    <div className="page-heading" data-flat={flat || undefined}>
      <div className="min-w-0 flex-1 basis-64">
        {breadcrumb && <div className="mb-3 text-sm text-slate-600">{breadcrumb}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
