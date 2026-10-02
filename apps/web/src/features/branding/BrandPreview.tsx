import { BRAND } from '@envelope/shared';
import { LogoMark } from '../../components/brand/Logo';
import { brandStyle } from './brand-theme';

/**
 * What a recipient will see, drawn with the same theme variables the signing page uses, so the
 * preview cannot drift from the real thing (docs/22 step 8). Decorative: it is not interactive.
 */
export function BrandPreview({
  workspaceName,
  color,
  logoUrl,
}: {
  workspaceName: string;
  color: string | null;
  logoUrl: string | null;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
      style={brandStyle(color)}
      data-testid="brand-preview"
    >
      <div className="bg-brand-700 px-5 py-4 text-white">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="max-h-10 max-w-60 object-contain" />
        ) : (
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight">{workspaceName}</span>
          </div>
        )}
        <p className="mt-1.5 text-xs">
          Sent with {BRAND.productName} · Powered by {BRAND.companyName}
        </p>
      </div>
      <div className="space-y-3 bg-white px-5 py-5 text-sm text-slate-700">
        <p>Hi Priya, {workspaceName} has sent you a document to sign.</p>
        <span className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white">
          Review &amp; Sign
        </span>
        <p className="text-xs text-slate-500">
          The sealed PDF and its certificate are never branded.
        </p>
      </div>
    </div>
  );
}
