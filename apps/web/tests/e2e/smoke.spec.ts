import { expect, test } from '@playwright/test';

for (const locale of ['ar', 'en'] as const) {
  test(`${locale} public experience has correct direction and accessibility basics`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/${locale}`);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('img:not([alt])')).toHaveCount(0);
    const ids = await page.locator('[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
    expect(new Set(ids).size).toBe(ids.length);
    if (locale === 'ar' && testInfo.project.name === 'chromium')
      await page.screenshot({
        path: testInfo.outputPath('bhd-r-home-identity.png'),
        fullPage: true,
      });
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();

    const appsButton = page.getByRole('button', {
      name: locale === 'ar' ? 'تطبيقات BHD' : 'BHD apps',
    });
    if (testInfo.project.name === 'mobile') {
      await page
        .getByRole('button', {
          name: locale === 'ar' ? 'فتح القائمة' : 'Open menu',
        })
        .click();
    }
    await expect(appsButton).toBeVisible();
    await appsButton.click();
    await expect(
      page.getByRole('dialog', { name: locale === 'ar' ? 'تطبيقات BHD' : 'BHD apps' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'R BHD R' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test(`${locale} unified login uses the BHD gateway layout`, async ({ page }) => {
    await page.goto(`/${locale}/login?bhd=discovery`);
    await expect(page.locator('.site-header')).toHaveCount(0);
    await expect(page.locator('.site-footer')).toHaveCount(0);
    await expect(page.locator('.login-stage')).toBeVisible();
    await expect(page.locator('.login-brand-panel')).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: locale === 'ar' ? 'المتابعة عبر هوية BHD' : 'Continue with BHD Identity',
      }),
    ).toHaveAttribute('href', new RegExp('^/api/auth/bhd/start\\?returnTo='));
  });
}

for (const portal of ['platform', 'owner', 'developer', 'tenant'] as const) {
  test(`${portal} portal smoke in both languages`, async ({ page }) => {
    for (const locale of ['ar', 'en'] as const) {
      await page.goto(`/${locale}/${portal}`);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('.portal-layout')).toBeVisible();
      await expect(page.locator('.portal-nav')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
}

test('owner portal exposes specialized operational modules with real records', async ({ page }) => {
  const sections = [
    ['requests', 'مركز الطلبات وخدمة العملاء', 'REQ-2026-0142'],
    ['bookings', 'الحجوزات والمعاينات', 'VIEW-0041'],
    ['sales', 'مبيعات العقارات', 'SALE-2026-008'],
    ['accounting', 'المحاسبة والأستاذ العام', 'JV-2026-0038'],
    ['work-orders', 'أوامر العمل والموردون', 'WO-2026-0077'],
    ['legal', 'المحاماة والقضايا', 'LEG-2026-0014'],
  ] as const;
  for (const [section, heading, reference] of sections) {
    await page.goto(`/ar/owner/${section}`);
    await expect(page.locator('.ops-workspace')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(reference, { exact: true })).toBeVisible();
  }
  await page.goto('/ar/owner/reports');
  await expect(page.getByRole('button', { name: 'تنزيل آمن' })).toBeVisible();
});

test('complete property intake has operations, documents, media and review stages', async ({
  page,
}) => {
  await page.goto('/ar/owner/properties/new');
  await expect(page.locator('.steps li')).toHaveCount(6);
  await expect(page.locator('.steps li').filter({ hasText: 'التشغيل والمرافق' })).toBeVisible();
  await expect(page.locator('.steps li').filter({ hasText: 'الملكية والوثائق' })).toBeVisible();
});

test('public visitor can submit a real viewing request without creating an account', async ({
  page,
}) => {
  await page.goto('/ar/units/00000000-0000-4000-8000-000000000010');
  await expect(page.getByRole('heading', { name: 'اطلب معاينة العقار' })).toBeVisible();
  await page.getByLabel('الاسم الكامل').fill('مريم الحارثية');
  await page.getByLabel('البريد الإلكتروني').fill('maryam@example.test');
  await page.getByLabel('رقم الهاتف').fill('+96899112233');
  await page.getByLabel(/أوافق على استخدام بياناتي/).check();
  await page.getByRole('button', { name: 'إرسال طلب المعاينة' }).click();
  await expect(page.getByText('تم استلام طلبك')).toBeVisible();
  await expect(page.getByText('WEB-E2E-0001')).toBeVisible();
});
