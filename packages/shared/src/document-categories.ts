/**
 * What kind of document an envelope is (docs/07-compliance-layer.md,
 * "Blocked Document Categories"). Required on every envelope so a
 * `JurisdictionPolicy` has something to check it against.
 *
 * The list is short on purpose: a sender picks the closest fit, not a precise
 * legal classification. `OTHER` exists so nobody is blocked from sending a
 * legitimate document that does not fit a listed category.
 */
export const DOCUMENT_CATEGORIES = [
  'COMMERCIAL_CONTRACT',
  'EMPLOYMENT_AGREEMENT',
  'NDA',
  'CONSENT_FORM',
  'FINANCIAL_AGREEMENT',
  'REAL_ESTATE_LEASE',
  'WILL_OR_TESTAMENTARY',
  'PROPERTY_TRANSFER',
  'FAMILY_LAW',
  'NEGOTIABLE_INSTRUMENT',
  'COURT_FILING',
  'UTILITY_EVICTION_INSURANCE_NOTICE',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/** Sender-facing wording, in the order the create screen offers them. */
export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  COMMERCIAL_CONTRACT: 'Commercial contract',
  EMPLOYMENT_AGREEMENT: 'Employment agreement',
  NDA: 'Non-disclosure agreement',
  CONSENT_FORM: 'Consent form',
  FINANCIAL_AGREEMENT: 'Financial agreement',
  REAL_ESTATE_LEASE: 'Real estate lease',
  WILL_OR_TESTAMENTARY: 'Will or testamentary document',
  PROPERTY_TRANSFER: 'Property transfer or conveyance',
  FAMILY_LAW: 'Family law document (adoption, divorce)',
  NEGOTIABLE_INSTRUMENT: 'Negotiable instrument (cheque, bill of exchange)',
  COURT_FILING: 'Court filing',
  UTILITY_EVICTION_INSURANCE_NOTICE: 'Utility, eviction or insurance cancellation notice',
  OTHER: 'Other',
};
