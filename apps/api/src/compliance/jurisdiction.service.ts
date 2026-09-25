import {
  type DocumentCategory,
  isCategoryBlocked,
  type PolicySnapshot,
  resolvePolicySnapshot,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';

const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  COMMERCIAL_CONTRACT: 'Commercial contract',
  EMPLOYMENT_AGREEMENT: 'Employment agreement',
  NDA: 'Non-disclosure agreement',
  CONSENT_FORM: 'Consent form',
  FINANCIAL_AGREEMENT: 'Financial agreement',
  REAL_ESTATE_LEASE: 'Real estate lease',
  WILL_OR_TESTAMENTARY: 'Will or testamentary document',
  PROPERTY_TRANSFER: 'Property transfer or conveyance',
  FAMILY_LAW: 'Family law document',
  NEGOTIABLE_INSTRUMENT: 'Negotiable instrument',
  COURT_FILING: 'Court filing',
  UTILITY_EVICTION_INSURANCE_NOTICE: 'Utility, eviction or insurance cancellation notice',
  OTHER: 'Other document',
};

/**
 * Resolves and freezes a JurisdictionPolicy (docs/07, ADR 0011). Policies
 * themselves are versioned code (packages/shared/src/jurisdiction.ts), never
 * a database table; this service's only job is the one live read that
 * chooses which policy applies — the tenant's default, unless the sender
 * overrides it for this one envelope — before the result is frozen onto the
 * envelope for good.
 */
@Injectable()
export class JurisdictionService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(JurisdictionService.name) private readonly logger: PinoLogger,
  ) {}

  async resolveForTenant(
    tenantId: string,
    envelopeCode: string | null | undefined,
  ): Promise<PolicySnapshot> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { jurisdictionCode: true },
    });
    const snapshot = resolvePolicySnapshot(envelopeCode, tenant.jurisdictionCode);
    this.logger.debug(
      { tenantId, resolvedCode: snapshot.code, resolvedFrom: snapshot.resolvedFrom },
      'Jurisdiction policy resolved',
    );
    return snapshot;
  }

  /** Rejects with the category and jurisdiction named, per docs/07's requirement. */
  assertCategoryAllowed(snapshot: PolicySnapshot, category: DocumentCategory): void {
    if (!isCategoryBlocked(snapshot, category)) return;
    this.logger.info(
      { jurisdictionCode: snapshot.code, category },
      'Envelope creation refused: document category blocked in this jurisdiction',
    );
    throw new AppException(
      'DOCUMENT_CATEGORY_BLOCKED',
      `${CATEGORY_LABEL[category]} cannot be sent electronically in ${snapshot.code}. ` +
        'Some document types still require a paper original or a notary in this jurisdiction.',
      { errors: [{ path: 'documentCategory', message: `Blocked in ${snapshot.code}` }] },
    );
  }
}
