import {
  PDFArray,
  type PDFContext,
  PDFDict,
  type PDFDocument,
  PDFName,
  type PDFObject,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

/**
 * Action types that run code, open other files or send data somewhere. Links
 * (URI) and in-document navigation (GoTo, Named) are harmless and kept.
 */
const DANGEROUS_ACTIONS = new Set([
  'JavaScript',
  'Launch',
  'ImportData',
  'SubmitForm',
  'RichMediaExecute',
  'GoToE',
  'GoToR',
  'Rendition',
]);

const name = (value: string) => PDFName.of(value);

/**
 * Removes active content from a parsed PDF, in place (docs/10, upload step 6):
 * JavaScript, launch/submit/remote actions, automatic "additional actions",
 * embedded files and XFA forms. Returns what was removed, or [] when the
 * document was already clean (and was not touched).
 */
export function stripActiveContent(doc: PDFDocument): string[] {
  const context: PDFContext = doc.context;
  const removed = new Set<string>();
  const visited = new Set<PDFDict>();
  const orphaned = new Set<PDFRef>();

  const resolve = (value: PDFObject | undefined): PDFObject | undefined =>
    value instanceof PDFRef ? context.lookup(value) : value;

  const actionType = (value: PDFObject | undefined): string | undefined => {
    const dict = resolve(value);
    if (!(dict instanceof PDFDict)) return undefined;
    const type = dict.get(name('S'));
    return type instanceof PDFName ? type.decodeText() : undefined;
  };

  const isDangerous = (value: PDFObject | undefined): boolean => {
    const type = actionType(value);
    return type !== undefined && DANGEROUS_ACTIONS.has(type);
  };

  const dropKey = (dict: PDFDict, key: string, label: string) => {
    const value = dict.get(name(key));
    if (value === undefined) return;
    if (value instanceof PDFRef) orphaned.add(value);
    dict.delete(name(key));
    removed.add(label);
  };

  const clean = (dict: PDFDict): void => {
    if (visited.has(dict)) return;
    visited.add(dict);

    // Actions that fire automatically (page open, field focus, document close, ...).
    dropKey(dict, 'AA', 'additional-actions');

    for (const key of ['A', 'OpenAction']) {
      const value = dict.get(name(key));
      if (isDangerous(value)) dropKey(dict, key, `action:${actionType(value)}`);
    }

    // Action chains: /Next is a single action or an array of them.
    const next = dict.get(name('Next'));
    if (next !== undefined) {
      const chain = resolve(next);
      const items = chain instanceof PDFArray ? chain.asArray() : [next];
      if (items.some(isDangerous)) dropKey(dict, 'Next', 'action-chain');
    }

    // An action dictionary that is itself dangerous: remove its payload too, in
    // case it is still reachable from somewhere this pass did not visit.
    if (isDangerous(dict)) {
      dropKey(dict, 'JS', 'javascript');
      for (const key of ['F', 'Win', 'Mac', 'Unix']) dropKey(dict, key, 'launch-target');
    }

    dropKey(dict, 'JavaScript', 'javascript'); // document-level scripts (Names tree)
    dropKey(dict, 'EmbeddedFiles', 'embedded-files'); // attachments (Names tree)
    dropKey(dict, 'XFA', 'xfa'); // XFA forms can carry scripts

    const embedded = dict.get(name('EF'));
    if (embedded !== undefined) {
      const streams = resolve(embedded);
      if (streams instanceof PDFDict) {
        for (const [, stream] of streams.entries()) {
          if (stream instanceof PDFRef) orphaned.add(stream);
        }
      }
      dropKey(dict, 'EF', 'embedded-files');
    }

    const subtype = dict.get(name('Subtype'));
    if (subtype instanceof PDFName && subtype.decodeText() === 'FileAttachment') {
      dropKey(dict, 'FS', 'file-attachment');
    }

    // Direct (inline) dictionaries and arrays nested inside this one.
    for (const [, value] of dict.entries()) walk(value);
  };

  const walk = (value: PDFObject | undefined): void => {
    if (value instanceof PDFDict) clean(value);
    else if (value instanceof PDFStream) clean(value.dict);
    else if (value instanceof PDFArray) for (const item of value.asArray()) walk(item);
  };

  for (const [, object] of context.enumerateIndirectObjects()) walk(object);

  // Unreferenced script and attachment objects would still be written out by
  // save(), so delete them from the document entirely.
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (isDangerous(object)) orphaned.add(ref);
  }
  for (const ref of orphaned) context.delete(ref);

  return [...removed].sort();
}
