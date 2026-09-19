import { createHash } from 'node:crypto';
import {
  NO_MATCH_DETAIL,
  UNSIGNED_ORIGINAL_DETAIL,
  type VerifiedEvent,
  type VerifyResponse,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SYSTEM_ACTOR } from '../audit/audit.service';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';

const PDF_MAGIC = Buffer.from('%PDF-');

/**
 * Public verification (docs/06 "Verification", docs/08 POST /v1/verify).
 *
 * The file is hashed in memory and dropped: it is never stored, and neither
 * it nor the fingerprint of a file that matches nothing is logged, because
 * people will check private documents here.
 *
 * Only versions that carry signatures are reported on. Version 0 is the
 * document as uploaded, often a template many senders use, so a match on it
 * reveals nothing about any envelope.
 */
@Injectable()
export class VerifyService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(VerifyService.name) private readonly logger: PinoLogger,
  ) {}

  async verify(file: Buffer): Promise<VerifyResponse> {
    const started = performance.now();
    // The header may sit after a little junk (the PDF spec allows 1 KB).
    if (file.length === 0 || file.subarray(0, 1024).indexOf(PDF_MAGIC) === -1) {
      this.logger.info({ sizeBytes: file.length }, 'Verify rejected: not a PDF');
      throw new AppException('UNSUPPORTED_FILE_TYPE', 'Choose a PDF file to check.');
    }
    const documentHash = createHash('sha256').update(file).digest('hex');
    const done = (outcome: string, extra: Record<string, unknown> = {}) =>
      this.logger.info(
        {
          outcome,
          sizeBytes: file.length,
          durationMs: Math.round(performance.now() - started),
          ...extra,
        },
        'Document verified',
      );

    const matches = await this.prisma.documentVersion.findMany({
      where: { hash: documentHash },
      select: { envelopeId: true, versionNumber: true, isFinal: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    // A signed copy is the same bytes in one envelope only; if two ever were,
    // the sealed one, then the newest, is reported.
    const signed = matches
      .filter((match) => match.versionNumber > 0)
      .sort((a, b) => Number(b.isFinal) - Number(a.isFinal))[0];

    if (!signed) {
      if (matches.length > 0) {
        done('unsigned-original', { matches: matches.length });
        return {
          verified: false,
          documentHash,
          reason: 'UNSIGNED_ORIGINAL',
          detail: UNSIGNED_ORIGINAL_DETAIL,
        };
      }
      done('no-match');
      return {
        verified: false,
        documentHash,
        reason: 'NO_MATCHING_DOCUMENT',
        detail: NO_MATCH_DETAIL,
      };
    }

    const envelope = await this.prisma.envelope.findUniqueOrThrow({
      where: { id: signed.envelopeId },
      include: {
        owner: { select: { id: true, fullName: true } },
        recipients: { orderBy: [{ routingOrder: 'asc' }, { createdAt: 'asc' }] },
        versions: { orderBy: { versionNumber: 'asc' } },
        auditLogs: { orderBy: { sequence: 'asc' } },
      },
    });
    const names = new Map(envelope.recipients.map((r) => [r.id, r.name]));
    const actor = (event: (typeof envelope.auditLogs)[number]): string => {
      if (event.recipientId) return names.get(event.recipientId) ?? 'Recipient';
      if (event.actorUserId) {
        return event.actorUserId === envelope.owner.id ? envelope.owner.fullName : 'Sender';
      }
      return event.ipAddress === SYSTEM_ACTOR.ipAddress ? 'System' : 'Unknown';
    };

    done(signed.isFinal ? 'sealed' : 'in-progress', {
      envelopeId: envelope.id,
      versionNumber: signed.versionNumber,
    });
    return {
      verified: true,
      documentHash,
      envelopeId: envelope.id,
      title: envelope.title,
      status: envelope.status,
      completedAt: envelope.completedAt?.toISOString() ?? null,
      matched: { versionNumber: signed.versionNumber, isFinal: signed.isFinal },
      signers: envelope.recipients
        .filter((r) => r.role === 'SIGNER' || r.role === 'APPROVER')
        .map((r) => ({
          name: r.name,
          email: r.email,
          role: r.role === 'APPROVER' ? 'APPROVER' : 'SIGNER',
          signedAt: r.signedAt?.toISOString() ?? null,
          ipAddress: r.signedAt ? r.signedFromIp : null,
        })),
      versionChain: envelope.versions.map((version) => ({
        versionNumber: version.versionNumber,
        sha256: version.hash,
        signedBy: version.createdByRecipientId
          ? (names.get(version.createdByRecipientId) ?? 'Recipient')
          : null,
        isFinal: version.isFinal,
        createdAt: version.createdAt.toISOString(),
      })),
      events: envelope.auditLogs.map(
        (event): VerifiedEvent => ({
          sequence: event.sequence,
          timestamp: event.timestamp.toISOString(),
          action: event.action,
          actor: actor(event),
        }),
      ),
    };
  }
}
