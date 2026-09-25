import { describe, expect, it } from 'vitest';
import { DOCUMENT_CATEGORIES } from './document-categories';
import {
  isCategoryBlocked,
  JURISDICTION_CODES,
  JURISDICTION_POLICIES,
  JURISDICTION_POLICY_VERSION,
  policyFor,
  resolvePolicySnapshot,
} from './jurisdiction';

describe('policyFor', () => {
  it('resolves every reference code to its own policy', () => {
    for (const code of JURISDICTION_CODES) {
      expect(policyFor(code).code).toBe(code);
    }
  });

  it('falls back to US for an unknown code, rather than throwing', () => {
    expect(policyFor('XX').code).toBe('US');
    expect(policyFor('')).toBe(JURISDICTION_POLICIES.US);
  });
});

describe('resolvePolicySnapshot', () => {
  it('prefers the envelope override over the tenant default', () => {
    const snapshot = resolvePolicySnapshot('EU', 'US');
    expect(snapshot.code).toBe('EU');
    expect(snapshot.resolvedFrom).toBe('envelope');
  });

  it('falls back to the tenant default when the envelope has no override', () => {
    const snapshot = resolvePolicySnapshot(null, 'IN');
    expect(snapshot.code).toBe('IN');
    expect(snapshot.resolvedFrom).toBe('tenant');
  });

  it('freezes the version and a resolution timestamp onto the snapshot', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const snapshot = resolvePolicySnapshot(undefined, 'US', now);
    expect(snapshot.version).toBe(JURISDICTION_POLICY_VERSION);
    expect(snapshot.resolvedAt).toBe(now.toISOString());
  });

  it('carries every field of the underlying policy, unmodified', () => {
    const snapshot = resolvePolicySnapshot('UK', 'US');
    const policy = JURISDICTION_POLICIES.UK;
    expect(snapshot.permittedTiers).toEqual(policy.permittedTiers);
    expect(snapshot.consentDisclosureText).toBe(policy.consentDisclosureText);
    expect(snapshot.retentionYears).toBe(policy.retentionYears);
    expect(snapshot.dataResidencyRegion).toBe(policy.dataResidencyRegion);
  });
});

describe('isCategoryBlocked', () => {
  it('blocks a will everywhere', () => {
    for (const code of JURISDICTION_CODES) {
      const snapshot = resolvePolicySnapshot(code, code);
      expect(isCategoryBlocked(snapshot, 'WILL_OR_TESTAMENTARY')).toBe(true);
    }
  });

  it('never blocks an ordinary commercial contract', () => {
    for (const code of JURISDICTION_CODES) {
      const snapshot = resolvePolicySnapshot(code, code);
      expect(isCategoryBlocked(snapshot, 'COMMERCIAL_CONTRACT')).toBe(false);
    }
  });

  it('every blocked category is a real, known category', () => {
    for (const policy of Object.values(JURISDICTION_POLICIES)) {
      for (const category of policy.blockedDocumentCategories) {
        expect(DOCUMENT_CATEGORIES).toContain(category);
      }
    }
  });
});

describe('reference policies', () => {
  it('US requires consent; the others do not (docs/07)', () => {
    expect(JURISDICTION_POLICIES.US.consentRequired).toBe(true);
    expect(JURISDICTION_POLICIES.EU.consentRequired).toBe(false);
    expect(JURISDICTION_POLICIES.IN.consentRequired).toBe(false);
    expect(JURISDICTION_POLICIES.UK.consentRequired).toBe(false);
  });

  it('every policy names a real document category (never an empty list mistaken for "nothing blocked")', () => {
    for (const policy of Object.values(JURISDICTION_POLICIES)) {
      expect(policy.blockedDocumentCategories.length).toBeGreaterThan(0);
    }
  });
});
