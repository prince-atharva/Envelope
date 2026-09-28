import { SetMetadata } from '@nestjs/common';
export const EMBED_ALLOWED = 'embedAllowed';
export type EmbedPermission = 'read' | 'edit' | 'send' | 'upload' | 'close';
export const EmbedAllowed = (permission: EmbedPermission) => SetMetadata(EMBED_ALLOWED, permission);
