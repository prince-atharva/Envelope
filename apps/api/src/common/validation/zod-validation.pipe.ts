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
    // Multer and the query parser build objects without a prototype; copy them first.
    const input =
      value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === null
        ? { ...value }
        : value;
    return this.schema.parse(input);
  }
}

/** OpenAPI 3.0 schema for Swagger decorators, generated from the same zod schema. */
export function openApiSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as SchemaObject;
}
