import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
export const GALLERY_DIR = resolve(here, '../../.e2e/gallery');
const INDEX_JSON = join(GALLERY_DIR, 'shots.json');

export interface ShotRecord {
  order: number;
  area: string;
  name: string;
  caption: string;
  device: string;
  file: string;
}

export interface ShotOptions {
  /** Which part of the journey this belongs to, used to group the contact sheet. */
  area: string;
  /** One sentence on what a reviewer should be looking at. */
  caption: string;
  /** Capture the whole scrollable page rather than just the viewport. */
  fullPage?: boolean;
  /** Elements whose contents change run to run: timestamps, hashes, emails. */
  mask?: Locator[];
}

const counters = new Map<string, number>();

/**
 * Captures one screenshot and records it for the contact sheet.
 *
 * Files are named `NN-area-name-device.png` so the directory reads in journey
 * order rather than alphabetically, which matters when the point is to flip
 * through the whole product in sequence.
 */
export async function shot(page: Page, name: string, options: ShotOptions): Promise<void> {
  const device = testDevice(page);
  const order = (counters.get(device) ?? 0) + 1;
  counters.set(device, order);
  const file = `${String(order).padStart(2, '0')}-${options.area}-${name}-${device}.png`;

  mkdirSync(GALLERY_DIR, { recursive: true });

  // Fonts and any in-flight entrance animation must be done, or the shot
  // catches a half-faded modal or a fallback face.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  await page.screenshot({
    path: join(GALLERY_DIR, file),
    fullPage: options.fullPage ?? false,
    mask: options.mask,
    maskColor: '#cbd5e1',
    animations: 'disabled',
  });

  record({ order, area: options.area, name, caption: options.caption, device, file });
}

function testDevice(page: Page): string {
  const size = page.viewportSize();
  if (!size) return 'unknown';
  if (size.width < 500) return 'mobile';
  if (size.width < 1024) return 'tablet';
  return 'desktop';
}

function record(entry: ShotRecord): void {
  let all: ShotRecord[] = [];
  try {
    all = JSON.parse(readFileSync(INDEX_JSON, 'utf8')) as ShotRecord[];
  } catch {
    // First shot of the run.
  }
  all = all.filter((item) => item.file !== entry.file);
  all.push(entry);
  writeFileSync(INDEX_JSON, JSON.stringify(all, null, 2));
}

/**
 * Waits for the document pane to have drawn something.
 *
 * The first page's canvas is the signal that works everywhere. The field
 * overlay marker only exists in the builder, so waiting on it hangs on every
 * other screen that shows a document.
 */
export async function pdfReady(page: Page): Promise<void> {
  await expect(page.locator('[data-page-number="1"] canvas').first()).toBeVisible({
    timeout: 45_000,
  });
  await page.waitForTimeout(500);
}

/** The builder additionally needs its field overlay before fields can be placed. */
export async function overlayReady(page: Page): Promise<void> {
  await expect(page.locator('[data-pdf-overlay="1"]')).toBeAttached({ timeout: 45_000 });
  await page.waitForTimeout(300);
}

/**
 * Writes the contact sheet. Called once from the gallery's teardown so a
 * reviewer opens a single page rather than a folder of PNGs.
 */
export function writeContactSheet(): string {
  let all: ShotRecord[] = [];
  try {
    all = JSON.parse(readFileSync(INDEX_JSON, 'utf8')) as ShotRecord[];
  } catch {
    return '';
  }
  all.sort((a, b) => a.order - b.order || a.device.localeCompare(b.device));

  const areas = [...new Set(all.map((item) => item.area))];
  const sections = areas
    .map((area) => {
      const cards = all
        .filter((item) => item.area === area)
        .map(
          (item) => `
        <figure>
          <a href="${item.file}" target="_blank" rel="noreferrer">
            <img src="${item.file}" alt="${escapeHtml(item.caption)}" loading="lazy" />
          </a>
          <figcaption>
            <strong>${escapeHtml(item.name)}</strong>
            <span class="device ${item.device}">${item.device}</span>
            <span class="caption">${escapeHtml(item.caption)}</span>
          </figcaption>
        </figure>`,
        )
        .join('');
      return `<section><h2 id="${area}">${escapeHtml(area)}</h2><div class="grid">${cards}</div></section>`;
    })
    .join('');

  const nav = areas.map((area) => `<a href="#${area}">${escapeHtml(area)}</a>`).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Envelope — UI gallery</title>
<style>
  :root { color-scheme: light dark; --bg:#f8fafc; --fg:#0f172a; --muted:#64748b; --card:#fff; --line:#e2e8f0; --accent:#0f766e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0b1120; --fg:#e2e8f0; --muted:#94a3b8; --card:#111a2e; --line:#1e293b; --accent:#5eead4; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:0 0 4rem; background:var(--bg); color:var(--fg);
         font:15px/1.5 "Inter Variable", ui-sans-serif, system-ui, sans-serif; }
  header { position:sticky; top:0; z-index:2; padding:1.25rem 1.5rem 1rem;
           background:color-mix(in srgb, var(--bg) 88%, transparent);
           backdrop-filter:blur(10px); border-bottom:1px solid var(--line); }
  h1 { margin:0 0 .35rem; font-size:1.15rem; letter-spacing:-.01em; }
  .sub { margin:0; color:var(--muted); font-size:.82rem; }
  nav { display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.85rem; }
  nav a { padding:.25rem .6rem; border:1px solid var(--line); border-radius:999px;
          color:var(--muted); text-decoration:none; font-size:.76rem; }
  nav a:hover { color:var(--accent); border-color:var(--accent); }
  section { padding:2rem 1.5rem 0; }
  h2 { font-size:.78rem; text-transform:uppercase; letter-spacing:.09em;
       color:var(--muted); margin:0 0 1rem; scroll-margin-top:7rem; }
  .grid { display:grid; gap:1.25rem; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); }
  figure { margin:0; background:var(--card); border:1px solid var(--line);
           border-radius:12px; overflow:hidden; }
  img { display:block; width:100%; height:auto; background:#fff; }
  figcaption { padding:.7rem .85rem .85rem; border-top:1px solid var(--line);
               display:flex; flex-wrap:wrap; gap:.4rem .55rem; align-items:baseline; }
  figcaption strong { font-size:.83rem; }
  .device { font-size:.66rem; text-transform:uppercase; letter-spacing:.06em;
            padding:.1rem .4rem; border-radius:4px; border:1px solid var(--line); color:var(--muted); }
  .caption { flex-basis:100%; color:var(--muted); font-size:.78rem; }
  @media (max-width:640px) { section { padding:1.5rem 1rem 0; } header { padding:1rem; } }
</style>
</head>
<body>
<header>
  <h1>Envelope — UI gallery</h1>
  <p class="sub">${all.length} screenshots · generated ${new Date().toLocaleString()} · grey blocks are masked values that change every run</p>
  <nav>${nav}</nav>
</header>
${sections}
</body>
</html>`;

  const out = join(GALLERY_DIR, 'index.html');
  writeFileSync(out, html);
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
