import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPath = resolve(__dirname, 'fixtures/test-12-pages.pdf');

test.describe('Document lifecycle end-to-end', () => {
  test('full flow: register → empty state → upload 12-page PDF → viewer shows all pages → zoom works → fingerprint matches download', async ({
    page,
    context,
    browserName,
  }) => {
    // Only Chromium lets Playwright grant the clipboard permissions; WebKit rejects
    // them outright. There the copy is checked through the button alone, and the
    // clipboard is not read back.
    const clipboardReadable = browserName === 'chromium';
    if (clipboardReadable) {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    }

    const uniqueEmail = `fullflow+${Date.now()}+${Math.floor(Math.random() * 100000)}@example.com`;
    const password = 'TestPassword123!';

    // 1. Visit root - redirects to /login
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // 2. Go to register page
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

    // 3. Register a new account
    await page.getByLabel('Full name').fill('Full Flow Tester');
    await page.getByLabel('Organisation (optional)').fill('E2E Medical');
    await page.getByLabel('Email address').fill(uniqueEmail);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    // 4. Verify redirected to dashboard with empty state
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    await expect(page.getByText('No documents yet')).toBeVisible();

    // 5. Navigate to upload page
    await page.getByRole('link', { name: 'Upload your first document' }).click();
    await expect(page).toHaveURL(/\/dashboard\/new/);
    await expect(page.getByRole('heading', { name: 'Upload a document' })).toBeVisible();

    // 6. Upload 12-page PDF fixture
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(pdfPath);
    await expect(page.getByText('test-12-pages.pdf')).toBeVisible();

    // 7. Submit upload form
    const uploadBtn = page.getByRole('button', { name: 'Upload document' });
    await expect(uploadBtn).toBeEnabled({ timeout: 10000 });
    await uploadBtn.click();

    // 8. Wait for upload to complete and redirect to detail page
    await expect(page).toHaveURL(/\/dashboard\/envelopes\/[0-9a-f-]+/, { timeout: 30000 });

    // 9. Verify envelope details
    await expect(page.getByRole('heading', { name: 'test-12-pages' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/12 pages/).first()).toBeVisible();
    await expect(page.getByText(/Created by Full Flow Tester/).first()).toBeVisible();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();

    // 10. Verify Document Fingerprint (SHA-256)
    await expect(page.getByText('Document Fingerprint (SHA-256)')).toBeVisible();
    const hashLocator = page.locator('.font-mono').filter({ hasText: /^[a-f0-9]{64}$/ });
    await expect(hashLocator).toBeVisible({ timeout: 10000 });
    const displayedHash = (await hashLocator.textContent())?.trim();
    expect(displayedHash).toBeTruthy();
    expect(displayedHash).toHaveLength(64);

    // 11. Verify copy fingerprint to clipboard
    const copyButton = page.getByRole('button', { name: 'Copy Hash' });
    await expect(copyButton).toBeVisible();
    await copyButton.click();
    await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
    if (clipboardReadable) {
      const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardContent).toBe(displayedHash);
    }

    // 12. Verify PDF viewer loaded and page navigation works
    await expect(page.getByText(/of 12/)).toBeVisible({ timeout: 20000 });
    const prevBtn = page.getByLabel('Previous Page');
    const nextBtn = page.getByLabel('Next Page');
    const firstBtn = page.getByLabel('First Page');
    const lastBtn = page.getByLabel('Last Page');
    const pageInput = page.getByLabel('Current Page Number');

    // First and Last are left out on phones, so the toolbar fits across the screen.
    const wide = (page.viewportSize()?.width ?? 0) >= 640;

    await expect(prevBtn).toBeVisible();
    await expect(nextBtn).toBeVisible();
    await expect(pageInput).toBeVisible();
    if (wide) {
      await expect(firstBtn).toBeVisible();
      await expect(lastBtn).toBeVisible();
    } else {
      await expect(firstBtn).toBeHidden();
      await expect(lastBtn).toBeHidden();
    }

    // Initial state: page 1, previous & first disabled, next & last enabled
    await expect(pageInput).toHaveValue('1');
    await expect(prevBtn).toBeDisabled();
    await expect(firstBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();
    await expect(lastBtn).toBeEnabled();

    // Test changing page via Next Page button: 1 -> 2
    await nextBtn.click();
    await expect(pageInput).toHaveValue('2', { timeout: 5000 });
    await expect(prevBtn).toBeEnabled();
    await expect(firstBtn).toBeEnabled();

    // Test changing page via Next Page button: 2 -> 3
    await nextBtn.click();
    await expect(pageInput).toHaveValue('3', { timeout: 5000 });

    // Test changing page via Previous Page button: 3 -> 2
    await prevBtn.click();
    await expect(pageInput).toHaveValue('2', { timeout: 5000 });

    // Test jumping to a specific page via the input box: type "7" and press Enter
    await pageInput.fill('7');
    await pageInput.press('Enter');
    await expect(pageInput).toHaveValue('7', { timeout: 5000 });

    // Test jumping to Last Page (page 12): the button, or on a phone the page box
    if (wide) await lastBtn.click();
    else {
      await pageInput.fill('12');
      await pageInput.press('Enter');
    }
    await expect(pageInput).toHaveValue('12', { timeout: 5000 });
    await expect(nextBtn).toBeDisabled();
    await expect(lastBtn).toBeDisabled();
    await expect(prevBtn).toBeEnabled();

    // Test jumping back to First Page (page 1): the button, or on a phone the page box
    if (wide) await firstBtn.click();
    else {
      await pageInput.fill('1');
      await pageInput.press('Enter');
    }
    await expect(pageInput).toHaveValue('1', { timeout: 5000 });
    await expect(prevBtn).toBeDisabled();
    await expect(firstBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    // Test scrolling inside the PDF scroll container
    const scrollContainer = page.locator('[aria-label="PDF Document Scroll Area"]');
    await expect(scrollContainer).toBeVisible();
    // Scroll down inside the container
    await scrollContainer.evaluate((el) => el.scrollTo({ top: 1800, behavior: 'instant' }));
    // Wait for scroll event to fire and assert current page updated from scrolling
    await expect(pageInput).not.toHaveValue('1', { timeout: 5000 });

    // 13. Verify zoom controls & canvas-level mouse wheel zoom
    // Fit Width lives in the zoom menu, on every screen size.
    await expect(page.getByLabel('Zoom Level').locator('option[value="fit-width"]')).toHaveCount(1);
    const zoomInBtn = page.getByLabel('Zoom In');
    const zoomOutBtn = page.getByLabel('Zoom Out');
    await expect(zoomInBtn).toBeVisible();
    await expect(zoomOutBtn).toBeVisible();

    // Test Zoom In button
    await zoomInBtn.click();

    // Test Zoom Out button
    await zoomOutBtn.click();

    // Test canvas-level Ctrl+Wheel mouse zoom
    await scrollContainer.dispatchEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
    });

    const zoomSelect = page.locator('select').first();

    // Zoom to 100%
    await zoomSelect.selectOption('1');
    await expect(zoomSelect).toHaveValue('1');

    // Zoom to 200%
    await zoomSelect.selectOption('2');
    await expect(zoomSelect).toHaveValue('2');

    // Zoom back to fit-width, from the zoom menu.
    await zoomSelect.selectOption('fit-width');
    await expect(zoomSelect).toHaveValue('fit-width');

    // At least one canvas is rendered
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // 14. Verify Document Versions table. Versions and the audit trail share one
    // card as two tabs, so each is opened rather than both being on screen.
    await page.getByRole('tab', { name: /Versions/ }).click();
    await expect(page.getByText('v0')).toBeVisible();

    // 15. Verify Audit Trail
    await page.getByRole('tab', { name: /Audit trail/ }).click();
    await expect(page.getByText('Document uploaded and fingerprinted')).toBeVisible();

    // 16. Verify download and verify fingerprint matches
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('test-12-pages.pdf');

    // Read downloaded bytes and verify hash matches displayed fingerprint
    const downloadStream = await download.createReadStream();
    if (downloadStream) {
      const chunks: Buffer[] = [];
      for await (const chunk of downloadStream) {
        chunks.push(Buffer.from(chunk));
      }
      const downloadedBytes = Buffer.concat(chunks);
      const downloadedHash = createHash('sha256').update(downloadedBytes).digest('hex');
      expect(downloadedHash).toBe(displayedHash);
    }

    // 17. Return to Dashboard and verify document appears in list
    await page.getByRole('link', { name: 'Documents' }).first().click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('envelope-list')).toBeVisible();
    await expect(
      page.getByTestId('envelope-list').getByText('test-12-pages', { exact: true }),
    ).toBeVisible();

    // 18. Sign out
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
