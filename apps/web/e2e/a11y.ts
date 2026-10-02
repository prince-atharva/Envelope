import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.2 AA is the bar (docs/22, ADR 0035). */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Runs axe over the page as it is now and fails on any serious or critical violation, naming the
 * rule, the screen and the offending elements so the report is actionable. Moderate and minor
 * findings are left to the manual script (docs/22 step 12): automation cannot certify WCAG.
 *
 * `include` limits the scan to a popup that is open over the page.
 */
export async function expectAccessible(
  page: Page,
  screen: string,
  options: { include?: string; exclude?: string[] } = {},
): Promise<void> {
  // A fade-in caught half way reads as low contrast. Looping animations (skeleton pulses) are left alone.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY,
      ),
  );
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (options.include) builder = builder.include(options.include);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = blocking.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n${v.nodes
        .slice(0, 4)
        .map((n) => `    ${n.target.join(' ')}`)
        .join('\n')}`,
  );
  expect(report, `Accessibility violations on ${screen}:\n${report.join('\n')}`).toEqual([]);
}
