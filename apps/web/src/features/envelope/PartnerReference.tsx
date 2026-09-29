import type { EnvelopeMetadata } from '@envelope/shared';

/**
 * The integrating partner's own reference for this document and the small
 * labels it attached (docs/18 workstream 10, ADR 0019), so a sender looking at
 * an API-created envelope can tell which of the partner's records it is.
 * Renders nothing for a document with neither.
 */
export function PartnerReference({
  externalId,
  metadata,
}: {
  externalId: string | null;
  metadata: EnvelopeMetadata | null;
}) {
  const labels = Object.entries(metadata ?? {});
  if (!externalId && labels.length === 0) return null;
  return (
    <fieldset
      aria-label="Partner reference"
      className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-0 p-0"
    >
      {externalId && (
        <span>
          Reference{' '}
          <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
            {externalId}
          </code>
        </span>
      )}
      {labels.map(([key, value]) => (
        <span key={key} className="break-all rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
          {key}: {value}
        </span>
      ))}
    </fieldset>
  );
}
