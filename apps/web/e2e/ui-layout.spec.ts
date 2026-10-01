import { expect, type Page, test } from '@playwright/test';
import { openAccount, signUpAs } from './helpers';

async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

test('workspace navigation fits each breakpoint and returns focus after dismissal', async ({
  page,
}) => {
  await signUpAs(page, 'ui-layout', {
    fullName: 'Alexandra Morgan',
    organisation: 'Riverside Health Partners International Document Services',
  });
  for (const width of [375, 720, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noPageOverflow(page);
    if (width < 1024) {
      const trigger = page.getByRole('button', { name: 'Open navigation' });
      await trigger.click();
      const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press('Tab');
        expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await drawer.getByRole('link', { name: 'Templates', exact: true }).click();
      await expect(drawer).not.toBeVisible();
    } else {
      await page
        .getByRole('navigation', { name: 'Main', exact: true })
        .getByRole('link', { name: 'Templates', exact: true })
        .click();
    }
    await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();
    await noPageOverflow(page);
    await page.getByRole('button', { name: /Open quick search/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await openAccount(page);
    await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
    await noPageOverflow(page);
  }
});
