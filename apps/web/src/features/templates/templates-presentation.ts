import type { RecipientRole } from '@envelope/shared';

const ROLE_KIND_LABEL: Record<RecipientRole, string> = {
  SIGNER: 'Signs',
  APPROVER: 'Approves',
  VIEWER: 'Views',
  CC: 'Gets a copy',
};

/** What a role does, in a word: "Signs", "Gets a copy". */
export function roleKindLabel(role: RecipientRole): string {
  return ROLE_KIND_LABEL[role];
}

/** "2 pages · 1 role · 3 fields", for a template card. */
export function templateFacts(template: {
  pageCount: number;
  roleCount: number;
  fieldCount: number;
}): string {
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return [
    count(template.pageCount, 'page'),
    count(template.roleCount, 'role'),
    count(template.fieldCount, 'field'),
  ].join(' · ');
}
