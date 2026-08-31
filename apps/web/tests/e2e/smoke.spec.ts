import { expect, test, type Page } from '@playwright/test';
import { issueSessionToken, permissionsForRoles, type RoleKey } from '@bhd-r/authz';

const E2E_SESSION_SECRET = 'e2e-session-secret-is-local-and-at-least-32-characters';

async function authenticatePortal(page: Page): Promise<void> {
  const roles: RoleKey[] = ['platform_admin', 'organization_owner', 'developer_admin', 'tenant'];
  const token = await issueSessionToken(
    {
      sub: '00000000-0000-4000-8000-000000000002',
      sid: '00000000-0000-4000-8000-000000000099',
      organizationId: '00000000-0000-4000-8000-000000000001',
      partyId: '00000000-0000-4000-8000-000000000003',
      roles,
      permissions: permissionsForRoles(roles),
      locale: 'ar',
      sessionVersion: 0,
    },
    new TextEncoder().encode(E2E_SESSION_SECRET),
    3_600,
  );
  await page.context().addCookies([
    {
      name: 'bhd_r_session',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

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
    if (testInfo.project.name === 'mobile' || testInfo.project.name === 'tablet') {
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
  test(`${portal} portal smoke in both languages`, async ({ page }, testInfo) => {
    await authenticatePortal(page);
    for (const locale of ['ar', 'en'] as const) {
      await page.goto(`/${locale}/${portal}`);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('.portal-layout')).toBeVisible();
      await expect(page.locator('.portal-nav')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (testInfo.project.name === 'mobile' && locale === 'ar') {
        await page.locator('.portal-menu-toggle').click();
        await expect(page.locator('.portal-nav')).toBeVisible();
        await expect(page.locator('.portal-nav a').first()).toBeVisible();
      }
      const noHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      expect(noHorizontalOverflow).toBe(true);
    }
  });
}

test('public pages stay within the viewport on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile overflow gate');
  for (const path of ['/ar', '/ar/properties', '/en/properties'] as const) {
    await page.goto(path);
    const noHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(noHorizontalOverflow).toBe(true);
  }
});

test('owner portal exposes specialized operational modules with real records', async ({ page }) => {
  await authenticatePortal(page);
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
  await authenticatePortal(page);
  await page.goto('/ar/owner/properties/new');
  await expect(page.locator('.steps li')).toHaveCount(6);
  await expect(page.locator('.steps li').filter({ hasText: 'التشغيل والمرافق' })).toBeVisible();
  await expect(page.locator('.steps li').filter({ hasText: 'الملكية والوثائق' })).toBeVisible();
});

test('owner sidebar uses same-document navigation and reopens cached sections', async ({
  page,
}) => {
  await authenticatePortal(page);
  await page.goto('/ar/owner/properties');
  await expect(page.getByRole('heading', { level: 1, name: 'المحفظة العقارية' })).toBeVisible();
  const propertySearch = page
    .locator('.portal-persisted-panel:not([hidden])')
    .getByPlaceholder('ابحث بالاسم أو المرجع أو الحالة…');
  await propertySearch.fill('دار');

  await page.evaluate(() => {
    Object.defineProperty(window, '__bhdRSoftNavigationProbe', {
      value: 'alive',
      configurable: true,
    });
  });

  await page.getByRole('link', { name: 'الطلبات', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'مركز الطلبات وخدمة العملاء' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { __bhdRSoftNavigationProbe?: string }).__bhdRSoftNavigationProbe,
    ),
  ).toBe('alive');

  await page.getByRole('link', { name: 'العقارات', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'المحفظة العقارية' })).toBeVisible({
    timeout: 1_500,
  });
  await expect(propertySearch).toHaveValue('دار');
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
