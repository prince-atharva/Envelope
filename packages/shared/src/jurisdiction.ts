import type { DocumentCategory } from './document-categories';

/**
 * Jurisdiction policy (docs/07-compliance-layer.md, ADR 0011).
 *
 * Policies are versioned reference data, not a database table: they are
 * agreed with counsel ahead of time, and a CRUD surface over them would let
 * anyone quietly change what an already-signed envelope claims to have
 * complied with. Resolution happens once, at envelope creation, and the
 * result is frozen onto the envelope (`Envelope.policySnapshot`); this
 * module is the only place the live values are read from.
 */

export type SignatureTier = 'SES' | 'AES' | 'QES';
export type IdentityAssurance = 'EMAIL' | 'EMAIL_OTP' | 'ID_VERIFIED';

export interface JurisdictionPolicy {
  /** ISO 3166-1 alpha-2, or 'EU'. */
  code: string;
  permittedTiers: SignatureTier[];
  minimumIdentityAssurance: IdentityAssurance;
  /** ESIGN and equivalents. Stored verbatim on consent, never by reference. */
  consentRequired: boolean;
  consentDisclosureText: string;
  retentionYears: number;
  /** 'eu-west-1', 'ap-south-1', ... */
  dataResidencyRegion: string;
  /** Tier 2 only; unused until QES is built (ADR 0010). */
  requireTimestamp: boolean;
  /** Document categories that MUST NOT be sent electronically in this jurisdiction. */
  blockedDocumentCategories: DocumentCategory[];
}

/**
 * The policy as frozen onto an envelope: the resolved policy plus which
 * version of this file produced it. `resolvedAt` and `resolvedFrom` are the
 * provenance an audit export needs, since the live table this snapshot was
 * read from is free to change or even disappear from a later release.
 */
export interface PolicySnapshot extends JurisdictionPolicy {
  version: number;
  resolvedAt: string;
  /** The code actually resolved: the envelope's own override, or the tenant's default. */
  resolvedFrom: 'envelope' | 'tenant';
}

/**
 * Bumped whenever a reference policy's values change, so a later reader can
 * tell which revision of this file produced a stored snapshot without that
 * revision still existing in the code.
 */
export const JURISDICTION_POLICY_VERSION = 1;

const DEFAULT_JURISDICTION_CODE = 'US';

/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ DRAFT PLACEHOLDER. This wording has NOT been reviewed by a lawyer.   │
 * │ Doc 11 is explicit that we must not write this text ourselves. It    │
 * │ stands in until HealthProHub supplies approved wording per           │
 * │ jurisdiction, and must be replaced before any real contract is       │
 * │ signed.                                                              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Doc 07 lists what the approved text must cover: the right to a paper copy,
 * how to withdraw consent and what follows, whether consent covers this
 * document only, how to ask for a paper copy and any fee, and the hardware
 * and software needed. The placeholder follows that outline for every
 * jurisdiction so the consent screen can be built and tested; it is not
 * advice, and it is shown to every signer regardless of whether the
 * jurisdiction's `consentRequired` is true (docs/17, "Deliberate
 * Simplifications" — showing more protection than the law strictly demands
 * is never wrong, and it means a wrong or stale `consentRequired` value can
 * never accidentally skip consent for a jurisdiction that needs it).
 */
export const CONSENT_TEXT_IS_DRAFT = true;

function draftDisclosure(regionName: string): string {
  return [
    'DRAFT — not legally reviewed. This placeholder notice will be replaced with approved wording before real use.',
    '',
    'Agreement to sign electronically',
    '',
    'By ticking the box below, you agree to receive this document and to sign it electronically instead of on paper. Your electronic signature will have the same effect as a handwritten one.',
    '',
    'This agreement covers this document only.',
    '',
    'You may ask the sender for a paper copy of this document at any time. There is no charge for a paper copy.',
    '',
    'You may withdraw this agreement at any time before you finish signing by choosing Decline. After you have signed, withdrawing it does not undo your signature.',
    '',
    `To sign, you need a device with an up-to-date web browser and an internet connection, and an email address where you can receive a copy of the signed document. Records are kept in line with ${regionName}'s retention rules.`,
  ].join('\n');
}

