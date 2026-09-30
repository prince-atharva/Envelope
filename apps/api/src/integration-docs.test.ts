import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  GENERATED_SECTIONS,
  generatedSectionNames,
  renderGeneratedSections,
} from '@envelope/shared';
import { describe, expect, it } from 'vitest';

// The partner-facing guide must agree with the catalog (ADR 0021). Regenerate its tables with
// UPDATE_DEVELOPER_DOCS=1 pnpm --filter @envelope/api test.
const DOCS = path.resolve(__dirname, '../../../docs/developers');
const pages = readdirSync(DOCS).filter((file) => file.endsWith('.md'));

const EXPECTED_PAGES = [
  'README.md',
  'authentication.md',
  'concepts.md',
  'embedded-editor.md',
  'envelopes.md',
  'errors.md',
  'limits.md',
  'quick-start.md',
  'recipes.md',
  'reference.md',
  'templates.md',
  'webhooks.md',
];

describe('developer guide', () => {
  it('contains every page the index promises', () => {
    expect(pages.sort()).toEqual([...EXPECTED_PAGES].sort());
    expect(existsSync(path.join(DOCS, 'openapi.json'))).toBe(true);
  });

  it.each(EXPECTED_PAGES)('%s: generated sections match the catalog', (page) => {
    const file = path.join(DOCS, page);
    const current = readFileSync(file, 'utf8');
    const expected = renderGeneratedSections(current);
    if (process.env.UPDATE_DEVELOPER_DOCS === '1' && expected !== current)
      writeFileSync(file, expected);
    else expect(current).toBe(expected);
  });

  it('uses every generated section somewhere, and no unknown one', () => {
    const used = new Set(
      pages.flatMap((page) => generatedSectionNames(readFileSync(path.join(DOCS, page), 'utf8'))),
    );
    expect([...used].sort()).toEqual(Object.keys(GENERATED_SECTIONS).sort());
  });

  it('opens every page with the standard header table', () => {
    for (const page of pages) {
      const text = readFileSync(path.join(DOCS, page), 'utf8');
      for (const label of [
        'Status',
        'Version',
        'Last updated',
        'Audience',
        'What this doc answers',
      ])
        expect(text, `${page} lacks ${label}`).toContain(`| **${label}** |`);
      expect(text, page).toContain('## In Plain Terms');
      expect(text, page).toContain('## Technical Detail');
    }
  });

  it('links only to files that exist', () => {
    for (const page of pages) {
      const text = readFileSync(path.join(DOCS, page), 'utf8');
      for (const [, target] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (/^https?:/.test(target as string)) continue;
        expect(existsSync(path.join(DOCS, target as string)), `${page} -> ${target}`).toBe(true);
      }
    }
  });

  it('never tells a partner to put an id or key in a URL', () => {
    for (const page of pages) {
      const text = readFileSync(path.join(DOCS, page), 'utf8');
      expect(text, page).not.toMatch(/\/envelopes\/[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(text, page).not.toMatch(/eak_[a-f0-9]{8}/);
    }
  });

  it('does not repeat the claims the audit found wrong in docs/08', () => {
    for (const page of pages) {
      const text = readFileSync(path.join(DOCS, page), 'utf8');
      expect(text, page).not.toContain('api.{host}');
      expect(text, page).not.toContain('/documents/original` and');
      expect(text, page).not.toMatch(/8 (of 9 )?webhook events/);
    }
  });
});
