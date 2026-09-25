import {
  type AddRecipientInput,
  addRecipientSchema,
  type RecipientResponse,
  type SaveFieldsInput,
  type SaveFieldsResponse,
  saveFieldsSchema,
  type UpdateEnvelopeInput,
  type UpdateRecipientInput,
  updateEnvelopeSchema,
  updateRecipientSchema,
} from '@envelope/shared';
import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyAllowed } from '../auth/api-key.decorator';
import { Client, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { rejectPixelCoordinates } from './draft-validation';
import { DraftsService } from './drafts.service';

const IF_MATCH_HEADER = {
  name: 'If-Match',
  required: false,
  description:
    'The draftRevision the client last saw, in quotes. A stale value is refused with 412 ' +
    "rather than overwriting another tab's work.",
};

/**
 * Reads the revision out of an If-Match header.
 *
 * Accepts both `"7"` and `7`. Anything unparseable is treated as absent: a
 * malformed header should not silently disable the check, but nor is it worth
 * failing a save over, so the request simply takes the unconditional path.
 */
function parseIfMatch(header?: string): number | undefined {
  if (!header) return undefined;
  const revision = Number.parseInt(header.replace(/^W\//, '').replaceAll('"', '').trim(), 10);
  return Number.isInteger(revision) && revision >= 0 ? revision : undefined;
}

/** Turns pixel coordinates into INVALID_COORDINATE_SPACE before zod sees them. */
class PixelCoordinateGuardPipe {
  transform(value: unknown): unknown {
    rejectPixelCoordinates(value);
    return value;
  }
}

@ApiTags('drafts')
@ApiBearerAuth()
@Controller('envelopes')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Patch(':id')
  @ApiKeyAllowed({ write: true })
  @ApiOperation({ summary: 'Change a draft envelope: title, message, signing order' })
  @ApiHeader(IF_MATCH_HEADER)
  @ApiBody({ schema: openApiSchema(updateEnvelopeSchema) })
  updateEnvelope(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateEnvelopeSchema)) body: UpdateEnvelopeInput,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Headers('if-match') ifMatch?: string,
  ): Promise<{ draftRevision: number }> {
    return this.drafts.updateEnvelope(id, body, user, client, parseIfMatch(ifMatch));
  }

  @Post(':id/recipients')
  @ApiKeyAllowed({ write: true })
  @ApiOperation({ summary: 'Add someone to a draft' })
  @ApiHeader(IF_MATCH_HEADER)
  @ApiBody({ schema: openApiSchema(addRecipientSchema) })
  addRecipient(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(addRecipientSchema)) body: AddRecipientInput,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Headers('if-match') ifMatch?: string,
  ): Promise<RecipientResponse> {
    return this.drafts.addRecipient(id, body, user, client, parseIfMatch(ifMatch));
  }

  @Patch(':id/recipients/:recipientId')
  @ApiKeyAllowed({ write: true })
  @ApiOperation({ summary: 'Change someone on a draft' })
  @ApiHeader(IF_MATCH_HEADER)
  @ApiBody({ schema: openApiSchema(updateRecipientSchema) })
  updateRecipient(
    @Param('id', UuidParamPipe) id: string,
    @Param('recipientId', UuidParamPipe) recipientId: string,
    @Body(new ZodValidationPipe(updateRecipientSchema)) body: UpdateRecipientInput,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Headers('if-match') ifMatch?: string,
  ): Promise<RecipientResponse> {
    return this.drafts.updateRecipient(id, recipientId, body, user, client, parseIfMatch(ifMatch));
  }

  @Delete(':id/recipients/:recipientId')
  @HttpCode(200)
  @ApiKeyAllowed({ write: true })
  @ApiOperation({ summary: 'Remove someone from a draft, along with their fields' })
  @ApiHeader(IF_MATCH_HEADER)
  removeRecipient(
    @Param('id', UuidParamPipe) id: string,
    @Param('recipientId', UuidParamPipe) recipientId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Headers('if-match') ifMatch?: string,
  ): Promise<{ draftRevision: number }> {
    return this.drafts.removeRecipient(id, recipientId, user, client, parseIfMatch(ifMatch));
  }

  /**
   * Replaces the whole field layout. The builder holds all of it, so a partial
   * update would only add ways for the two to disagree.
   */
  @Put(':id/fields')
  @ApiKeyAllowed({ write: true })
  @ApiOperation({ summary: 'Save where everyone signs (replaces the whole layout)' })
  @ApiHeader(IF_MATCH_HEADER)
  @ApiBody({ schema: openApiSchema(saveFieldsSchema) })
  saveFields(
    @Param('id', UuidParamPipe) id: string,
    // The pixel-coordinate check runs before the pipe, so that mistake gets its
    // own error code instead of a generic validation failure (docs/08).
    @Body(new PixelCoordinateGuardPipe(), new ZodValidationPipe(saveFieldsSchema))
    body: SaveFieldsInput,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Headers('if-match') ifMatch?: string,
  ): Promise<SaveFieldsResponse> {
    return this.drafts.saveFields(id, body, user, client, parseIfMatch(ifMatch));
  }
}