/** Categories blocked essentially everywhere (docs/07): the safe default pending legal confirmation. */
const UNIVERSALLY_BLOCKED: DocumentCategory[] = [
  'WILL_OR_TESTAMENTARY',
  'PROPERTY_TRANSFER',
  'FAMILY_LAW',
  'NEGOTIABLE_INSTRUMENT',
  'COURT_FILING',
];

/**
 * Reference configurations (docs/07). Indicative and requiring legal
 * confirmation per jurisdiction before real use — see the compliance
 * checklist in docs/07.
 */
export const JURISDICTION_POLICIES: Record<string, JurisdictionPolicy> = {
  US: {
    code: 'US',
    permittedTiers: ['SES', 'AES'],
    minimumIdentityAssurance: 'EMAIL',
    consentRequired: true,
    consentDisclosureText: draftDisclosure('the United States'),
    retentionYears: 7,
    dataResidencyRegion: 'us-east-1',
    requireTimestamp: false,
    // US carve-out beyond the universal list: utility/eviction/insurance
    // notices are blocked state-by-state (docs/07); blocked by default here.
    blockedDocumentCategories: [...UNIVERSALLY_BLOCKED, 'UTILITY_EVICTION_INSURANCE_NOTICE'],
  },
  EU: {
    code: 'EU',
    permittedTiers: ['SES', 'AES'],
    minimumIdentityAssurance: 'EMAIL_OTP',
    consentRequired: false,
    consentDisclosureText: draftDisclosure('the European Union'),
    retentionYears: 10,
    dataResidencyRegion: 'eu-west-1',
    requireTimestamp: false,
    blockedDocumentCategories: [...UNIVERSALLY_BLOCKED],
  },
  IN: {
    code: 'IN',
    permittedTiers: ['SES', 'AES'],
    minimumIdentityAssurance: 'EMAIL_OTP',
    consentRequired: false,
    consentDisclosureText: draftDisclosure('India'),
    retentionYears: 8,
    dataResidencyRegion: 'ap-south-1',
    requireTimestamp: false,
    blockedDocumentCategories: [...UNIVERSALLY_BLOCKED],
  },
  UK: {
    code: 'UK',
    permittedTiers: ['SES', 'AES'],
    minimumIdentityAssurance: 'EMAIL',
    consentRequired: false,
    consentDisclosureText: draftDisclosure('the United Kingdom'),
    retentionYears: 6,
    dataResidencyRegion: 'eu-west-2',
    requireTimestamp: false,
    blockedDocumentCategories: [...UNIVERSALLY_BLOCKED],
  },
};

/** Every code a tenant or an envelope may resolve to. */
export const JURISDICTION_CODES = Object.keys(JURISDICTION_POLICIES);

// Asserted, not optional-chained: JURISDICTION_POLICIES always defines DEFAULT_JURISDICTION_CODE.
const DEFAULT_POLICY: JurisdictionPolicy = JURISDICTION_POLICIES[
  DEFAULT_JURISDICTION_CODE
] as JurisdictionPolicy;

/** An unknown code falls back to the default rather than failing envelope creation. */
export function policyFor(code: string): JurisdictionPolicy {
  return JURISDICTION_POLICIES[code] ?? DEFAULT_POLICY;
}

/**
 * Resolves and freezes a policy (docs/07: "Resolved per tenant, overridable
 * per envelope"). `envelopeCode` is the sender's override for this one
 * envelope; when absent, the tenant's own default is used.
 */
export function resolvePolicySnapshot(
  envelopeCode: string | null | undefined,
  tenantCode: string,
  now: Date = new Date(),
): PolicySnapshot {
  const resolvedFrom = envelopeCode ? 'envelope' : 'tenant';
  const policy = policyFor(envelopeCode ?? tenantCode);
  return {
    ...policy,
    version: JURISDICTION_POLICY_VERSION,
    resolvedAt: now.toISOString(),
    resolvedFrom,
  };
}

/** Whether `category` may be sent electronically under a resolved policy. */
export function isCategoryBlocked(snapshot: PolicySnapshot, category: DocumentCategory): boolean {
  return snapshot.blockedDocumentCategories.includes(category);
}
