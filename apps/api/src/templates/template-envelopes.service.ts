import { type CreateFromTemplateInput, type EnvelopeDetail } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { ownerScopeOf } from '../auth/ownership';
import { EnvelopesService } from '../envelopes/envelopes.service';
import { SendingService } from '../sending/sending.service';
import { TemplatesService } from './templates.service';

/**
 * The API's way of turning a template into one envelope. Bulk send reaches
 * `TemplatesService.instantiate` and `SendingService` directly from the worker,
 * which has no need of the envelope detail this returns.
 */
@Injectable()
export class TemplateEnvelopesService {
  constructor(
    private readonly templates: TemplatesService,
    private readonly sending: SendingService,
    private readonly envelopes: EnvelopesService,
  ) {}

  /** Creates one envelope, sends it if asked, and answers with its detail. */
  async create(
    user: AuthenticatedUser,
    templateId: string,
    input: CreateFromTemplateInput,
    client: ClientInfo,
  ): Promise<{ envelopeId: string; detail: EnvelopeDetail }> {
    const { envelopeId, reminderIntervalDays } = await this.templates.instantiate(
      user,
      templateId,
      input,
      client,
    );
    if (input.send) {
      await this.sending.send(
        envelopeId,
        reminderIntervalDays === null ? {} : { reminderIntervalDays },
        user,
        client,
      );
    }
    return { envelopeId, detail: await this.detail(envelopeId, user) };
  }

  /** The detail of an envelope this caller may see; also what a replayed create answers with. */
  detail(envelopeId: string, user: AuthenticatedUser): Promise<EnvelopeDetail> {
    return this.envelopes.get(envelopeId, ownerScopeOf(user));
  }
}
