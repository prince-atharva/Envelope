import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AlertService } from '../alert/alert.service';
import { verifyChain } from '../audit/audit-chain';
import type { AuditTrail } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SweepResult } from './expiry-sweep.service';

/** Envelopes checked per database round trip. */
const BATCH = 100;
/** Envelope ids listed in the alert email; the log has every one. */
const IDS_IN_ALERT = 10;

/**
 * The event a status cannot exist without (ADR 0004). A chain can be valid yet
 * short, if its newest events were deleted by someone able to bypass the
 * database privileges; a completed envelope with no ENVELOPE_COMPLETED is how
 * that shows.
 */
export const REQUIRED_EVENT: Readonly<Record<string, string>> = {
  COMPLETED: 'ENVELOPE_COMPLETED',
  VOIDED: 'ENVELOPE_VOIDED',
  EXPIRED: 'ENVELOPE_EXPIRED',
  DECLINED: 'RECIPIENT_DECLINED',
};

export interface ChainBreak {
  envelopeId: string;
  reason: string;
  /** The first bad event, when the chain itself is broken. */
  sequence: number | null;
}

export interface ChainCheckResult extends SweepResult {
  breaks: ChainBreak[];
}

/** Checks one envelope's events: the chain, then the event its status requires. */
export function checkEnvelope(
  envelope: { id: string; status: string },
  events: Parameters<typeof verifyChain>[0],
): ChainBreak | null {
  const chain = verifyChain(events);
  if (!chain.valid) {
    return {
      envelopeId: envelope.id,
      reason: chain.brokenAt.reason,
      sequence: chain.brokenAt.sequence,
    };
  }
  const required = REQUIRED_EVENT[envelope.status];
  if (required && !events.some((event) => event.action === required)) {
    return { envelopeId: envelope.id, reason: `missing ${required}`, sequence: null };
  }
  return null;
}

/**
 * The nightly audit-chain check (docs/16 step 12, ADR 0004). Walks every
 * envelope by id, a batch at a time, recomputing each chain and checking each
 * status has its event. Every break of a run goes into one alert, raised again
 * each night while it lasts. Sending is never stopped automatically: doc 10's
 * "halt sending" is a person's decision.
 */
@Injectable()
export class AuditChainCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
    @InjectPinoLogger(AuditChainCheckService.name) private readonly logger: PinoLogger,
  ) {}

  /** @param options.alert False for the command-line check, which reports by its exit code. */
  async run(options: { alert?: boolean; now?: Date } = {}): Promise<ChainCheckResult> {
    const breaks: ChainBreak[] = [];
    let scanned = 0;
    let after: string | undefined;

    for (;;) {
      const envelopes = await this.prisma.envelope.findMany({
        where: after ? { id: { gt: after } } : {},
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, status: true },
      });
      if (envelopes.length === 0) break;
      after = envelopes.at(-1)?.id;
      scanned += envelopes.length;

      const events = await this.prisma.auditTrail.findMany({
        where: { envelopeId: { in: envelopes.map((e) => e.id) } },
        orderBy: [{ envelopeId: 'asc' }, { sequence: 'asc' }],
      });
      const byEnvelope = new Map<string, AuditTrail[]>();
      for (const event of events) {
        const list = byEnvelope.get(event.envelopeId) ?? [];
        list.push(event);
        byEnvelope.set(event.envelopeId, list);
      }

      for (const envelope of envelopes) {
        const found = checkEnvelope(envelope, byEnvelope.get(envelope.id) ?? []);
        if (!found) continue;
        breaks.push(found);
        this.logger.error({ ...found }, 'Audit chain break');
      }
    }

    if (breaks.length > 0 && options.alert !== false) {
      const date = (options.now ?? new Date()).toISOString().slice(0, 10);
      await this.alerts.raise(
        `chain-check-${date}`,
        `Audit chain check found ${breaks.length} envelope(s) with a broken or incomplete trail`,
        {
          checked: scanned,
          broken: breaks.length,
          envelopes: breaks
            .slice(0, IDS_IN_ALERT)
            .map((b) => b.envelopeId)
            .join(', '),
        },
      );
    }
    return { scanned, changed: 0, failed: 0, broken: breaks.length, breaks };
  }
}
