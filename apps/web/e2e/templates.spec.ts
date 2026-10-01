import { expect, test } from '@playwright/test';
import {
  emailFor,
  openNavigation,
  prepareToSend,
  sendFromReview,
  signingLinkFor,
  signUp,
  TEST_PASSWORD,
  uniqueEmail,
} from './helpers';

test.describe('Templates', () => {
  test('save a prepared document as a template, then use it as a draft and to send', async ({
    page,
  }) => {
    await signUp(page, 'template-admin');
    const priya = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    const envelopeId = await prepareToSend(page, [priya]);

    // Saved from the document's own page; the document stays as it is.
    await page.goto(`/dashboard/envelopes/${envelopeId}`);
    await page.getByRole('button', { name: 'Save as template' }).click();
    const save = page.getByRole('dialog', { name: 'Save as template' });
    await save.getByLabel('Template name').fill('Intake consent');
    await save.getByLabel('Role for Priya Sharma').fill('Patient');
    await save.getByRole('button', { name: 'Save template' }).click();

    await expect(page).toHaveURL(/\/templates$/);
    await expect(page.getByText('Saved “Intake consent” as a template.')).toBeVisible();
    const card = page.getByRole('listitem').filter({ hasText: 'Intake consent' });
    await expect(card.getByText(/12 pages · 1 role · 2 fields/)).toBeVisible();

    // Use it as a draft: a name and an email for the role, then the review screen.
    const first = { name: 'Jordan Lee', email: uniqueEmail('jordan') };
    await card.getByRole('button', { name: 'Use template' }).click();
    const use = page.getByRole('dialog', { name: 'Use “Intake consent”' });
    await use.getByLabel('Patient: full name').fill(first.name);
    await use.getByLabel('Patient: email address').fill(first.email);
    await use.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/dashboard\/envelopes\/[0-9a-f-]+\/review$/);
    await expect(page.getByText(first.email)).toBeVisible();
    await sendFromReview(page);
    const link = await signingLinkFor(first.email);
    expect(link).toContain('/sign/');

    // Use it again and send straight away.
    const second = { name: 'Sam Rivera', email: uniqueEmail('sam') };
    await page.goto('/templates');
    await page.getByRole('button', { name: 'Use template' }).click();
    const again = page.getByRole('dialog', { name: 'Use “Intake consent”' });
    await again.getByLabel('Patient: full name').fill(second.name);
    await again.getByLabel('Patient: email address').fill(second.email);
    await again.getByLabel('Send it for signing now').check();
    await again.getByRole('button', { name: 'Create and send' }).click();
    await expect(page).toHaveURL(/\/dashboard\/envelopes\/[0-9a-f-]+$/);
    await expect(
      page.getByText(`Sent. We are emailing ${second.name} a link to sign.`),
    ).toBeVisible();
    await signingLinkFor(second.email);
  });

  test('refuses the wrong details in the dialog, and archive then restore a template', async ({
    page,
  }) => {
    await signUp(page, 'template-archive');
    const priya = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    const envelopeId = await prepareToSend(page, [priya]);
    await page.goto(`/dashboard/envelopes/${envelopeId}`);
    await page.getByRole('button', { name: 'Save as template' }).click();
    await page
      .getByRole('dialog', { name: 'Save as template' })
      .getByRole('button', { name: 'Save template' })
      .click();
    await expect(page).toHaveURL(/\/templates$/);

    // Saved with the document's own title; the role is named after the person.
    const card = page.getByRole('listitem').filter({ hasText: '1 role' });
    await card.getByRole('button', { name: 'Use template' }).click();
    const use = page.getByRole('dialog');
    await use.getByRole('button', { name: 'Create draft' }).click();
    await expect(use.getByText('Give every role a name and an email address.')).toBeVisible();
    await use.getByRole('button', { name: 'Cancel' }).click();

    await card.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive it' }).click();
    await expect(page.getByText('No templates yet')).toBeVisible();

    await page.getByLabel('Show archived templates').check();
    const archived = page.getByRole('listitem').filter({ hasText: 'Archived' });
    await expect(archived).toBeVisible();
    await expect(archived.getByRole('button', { name: 'Use template' })).toHaveCount(0);
    await archived.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('No archived templates')).toBeVisible();
    await page.getByLabel('Show archived templates').uncheck();
    await expect(page.getByRole('button', { name: 'Use template' })).toBeVisible();
  });

  test('a member can use a template but not save or change one', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signUp(page, 'template-owner');
    const priya = { name: 'Priya Sharma', email: uniqueEmail('priya') };
    const envelopeId = await prepareToSend(page, [priya]);
    await page.goto(`/dashboard/envelopes/${envelopeId}`);
    await page.getByRole('button', { name: 'Save as template' }).click();
    const save = page.getByRole('dialog', { name: 'Save as template' });
    await save.getByLabel('Template name').fill('Shared form');
    await save.getByLabel('Role for Priya Sharma').fill('Patient');
    await save.getByRole('button', { name: 'Save template' }).click();
    await expect(page).toHaveURL(/\/templates$/);

    await page.goto('/settings/users');
    const memberEmail = uniqueEmail('template-member');
    await page.getByRole('button', { name: 'Invite someone' }).click();
    await page.getByLabel('Full name').fill('Mina Member');
    await page.getByLabel('Email address').fill(memberEmail);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    const invite = await emailFor(memberEmail, 'user-invited');
    const invitePath = /\/accept-invite\/[0-9a-f]{64}/.exec(invite.text)?.[0];
    if (!invitePath) throw new Error('No invitation link');

    const other = await browser.newContext({ baseURL });
    const member = await other.newPage();
    await member.goto(invitePath);
    await member.getByLabel('Password').fill(TEST_PASSWORD);
    await member.getByRole('button', { name: 'Accept and sign in' }).click();
    await expect(member).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    await openNavigation(member);
    await member.getByRole('link', { name: 'Templates' }).first().click();
    const card = member.getByRole('listitem').filter({ hasText: 'Shared form' });
    await expect(card.getByRole('button', { name: 'Use template' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Archive' })).toHaveCount(0);
    await expect(member.getByLabel('Show archived templates')).toHaveCount(0);

    const person = { name: 'Kit Jones', email: uniqueEmail('kit') };
    await card.getByRole('button', { name: 'Use template' }).click();
    const use = member.getByRole('dialog', { name: 'Use “Shared form”' });
    await use.getByLabel('Patient: full name').fill(person.name);
    await use.getByLabel('Patient: email address').fill(person.email);
    await use.getByRole('button', { name: 'Create draft' }).click();
    await expect(member).toHaveURL(/\/dashboard\/envelopes\/[0-9a-f-]+\/review$/);
    await other.close();
  });
});
