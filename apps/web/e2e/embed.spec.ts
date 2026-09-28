import type { EnvelopeDetail } from '@envelope/shared';
import { expect, test } from '@playwright/test';
import { createEmbedHost } from './embed-host';
import {
  agreeToSign,
  DEMO_AGREEMENT_PDF,
  openAsSigner,
  signingLinkFor,
  uniqueEmail,
} from './helpers';
import { WEB_URL } from './stack/stack.mjs';

for (const mode of ['existing', 'upload'] as const) {
  test(`HealthProHub ${mode} editor completes a signing job`, async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(120_000);
    const host = await createEmbedHost(request, mode);
    try {
      await page.context().clearCookies();
      await page.goto(host.origin);
      await page.getByRole('button', { name: 'Prepare for signing' }).click();
      const frame = page.frameLocator('iframe');
      if (mode === 'upload') {
        await frame.locator('input[type="file"]').setInputFiles(DEMO_AGREEMENT_PDF);
        await frame.getByRole('button', { name: 'Upload document', exact: true }).click();
      }
      await expect(frame.getByRole('heading', { name: 'Prepare for signing' })).toBeVisible();
      const email = uniqueEmail('embedded-signer');
      await frame.getByLabel('Name', { exact: true }).fill('Embedded Signer');
      await frame.getByLabel('Email address', { exact: true }).fill(email);
      await frame.getByRole('button', { name: 'Add person' }).click();
      await expect(frame.getByText(email, { exact: true })).toBeVisible();
      await frame.getByRole('tab', { name: /Fields & tools/ }).click();
      await frame.getByRole('button', { name: 'Signature', exact: true }).click();
      const box = frame.locator('[data-page-number="1"]');
      await expect(box.locator('canvas')).toBeVisible();
      await box.click({ position: { x: 150, y: 180 } });
      await expect(frame.locator('[data-field-id]')).toHaveCount(1);
      await page.getByRole('button', { name: 'Save and close' }).click();
      await expect(page.locator('iframe')).toHaveCount(0);
      await expect.poll(() => host.envelopeId).toBeTruthy();
      const detail = await request.get(`${WEB_URL}/api/v1/envelopes/${host.envelopeId}`, {
        headers: host.backendHeaders,
      });
      expect(((await detail.json()) as EnvelopeDetail).fields).toHaveLength(1);
      await page.getByRole('button', { name: 'Prepare for signing' }).click();
      await expect(frame.locator('[data-field-id]')).toHaveCount(1);
      await frame.getByRole('button', { name: /Review and send/ }).click();
      await frame.getByRole('button', { name: 'Send for signing' }).click();
      await frame.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
      await expect(frame.getByRole('heading', { name: 'Sent for signing' })).toBeVisible();
      const link = await signingLinkFor(email);
      const signer = await browser.newContext({ ...test.info().project.use });
      try {
        const signingPage = await signer.newPage();
        await openAsSigner(signingPage, link);
        await agreeToSign(signingPage);
        await signingPage
          .getByRole('button', { name: /^Signature field, required, page 1/ })
          .click();
        await signingPage
          .getByRole('dialog', { name: 'Adopt your signature' })
          .getByRole('button', { name: 'Adopt and sign' })
          .click();
        await signingPage.getByRole('button', { name: 'Finish', exact: true }).click();
        await expect(signingPage.getByRole('heading', { name: 'Signed' })).toBeVisible();
      } finally {
        await signer.close();
      }
      await expect
        .poll(
          () => [...host.events.values()].some((event) => event.type === 'envelope.completed'),
          { timeout: 30_000 },
        )
        .toBe(true);
      const completed = await request.get(`${WEB_URL}/api/v1/envelopes/${host.envelopeId}`, {
        headers: host.backendHeaders,
      });
      const envelope = (await completed.json()) as EnvelopeDetail;
      expect(envelope.status).toBe('COMPLETED');
      const final = envelope.versions.find((version) => version.isFinal);
      expect(final).toBeDefined();
      const pdf = await request.get(
        `${WEB_URL}/api/v1/envelopes/${host.envelopeId}/file?version=${final?.versionNumber}`,
        { headers: host.backendHeaders },
      );
      expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
      expect(
        (await page.context().cookies(WEB_URL)).some((cookie) => cookie.name === 'ds_refresh'),
      ).toBe(false);
    } finally {
      await host.close();
    }
  });
}
