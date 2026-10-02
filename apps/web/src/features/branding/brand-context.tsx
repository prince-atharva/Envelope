import type { SigningBrand } from '@envelope/shared';
import { BRAND } from '@envelope/shared';
import { createContext, type ReactNode, useContext } from 'react';
import { LogoMark } from '../../components/brand/Logo';
import { brandStyle } from './brand-theme';

const BrandContext = createContext<SigningBrand | null>(null);

/** The workspace look the page below should wear, if its sender set one. */
export function useBrand(): SigningBrand | null {
  return useContext(BrandContext);
}

/** True when the sender's workspace set a colour or a logo; a bare name alone changes nothing. */
export function isBranded(brand: SigningBrand | null): brand is SigningBrand {
  return brand !== null && (brand.color !== null || brand.logoUrl !== null);
}

/**
 * Wraps recipient-facing pages (the signing portal and the download page) so they look like
 * the sender's workspace. `display: contents` keeps the wrapper out of the layout while the
 * custom properties still inherit.
 */
export function BrandProvider({
  brand,
  children,
}: {
  brand: SigningBrand | null;
  children: ReactNode;
}) {
  return (
    <BrandContext.Provider value={brand}>
      <div className="contents" style={brandStyle(brand?.color)}>
        {children}
      </div>
    </BrandContext.Provider>
  );
}

/**
 * The header above a recipient-facing card: the workspace logo (or its name) when branded,
 * with "Powered by" attribution kept (ADR 0034); the product logo otherwise.
 */
export function BrandedHeader({ fallback }: { fallback: ReactNode }) {
  const brand = useBrand();
  if (!isBranded(brand)) return <>{fallback}</>;
  return (
    <span className="inline-flex flex-col items-center gap-1.5">
      {brand.logoUrl ? (
        <img
          src={brand.logoUrl}
          alt={brand.name}
          className="max-h-12 max-w-60 object-contain"
          width={240}
          height={48}
        />
      ) : (
        <span className="inline-flex items-center gap-2.5">
          <LogoMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">{brand.name}</span>
        </span>
      )}
      <span className="text-xs font-medium text-brand-700">
        Sent with {BRAND.productName} · Powered by {BRAND.companyName}
      </span>
    </span>
  );
}
