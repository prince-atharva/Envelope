import { expect, test } from '@playwright/test';
import { setPartnerReference, signUp, TWELVE_PAGE_PDF, uploadDocument } from './helpers';

test.describe('Partner reference', () => {
  test('shows an API partner’s reference and labels on the document, and nothing without them', async ({
    page,
  }) => {
    await signUp(page, 'referencer');
    const plainId = await uploadDocument(page, TWELVE_PAGE_PDF);
    await expect(page.getByRole('group', { name: 'Partner reference' })).toHaveCount(0);

    const referencedId = await uploadDocument(page, TWELVE_PAGE_PDF);
    expect(referencedId).not.toBe(plainId);
    await setPartnerReference(referencedId, 'visit:1001', { department: 'billing' });
    await page.reload();

    const reference = page.getByRole('group', { name: 'Partner reference' });
    await expect(reference).toBeVisible();
    await expect(reference).toContainText('Reference visit:1001');
    await expect(reference).toContainText('department: billing');
  });
});
