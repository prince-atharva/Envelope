import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { uploadErrorFor } from './upload.guards';

function multerError(code: string): Error {
  return Object.assign(new Error(`multer: ${code}`), { name: 'MulterError', code });
}

describe('uploadErrorFor', () => {
  it.each([
    [multerError('LIMIT_FILE_SIZE'), 'FILE_TOO_LARGE'],
    [multerError('LIMIT_UNEXPECTED_FILE'), 'FILE_REQUIRED'],
    [multerError('LIMIT_FILE_COUNT'), 'FILE_REQUIRED'],
    [multerError('LIMIT_PART_COUNT'), 'BAD_REQUEST'],
    [new PayloadTooLargeException(), 'FILE_TOO_LARGE'],
    [new BadRequestException('Unexpected field'), 'FILE_REQUIRED'],
  ])('maps %s to %s', (error, code) => {
    expect(uploadErrorFor(error)?.code).toBe(code);
  });

  it('leaves unrelated errors alone', () => {
    expect(uploadErrorFor(new NotFoundException())).toBeUndefined();
    expect(uploadErrorFor(new Error('database down'))).toBeUndefined();
  });
});
