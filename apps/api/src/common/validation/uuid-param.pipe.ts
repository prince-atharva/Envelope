import type { PipeTransform } from '@nestjs/common';
import { AppException } from '../errors/app-exception';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route ids must be UUIDs. Anything else is answered exactly like an id that does
 * not exist (docs/10: uniform 404s), instead of a validation error.
 */
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new AppException('NOT_FOUND');
    return value.toLowerCase();
  }
}
