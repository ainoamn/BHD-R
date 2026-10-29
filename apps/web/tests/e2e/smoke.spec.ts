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

    // Apps launcher lives in the signed-in header chrome (BhdAppSwitcher).
    await authenticatePortal(page);
    await page.goto(`/${locale}`);
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
    const currentApp = page.locator('a.bhd-switcher-app.is-current');
    await expect(currentApp).toContainText('BHD R');
    await expect(currentApp).toHaveAttribute('aria-current', 'page');
  });

  test(`${locale} unified login uses the BHD gateway layout`, async ({ page }) => {
    await page.goto(`/${locale}/login?bhd=discovery`);
    await expect(page.locator('.site-header')).toHaveCount(0);
    await expect(page.locator('.site-footer')).toHaveCount(0);
    await expect(page.locator('.login-screen')).toBeVisible();
    await expect(page.locator('.login-card')).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: locale === 'ar' ? 'إعادة المحاولة عبر id.bhd-om.com' : 'Retry via id.bhd-om.com',
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
    const api = await page.request.get(`/api/portal/ops/owner/${section}`);
    const body = (await api.json().catch(() => null)) as {
      loadError?: boolean;
      records?: Array<{ reference?: string }>;
      error?: { code?: string };
    } | null;
    expect(
      api.ok(),
      `${section} ops API ${api.status()} ${JSON.stringify(body)?.slice(0, 400)}`,
    ).toBe(true);
    expect(
      body?.loadError,
      `${section} loadError ${JSON.stringify(body)?.slice(0, 400)}`,
    ).toBeFalsy();
    expect(
      (body?.records ?? []).some((row) => row.reference === reference),
      `${section} missing ${reference} in ${JSON.stringify(body?.records)?.slice(0, 400)}`,
    ).toBe(true);

    // Bookings list is PropertySectionRecords (listOverride), not ops smoke rows.
    if (section === 'bookings') {
      const propertyRecords = await page.request.get('/api/portal/property-records/all/bookings');
      const propertyBody = (await propertyRecords.json().catch(() => null)) as {
        rows?: Array<{ reference?: string }>;
        error?: { code?: string };
      } | null;
      expect(
        propertyRecords.ok(),
        `property-records ${propertyRecords.status()} ${JSON.stringify(propertyBody)?.slice(0, 400)}`,
      ).toBe(true);
      expect(
        (propertyBody?.rows ?? []).some((row) => row.reference === reference),
        `property-records missing ${reference} in ${JSON.stringify(propertyBody?.rows)?.slice(0, 400)}`,
      ).toBe(true);
    }

    await page.goto(`/ar/owner/${section}`);
    await expect(page.locator('.ops-workspace')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    // Force a client refetch after navigation (warm may race the first paint).
    await page.evaluate(
      ({ portal, sectionName }) => {
        window.dispatchEvent(
          new CustomEvent('bhd-r-ops-refresh', { detail: { portal, section: sectionName } }),
        );
      },
      { portal: 'owner', sectionName: section },
    );
    await expect(
      page.locator('.ops-workspace').getByText(reference, { exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
  }
  await page.goto('/ar/owner/reports');
  await expect(page.getByRole('button', { name: 'تنزيل آمن' })).toBeVisible();
});

test('complete property intake has operations, documents, media and review stages', async ({
  page,
}) => {
  await authenticatePortal(page);
  await page.goto('/ar/owner/properties/new');
  const desktopSteps = page.locator('.wizard-progress--desktop .wizard-progress__item');
  await expect(desktopSteps).toHaveCount(7);
  await expect(desktopSteps.filter({ hasText: 'التشغيل والمرافق' })).toBeVisible();
  await expect(desktopSteps.filter({ hasText: 'الملكية والوثائق' })).toBeVisible();
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

  // Properties is a collapsible nav group — open the view link, not the toggle button.
  const propertiesToggle = page.locator('.portal-nav').getByRole('button', {
    name: 'العقارات',
    exact: true,
  });
  if (await propertiesToggle.getAttribute('aria-expanded').then((v) => v !== 'true')) {
    await propertiesToggle.click();
  }
  await page
    .locator('.portal-nav')
    .getByRole('link', { name: 'عرض العقارات', exact: true })
    .click();
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

test('stays phase-0: homepage has no daily-stay search tab while flags are off', async ({
  page,
}) => {
  await page.goto('/ar');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: /إقامة يومية|Daily stay/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /إقامات|Stays/i })).toHaveCount(0);
});

test('stays phase-0: /ar/stays is not a public product surface yet', async ({ page }) => {
  const response = await page.goto('/ar/stays', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  const status = response!.status();
  // Prefer HTTP 404. Next may stream the shell as 200 while layout calls notFound() —
  // require the not-found document, never a stays catalogue or search UI.
  if (status === 404 || status >= 400) return;
  await expect(
    page.getByRole('heading', { name: /الصفحة غير متاحة|Page unavailable/i }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.stays-browse, .stay-search')).toHaveCount(0);
});

test('owner sidebar preserves a property draft without document reloads', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop navigation regression');
  await authenticatePortal(page);
  await page.goto('/en/owner/properties/new');
  const category = page.locator('.wizard-shell:visible #category');
  await category.selectOption('warehouse');
  await category.evaluate((node) => node.setAttribute('data-draft-marker', 'original-node'));
  let documentRequests = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++;
  });
  // Only ops soft-nav sections mount `.portal-persisted-panel` (not terms/settings/tenant-requests).
  const softOps = new Set([
    'requests',
    'bookings',
    'leasing',
    'sales',
    'invoices',
    'payments',
    'accounting',
    'expenses',
    'maintenance',
    'work-orders',
    'tasks',
    'legal',
    'approvals',
    'reports',
    'team',
    'contacts',
    'properties',
  ]);
  const hrefs = await page.locator('.portal-nav a').evaluateAll(
    (links, allowed) => {
      const allow = new Set(allowed as string[]);
      return links
        .map((link) => link.getAttribute('href')!)
        .filter((href) => {
          const match = /^\/en\/owner\/([^/?]+)$/.exec(href);
          return Boolean(match && allow.has(match[1]!));
        });
    },
    [...softOps],
  );
  expect(hrefs.length).toBeGreaterThan(12);
  for (const href of hrefs) {
    await page.locator(`.portal-nav a[href="${href}"]`).click();
    await expect(page).toHaveURL(href);
    await expect(page.locator('.portal-persisted-panel:not([hidden])')).toHaveCount(1);
  }
  const propertiesToggle = page.locator('.portal-nav').getByRole('button', {
    name: 'Properties',
    exact: true,
  });
  if (await propertiesToggle.getAttribute('aria-expanded').then((v) => v !== 'true')) {
    await propertiesToggle.click();
  }
  await page
    .locator('.portal-nav')
    .getByRole('link', { name: 'View properties', exact: true })
    .click();
  await expect(page).toHaveURL('/en/owner/properties');
  await page
    .locator('.portal-persisted-panel:not([hidden]) a[href="/en/owner/properties/new"]')
    .first()
    .click();
  await expect(category).toHaveValue('warehouse');
  await expect(category).toHaveAttribute('data-draft-marker', 'original-node');
  expect(documentRequests).toBe(0);
});
