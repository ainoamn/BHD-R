export type BhdAppMode = 'identity' | 'sso' | 'browse';

export type BhdApp = {
  id: string;
  clientId: string | null;
  nameAr: string;
  nameEn: string;
  origin: string;
  /** مسار نسبي داخل المنتج بعد SSO — مساحة عمل العميل وليس الصفحة التسويقية. */
  workspacePath: string;
  startUrl: string | null;
  mode: BhdAppMode;
  enabled: boolean;
  mark: string;
  accent: string;
  soft: string;
};

export const BHD_APP_SWITCHER_SPEC = 'bhd-appswitcher.v1';

function ssoStart(origin: string, workspacePath: string) {
  const path = workspacePath.startsWith('/') ? workspacePath : `/${workspacePath}`;
  return `${origin.replace(/\/$/, '')}/api/auth/bhd/start?returnTo=${encodeURIComponent(path)}`;
}

/**
 * كتالوج مجمد — يُنسخ حرفياً من ONE-BHD.
 * workspacePath = لوحة العميل بعد التعرّف عبر الهوية.
 * النقر يفتح workspacePath مباشرة. start فقط إن لم توجد جلسة منتج (ميدلوير المنتج).
 * انظر docs/BHD-PRODUCT-SSO-ADMIN.md و docs/BHD-ACCOUNT-SWITCHER.md §5
 */
export const BHD_APPS: BhdApp[] = [
  {
    id: 'account',
    clientId: null,
    nameAr: 'الحساب',
    nameEn: 'Account',
    origin: 'https://id.bhd-om.com',
    workspacePath: '/account',
    startUrl: null,
    mode: 'identity',
    enabled: true,
    mark: 'حـ',
    accent: '#092d24',
    soft: '#e8f4f1',
  },
  {
    id: 'portal',
    clientId: 'bhd-portal',
    nameAr: 'بوابة بن حمود',
    nameEn: 'Bin Hamood Portal',
    origin: 'https://www.bhd-om.com',
    workspacePath: '/company',
    startUrl: ssoStart('https://www.bhd-om.com', '/company'),
    mode: 'sso',
    enabled: true,
    mark: 'B',
    accent: '#075c45',
    soft: '#e6f1ec',
  },
  {
    id: 'wazen',
    clientId: 'bhd-wazen',
    nameAr: 'وازن',
    nameEn: 'WAZEN',
    origin: 'https://wazen.bhd-om.com',
    workspacePath: '/dashboard',
    startUrl: ssoStart('https://wazen.bhd-om.com', '/dashboard'),
    mode: 'sso',
    enabled: true,
    mark: 'و',
    accent: '#126b63',
    soft: '#e8f4f1',
  },
  {
    id: 'hisaby',
    clientId: 'bhd-hisaby',
    nameAr: 'حسابي',
    nameEn: 'HISAB',
    origin: 'https://hisaby.bhd-om.com',
    workspacePath: '/dashboard',
    startUrl: ssoStart('https://hisaby.bhd-om.com', '/dashboard'),
    mode: 'sso',
    enabled: true,
    mark: 'ح',
    accent: '#075c45',
    soft: '#e6f1ec',
  },
  {
    id: 'nasab',
    clientId: 'bhd-nasab',
    nameAr: 'نَسَب',
    nameEn: 'NASAB',
    origin: 'https://nasab.bhd-om.com',
    workspacePath: '/app',
    startUrl: ssoStart('https://nasab.bhd-om.com', '/app'),
    mode: 'sso',
    enabled: true,
    mark: 'ن',
    accent: '#8a3c45',
    soft: '#f6e9eb',
  },
  {
    id: 'bhd-r',
    clientId: 'bhd-r',
    nameAr: 'BHD R',
    nameEn: 'BHD R',
    origin: 'https://r.bhd-om.com',
    workspacePath: '/ar/portal',
    startUrl: ssoStart('https://r.bhd-om.com', '/ar/portal'),
    mode: 'sso',
    enabled: true,
    mark: 'R',
    accent: '#a66b2d',
    soft: '#f8efe4',
  },
  {
    id: 'store',
    clientId: 'bhd-store',
    nameAr: 'المتجر',
    nameEn: 'BHD Store',
    origin: 'https://bhdstor.bhd-om.com',
    workspacePath: '/dashboard',
    startUrl: ssoStart('https://bhdstor.bhd-om.com', '/dashboard'),
    mode: 'sso',
    enabled: true,
    mark: 'م',
    accent: '#315d89',
    soft: '#e9f0f7',
  },
  {
    id: 'office',
    clientId: 'bhd-office',
    nameAr: 'المكتب',
    nameEn: 'BHD Office',
    origin: 'https://baitak.bhd-om.com',
    workspacePath: '/ar',
    startUrl: ssoStart('https://baitak.bhd-om.com', '/ar'),
    mode: 'sso',
    enabled: true,
    mark: 'B',
    accent: '#283b4d',
    soft: '#e9edf0',
  },
  {
    id: 'hr',
    clientId: 'bhd-hr',
    nameAr: 'الموارد البشرية',
    nameEn: 'BHD HR',
    origin: 'https://hr.bhd-om.com',
    workspacePath: '/',
    startUrl: ssoStart('https://hr.bhd-om.com', '/'),
    mode: 'sso',
    enabled: true,
    mark: 'HR',
    accent: '#3d5a45',
    soft: '#e7efe9',
  },
];

export function gatewayApps(): BhdApp[] {
  return BHD_APPS.filter((app) => app.enabled && app.id !== 'account');
}

function samePortalOrigin(pageOrigin?: string) {
  if (!pageOrigin) return false;
  const here = pageOrigin.replace(/\/$/, '');
  return (
    here === 'https://www.bhd-om.com' ||
    here === 'https://bhd-om.com' ||
    here.endsWith('.vercel.app') ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(here)
  );
}

/** مساحة العمل مباشرة — بلا سلسلة start في كل نقرة. */
export function workspaceUrlForApp(app: BhdApp, pageOrigin?: string): string {
  if (app.mode === 'identity') {
    if (pageOrigin) {
      const here = pageOrigin.replace(/\/$/, '');
      if (here === 'https://id.bhd-om.com' || samePortalOrigin(pageOrigin))
        return app.workspacePath;
    }
    return `${app.origin.replace(/\/$/, '')}${app.workspacePath}`;
  }
  if (app.id === 'portal' && samePortalOrigin(pageOrigin)) {
    return app.workspacePath;
  }
  if (app.id === 'bhd-r' && pageOrigin) {
    const here = pageOrigin.replace(/\/$/, '');
    if (
      here === 'https://r.bhd-om.com' ||
      here.endsWith('.vercel.app') ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(here)
    ) {
      return app.workspacePath;
    }
  }
  if (app.origin) {
    return `${app.origin.replace(/\/$/, '')}${app.workspacePath || '/'}`;
  }
  return app.workspacePath || '/';
}

export function launchUrlForApp(app: BhdApp, pageOrigin?: string): string {
  return workspaceUrlForApp(app, pageOrigin);
}

export function startUrlForApp(app: BhdApp): string | null {
  return app.startUrl;
}

export function hopOrigins(apps: BhdApp[] = BHD_APPS): string[] {
  return [
    ...new Set(
      apps.filter((app) => app.enabled && app.origin).map((app) => app.origin.replace(/\/$/, '')),
    ),
  ];
}
