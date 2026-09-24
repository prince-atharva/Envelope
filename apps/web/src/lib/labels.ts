import type { FieldType, RecipientRole } from '@envelope/shared';

/**
 * The words the product uses, in one place.
 *
 * Before this, the builder canvas, the field palette, the review screen and the
 * signer portal each kept their own map, and they had drifted: the same box was
 * a "Checkbox" on Review and a "Tick box" on the canvas a click earlier. The
 * plain wording below is the one the signer portal already speaks, so it is the
 * one everything else moves to.
 */
export const FIELD_LABEL: Record<FieldType, string> = {
  SIGNATURE: 'Signature',
  INITIALS: 'Initials',
  DATE_SIGNED: 'Date',
  TEXT_INPUT: 'Text',
  CHECKBOX: 'Tick box',
};

/** What a recipient is asked to do, in the second person the sender reads. */
export const ROLE_LABEL: Record<RecipientRole, string> = {
  SIGNER: 'Signs',
  APPROVER: 'Approves',
  VIEWER: 'Views only',
  CC: 'Gets a copy',
};

/**
 * The same role as a noun, for prose like "2 signers". Screens used to render
 * `role.toLowerCase()` here, which leaked the enum spelling to the reader.
 */
export const ROLE_NOUN: Record<RecipientRole, string> = {
  SIGNER: 'signer',
  APPROVER: 'approver',
  VIEWER: 'viewer',
  CC: 'copy recipient',
};

/** Plurals that are not just "+s". */
const FIELD_PLURAL: Partial<Record<FieldType, string>> = {
  INITIALS: 'Initials',
  CHECKBOX: 'Tick boxes',
};

/** "1 signature", "3 tick boxes" — lower case, for use inside a sentence. */
export function countFields(type: FieldType, count: number): string {
  const one = FIELD_LABEL[type].toLowerCase();
  const many = (FIELD_PLURAL[type] ?? `${FIELD_LABEL[type]}s`).toLowerCase();
  return `${count} ${count === 1 ? one : many}`;
}

export function roleNoun(role: RecipientRole): string {
  return ROLE_NOUN[role];
}

/** "Asha", "Asha and Raj", "Asha, Raj and Priya" — one list formatter, was three. */
export function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * "Everyone at once", or "One after another: Raj Patel, then Priya Sharma".
 *
 * The review screen is the last stop before an irreversible send, so it names
 * the order rather than only explaining that an order exists.
 */
export function describeSigningOrder(sequential: boolean, people: { name: string }[]): string {
  if (!sequential) return 'Everyone at once';
  if (people.length < 2) return 'One after another';
  return `One after another: ${people.map((person) => person.name).join(', then ')}`;
}
