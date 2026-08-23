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
