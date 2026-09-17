import type { PipeTransform } from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Validates a request part against a shared zod schema.
 *   @Body(new ZodValidationPipe(loginSchema)) body: LoginInput
 * A ZodError becomes a 400 VALIDATION_FAILED response with per-field errors.
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    return this.schema.parse(value);
  }
}

/** OpenAPI 3.0 schema for Swagger decorators, generated from the same zod schema. */
export function openApiSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as SchemaObject;
}
