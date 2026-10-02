import type { SigningBrand } from '@envelope/shared';

interface BrandedTenant {
  name: string;
  brandColor: string | null;
  brandLogoRef: string | null;
}

/** The path of a workspace's public logo, relative to the site (docs/22, ADR 0034). Prefix as in configure-app. */
export function brandLogoPath(ref: string): string {
  return `/api/v1/branding/logo/${ref}`;
}

/** What a recipient-facing page or email needs to look like the sender's workspace. */
export function toSigningBrand(tenant: BrandedTenant): SigningBrand {
  return {
    name: tenant.name,
    color: tenant.brandColor,
    logoUrl: tenant.brandLogoRef ? brandLogoPath(tenant.brandLogoRef) : null,
  };
}

/** The logo address an email can use: mail clients need an absolute URL. */
export function absoluteBrand(brand: SigningBrand, appUrl: string): SigningBrand {
  return {
    ...brand,
    logoUrl: brand.logoUrl ? new URL(brand.logoUrl, appUrl).toString() : null,
  };
}
