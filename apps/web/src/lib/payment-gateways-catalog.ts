/** Platform payment providers & methods controlled from /admin. */

export type PaymentCredentialField = {
  key: string;
  labelAr: string;
  labelEn: string;
  secret?: boolean;
  optional?: boolean;
};

export type PaymentProviderDefinition = {
  id: string;
  nameAr: string;
  nameEn: string;
  hintAr: string;
  hintEn: string;
  /** Built-in sandbox — fully wired today. */
  kind: 'sandbox' | 'live';
  defaultEndpoint: string;
  credentialFields: PaymentCredentialField[];
  methods: PaymentMethodId[];
};

export const PAYMENT_METHOD_IDS = [
  'card',
  'apple_pay',
  'google_pay',
  'bank_transfer',
  'cash',
] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export const PAYMENT_METHOD_LABELS: Record<
  PaymentMethodId,
  { ar: string; en: string }
> = {
  card: { ar: 'بطاقة ائتمان / مدى', en: 'Card' },
  apple_pay: { ar: 'Apple Pay', en: 'Apple Pay' },
  google_pay: { ar: 'Google Pay', en: 'Google Pay' },
  bank_transfer: { ar: 'تحويل بنكي', en: 'Bank transfer' },
  cash: { ar: 'نقداً', en: 'Cash' },
};

export const PAYMENT_PROVIDERS: PaymentProviderDefinition[] = [
  {
    id: 'bhd_pay_sandbox',
    nameAr: 'BHD Pay (تجريبي)',
    nameEn: 'BHD Pay (sandbox)',
    hintAr: 'بوابة التجربة المدمجة — جاهزة دون مفاتيح خارجية.',
    hintEn: 'Built-in pilot gateway — works without external keys.',
    kind: 'sandbox',
    defaultEndpoint: '/payments/sandbox',
    credentialFields: [],
    methods: ['card'],
  },
  {
    id: 'thawani',
    nameAr: 'ثواني (Thawani)',
    nameEn: 'Thawani Pay',
    hintAr: 'أشهر بوابة عمانية للبطاقات والمحافظ.',
    hintEn: 'Leading Omani card & wallet gateway.',
    kind: 'live',
    defaultEndpoint: 'https://checkout.thawani.om/api/v1',
    credentialFields: [
      { key: 'secretKey', labelAr: 'المفتاح السري', labelEn: 'Secret key', secret: true },
      { key: 'publishableKey', labelAr: 'المفتاح العام', labelEn: 'Publishable key' },
      {
        key: 'webhookSecret',
        labelAr: 'سرّ الويب هوك',
        labelEn: 'Webhook secret',
        secret: true,
        optional: true,
      },
    ],
    methods: ['card', 'apple_pay'],
  },
  {
    id: 'omannet',
    nameAr: 'عمان نت / بنك مسقط',
    nameEn: 'OmanNet / Bank Muscat',
    hintAr: 'شبكة البطاقات المحلية عبر بوابة البنك.',
    hintEn: 'Local card network via the bank gateway.',
    kind: 'live',
    defaultEndpoint: 'https://ipg.comtrust.ae',
    credentialFields: [
      { key: 'merchantId', labelAr: 'معرّف التاجر', labelEn: 'Merchant ID' },
      { key: 'apiKey', labelAr: 'مفتاح API', labelEn: 'API key', secret: true },
      {
        key: 'password',
        labelAr: 'كلمة المرور',
        labelEn: 'Password',
        secret: true,
        optional: true,
      },
    ],
    methods: ['card'],
  },
  {
    id: 'network_international',
    nameAr: 'Network International',
    nameEn: 'Network International',
    hintAr: 'N-Genius — بطاقات ومحافظ إقليمية.',
    hintEn: 'N-Genius — regional cards and wallets.',
    kind: 'live',
    defaultEndpoint: 'https://api-gateway.sandbox.ngenius-payments.com',
    credentialFields: [
      { key: 'apiKey', labelAr: 'مفتاح API', labelEn: 'API key', secret: true },
      { key: 'outletId', labelAr: 'معرّف المنفذ', labelEn: 'Outlet ID' },
      {
        key: 'merchantId',
        labelAr: 'معرّف التاجر',
        labelEn: 'Merchant ID',
        optional: true,
      },
    ],
    methods: ['card', 'apple_pay', 'google_pay'],
  },
  {
    id: 'tap',
    nameAr: 'Tap Payments',
    nameEn: 'Tap Payments',
    hintAr: 'بوابة خليجية متعددة القنوات.',
    hintEn: 'Multi-channel GCC payment gateway.',
    kind: 'live',
    defaultEndpoint: 'https://api.tap.company/v2',
    credentialFields: [
      { key: 'secretKey', labelAr: 'المفتاح السري', labelEn: 'Secret key', secret: true },
      {
        key: 'publishableKey',
        labelAr: 'المفتاح العام',
        labelEn: 'Publishable key',
        optional: true,
      },
    ],
    methods: ['card', 'apple_pay', 'google_pay'],
  },
  {
    id: 'myfatoorah',
    nameAr: 'ماي فاتورة',
    nameEn: 'MyFatoorah',
    hintAr: 'فواتير وروابط دفع متعددة العملات.',
    hintEn: 'Invoices and multi-currency payment links.',
    kind: 'live',
    defaultEndpoint: 'https://api.myfatoorah.com',
    credentialFields: [
      { key: 'apiKey', labelAr: 'مفتاح API', labelEn: 'API key', secret: true },
    ],
    methods: ['card', 'apple_pay', 'google_pay', 'bank_transfer'],
  },
  {
    id: 'paytabs',
    nameAr: 'PayTabs',
    nameEn: 'PayTabs',
    hintAr: 'بوابة إقليمية واسعة الانتشار.',
    hintEn: 'Widely used regional gateway.',
    kind: 'live',
    defaultEndpoint: 'https://secure.paytabs.sa',
    credentialFields: [
      { key: 'profileId', labelAr: 'معرّف الملف', labelEn: 'Profile ID' },
      { key: 'serverKey', labelAr: 'مفتاح الخادم', labelEn: 'Server key', secret: true },
      {
        key: 'clientKey',
        labelAr: 'مفتاح العميل',
        labelEn: 'Client key',
        optional: true,
      },
    ],
    methods: ['card', 'apple_pay'],
  },
  {
    id: 'stripe',
    nameAr: 'Stripe',
    nameEn: 'Stripe',
    hintAr: 'بطاقات دولية (عند التوفر في عُمان).',
    hintEn: 'International cards (where available in Oman).',
    kind: 'live',
    defaultEndpoint: 'https://api.stripe.com',
    credentialFields: [
      { key: 'secretKey', labelAr: 'المفتاح السري', labelEn: 'Secret key', secret: true },
      {
        key: 'publishableKey',
        labelAr: 'المفتاح العام',
        labelEn: 'Publishable key',
        optional: true,
      },
      {
        key: 'webhookSecret',
        labelAr: 'سرّ الويب هوك',
        labelEn: 'Webhook secret',
        secret: true,
        optional: true,
      },
    ],
    methods: ['card', 'apple_pay', 'google_pay'],
  },
];

export function paymentProviderById(id: string): PaymentProviderDefinition | undefined {
  return PAYMENT_PROVIDERS.find((provider) => provider.id === id);
}

export function credentialsComplete(
  provider: PaymentProviderDefinition,
  credentials: Record<string, string>,
): boolean {
  return provider.credentialFields
    .filter((field) => !field.optional)
    .every((field) => Boolean(credentials[field.key]?.trim()));
}
