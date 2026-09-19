/**
 * The name a downloaded version is saved under: the original's for v0,
 * "(signed)" for the sealed document, as in the completion email, and the
 * version number for a copy made while signing was under way.
 */
export function downloadName(
  originalFilename: string,
  version: { versionNumber: number; isFinal: boolean },
): string {
  if (version.versionNumber === 0) return originalFilename;
  const stem = originalFilename.replace(/\.pdf$/i, '') || 'document';
  return version.isFinal ? `${stem} (signed).pdf` : `${stem} (v${version.versionNumber}).pdf`;
}
