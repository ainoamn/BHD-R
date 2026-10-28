import { PAYMENT_METHOD_IDS, type PaymentMethodId } from '@/lib/payment-gateways-catalog';

export type PaymentProviderState = {
  id: string;
  active: boolean;
  endpoint: string;
  hasCredentials: boolean;
  ready: boolean;
  credentialsMasked: Record<string, string>;
  credentialsStored: boolean;
};

export type PaymentGatewaysView = {
  providers: PaymentProviderState[];
  methods: Record<PaymentMethodId, boolean>;
  updatedAt: string | null;
};

export const SITE_PAGE_IDS = [
  'home',
  'properties',
  'stays',
  'badges',
  'trust',
  'terms',
  'privacy',
  'accessibility',
  'login',
  'portal',
] as const;
export type SitePageId = (typeof SITE_PAGE_IDS)[number];

export const SITE_PAGE_META: Record<SitePageId, { path: string; ar: string; en: string }> = {
  home: { path: '/', ar: 'الصفحة الرئيسية', en: 'Home' },
  properties: { path: '/properties', ar: 'العقارات', en: 'Properties' },
  stays: { path: '/stays', ar: 'الإقامات اليومية', en: 'Daily stays' },
  badges: { path: '/badges', ar: 'الشارات', en: 'Badges' },
  trust: { path: '/trust', ar: 'الثقة والأمان', en: 'Trust & safety' },
  terms: { path: '/terms', ar: 'الشروط', en: 'Terms' },
  privacy: { path: '/privacy', ar: 'الخصوصية', en: 'Privacy' },
  accessibility: { path: '/accessibility', ar: 'إمكانية الوصول', en: 'Accessibility' },
  login: { path: '/login', ar: 'تسجيل الدخول', en: 'Login' },
  portal: { path: '/portal', ar: 'بوابة الحساب', en: 'Account portal' },
};

export type SitePagesView = {
  pages: Record<SitePageId, boolean>;
  updatedAt: string | null;
};

export type MaintenanceView = {
  enabled: boolean;
  mode: 'banner' | 'hard';
  messageAr: string;
  messageEn: string;
  updatedAt: string | null;
};

export { PAYMENT_METHOD_IDS };
export type { PaymentMethodId };
