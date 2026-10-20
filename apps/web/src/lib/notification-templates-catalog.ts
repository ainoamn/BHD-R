/**
 * Catalog of outbound notifications (email + WhatsApp) for the studio preview page.
 * Sample payloads mirror what production sends; editing lives in a later release.
 */
import type { BrandedEmailInput, EmailTone } from '@/lib/email-template';

export type NotificationChannel = 'email' | 'whatsapp' | 'both';

export type NotificationCategory =
  | 'team'
  | 'viewing'
  | 'booking'
  | 'contract'
  | 'finance'
  | 'maintenance'
  | 'reminder'
  | 'account';

export type NotificationTemplateMeta = {
  id: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  /** Phase 1 is preview-only; copy still lives in code. */
  editable: false;
  tone?: EmailTone;
};

export type NotificationTemplateSample = NotificationTemplateMeta & {
  email?: BrandedEmailInput & { subject: string };
  whatsapp?: { textAr: string; textEn: string };
};

const SAMPLE_ORIGIN = 'https://r.bhd-om.com';

export const NOTIFICATION_CATEGORY_LABELS: Record<
  NotificationCategory,
  { ar: string; en: string }
> = {
  team: { ar: 'الفريق', en: 'Team' },
  viewing: { ar: 'المعاينة', en: 'Viewing' },
  booking: { ar: 'الحجوزات', en: 'Bookings' },
  contract: { ar: 'العقود', en: 'Contracts' },
  finance: { ar: 'المالية', en: 'Finance' },
  maintenance: { ar: 'الصيانة', en: 'Maintenance' },
  reminder: { ar: 'التذكيرات', en: 'Reminders' },
  account: { ar: 'الحساب', en: 'Account' },
};

/** Full samples used for live preview. */
export const NOTIFICATION_TEMPLATES: readonly NotificationTemplateSample[] = [
  {
    id: 'team-invite',
    channel: 'both',
    category: 'team',
    nameAr: 'دعوة عضو فريق',
    nameEn: 'Team member invite',
    descriptionAr: 'تُرسل عند إضافة حارس أو موظف بالبريد لأول مرة.',
    descriptionEn: 'Sent when a guard or staff member is invited by email.',
    editable: false,
    tone: 'team',
    email: {
      tone: 'team',
      subject: 'مرحباً بك في فريق مبنى النور على BHD R · Welcome to the Mabani Al Noor team',
      recipientName: 'سعيد الحارثي',
      title: 'أنت مدعو لفريق مبنى النور 🎉',
      intro:
        'خبر سار: عبد الحميد دعاك للانضمام إلى فريق «مبنى النور» على منصة BHD R بصفة حارس مبنى / Building guard. مرحباً بك معنا!',
      lines: [
        'إن لم يكن لديك حساب بعد، اضغط الزر أدناه وسجّل أو فعّل حسابك بنفس هذا البريد.',
        '— English —',
        'Good news: you were invited to join the team on BHD R as Building guard. Welcome aboard!',
        'Use the button below to sign in or activate your account with the same email.',
      ],
      details: [
        { label: 'الفريق / Team', value: 'مبنى النور' },
        { label: 'الدور / Role', value: 'حارس مبنى / Building guard' },
        { label: 'البريد / Email', value: 'guard@example.com' },
      ],
      cta: {
        label: 'تفعيل الحساب والدخول · Activate & sign in',
        url: `${SAMPLE_ORIGIN}/ar/login?org=sample`,
      },
      footnote: 'وصلت هذه الدعوة لأن مدير الفريق أضاف بريدك في BHD R.',
    },
    whatsapp: {
      textAr:
        'دعوة للانضمام إلى فريق «مبنى النور» على BHD R.\nادخل بحساب BHD المسجّل بالبريد guard@example.com:\nhttps://r.bhd-om.com/ar/login?org=sample',
      textEn:
        'You are invited to the “Mabani Al Noor” team on BHD R.\nSign in with the BHD account that uses guard@example.com:\nhttps://r.bhd-om.com/ar/login?org=sample',
    },
  },
  {
    id: 'viewing-scheduled-guest',
    channel: 'email',
    category: 'viewing',
    nameAr: 'تأكيد موعد معاينة للعميل',
    nameEn: 'Viewing schedule — guest',
    descriptionAr: 'بريد العميل بعد تأكيد الموعد مع بطاقة الزيارة.',
    descriptionEn: 'Guest email after the viewing time is confirmed, with visit pass.',
    editable: false,
    tone: 'booking',
    email: {
      tone: 'booking',
      subject: 'تم تأكيد موعد معاينتك · Viewing confirmed',
      recipientName: 'أحمد الزدجالي',
      title: 'موعد المعاينة جاهز 🗝️',
      intro: 'حدّدنا لك موعداً لمعاينة الوحدة. احفظ بطاقة الزيارة وأظهرها عند الوصول.',
      lines: [
        'Your viewing is confirmed. Keep the visit pass ready and show it on arrival.',
      ],
      details: [
        { label: 'العقار', value: 'مبنى النور' },
        { label: 'الوحدة', value: 'A-12' },
        { label: 'الموعد', value: '2026-10-22 17:00' },
        { label: 'المرجع', value: 'VR-1042' },
      ],
      cta: {
        label: 'فتح بطاقة المعاينة',
        url: `${SAMPLE_ORIGIN}/ar/viewing-pass?t=sample`,
      },
    },
  },
  {
    id: 'viewing-scheduled-contact',
    channel: 'email',
    category: 'viewing',
    nameAr: 'إشعار مسؤول المعاينة / الحارس',
    nameEn: 'Viewing notice — guard / contact',
    descriptionAr: 'يُرسل لمسؤول المعاينة لمسح باركود الزائر عند الوصول.',
    descriptionEn: 'Sent to the viewing contact to scan the guest barcode on arrival.',
    editable: false,
    tone: 'team',
    email: {
      tone: 'team',
      subject: 'معاينة قادمة — امسح البطاقة عند الوصول',
      recipientName: 'سعيد الحارثي',
      title: 'زائر معاينة في الطريق 🤝',
      intro: 'حُدّد موعد معاينة. عند وصول الزائر امسح باركود بطاقة الزيارة من بوابة المسح.',
      details: [
        { label: 'العقار', value: 'مبنى النور' },
        { label: 'الوحدة', value: 'A-12' },
        { label: 'الموعد', value: '2026-10-22 17:00' },
        { label: 'الزائر', value: 'أحمد الزدجالي' },
      ],
      cta: {
        label: 'فتح بوابة المسح',
        url: `${SAMPLE_ORIGIN}/ar/viewing-gate?t=sample`,
      },
    },
  },
  {
    id: 'viewing-request-owner',
    channel: 'email',
    category: 'viewing',
    nameAr: 'طلب معاينة جديد للمالك',
    nameEn: 'New viewing request — owner',
    descriptionAr: 'تنبيه المالك عند تقديم عميل لطلب معاينة.',
    descriptionEn: 'Owner alert when a prospect requests a viewing.',
    editable: false,
    tone: 'request',
    email: {
      tone: 'request',
      subject: 'طلب معاينة جديد',
      recipientName: 'عبد الحميد الرواحي',
      title: 'طلب معاينة بانتظار ردك 📨',
      intro: 'عميل مهتم بمعاينة وحدة. افتح الطلب لتحديد الموعد أو إضافة ملاحظة.',
      details: [
        { label: 'العقار', value: 'مبنى النور' },
        { label: 'الوحدة', value: 'A-12' },
        { label: 'الطالب', value: 'أحمد الزدجالي' },
      ],
      cta: {
        label: 'فتح طلب المعاينة',
        url: `${SAMPLE_ORIGIN}/ar/owner/bookings/viewings/sample`,
      },
    },
  },
  {
    id: 'booking-confirmed',
    channel: 'email',
    category: 'booking',
    nameAr: 'تأكيد حجز / إقامة',
    nameEn: 'Booking / stay confirmed',
    descriptionAr: 'إشعار تأكيد بعد اعتماد الحجز.',
    descriptionEn: 'Confirmation after a booking is approved.',
    editable: false,
    tone: 'booking',
    email: {
      tone: 'booking',
      subject: 'تم تأكيد حجزك',
      recipientName: 'سارة الكندي',
      title: 'حجزك مؤكّد 🌴',
      intro: 'تم اعتماد طلبك. تفاصيل الوصول والمغادرة أدناه.',
      details: [
        { label: 'العقار', value: 'مبنى النور' },
        { label: 'الوصول', value: '2026-11-01' },
        { label: 'المغادرة', value: '2026-11-05' },
      ],
      cta: { label: 'عرض الحجز', url: `${SAMPLE_ORIGIN}/ar/portal` },
    },
  },
  {
    id: 'contract-ready',
    channel: 'email',
    category: 'contract',
    nameAr: 'عقد جاهز للتوقيع',
    nameEn: 'Contract ready to sign',
    descriptionAr: 'يُرسل عندما يصبح العقد بانتظار توقيع الطرف.',
    descriptionEn: 'Sent when a contract awaits a party signature.',
    editable: false,
    tone: 'contract',
    email: {
      tone: 'contract',
      subject: 'عقد الإيجار جاهز للتوقيع',
      recipientName: 'أحمد الزدجالي',
      title: 'عقدك بانتظار التوقيع 📜',
      intro: 'راجع البنود ووقّع إلكترونياً لإكمال الإجراء.',
      details: [
        { label: 'العقار', value: 'مبنى النور · A-12' },
        { label: 'المرجع', value: 'LC-2201' },
      ],
      cta: { label: 'فتح العقد', url: `${SAMPLE_ORIGIN}/ar/portal` },
    },
  },
  {
    id: 'invoice-issued',
    channel: 'both',
    category: 'finance',
    nameAr: 'فاتورة / مستند محاسبي',
    nameEn: 'Invoice / accounting document',
    descriptionAr: 'بريد وواتساب عند إرسال فاتورة أو قيد من المحاسبة.',
    descriptionEn: 'Email and WhatsApp when sending an invoice or journal from accounting.',
    editable: false,
    tone: 'invoice',
    email: {
      tone: 'invoice',
      subject: 'فاتورة إيجار أكتوبر',
      recipientName: 'أحمد الزدجالي',
      title: 'فاتورتك جاهزة 🧾',
      intro: 'مرفق تفاصيل المبلغ وتاريخ الاستحقاق.',
      details: [
        { label: 'المبلغ', value: '150.000 ر.ع' },
        { label: 'الاستحقاق', value: '2026-10-05' },
        { label: 'المرجع', value: 'INV-8841' },
      ],
      cta: { label: 'عرض الفاتورة', url: `${SAMPLE_ORIGIN}/ar/portal` },
    },
    whatsapp: {
      textAr:
        'فاتورة إيجار أكتوبر — 150.000 ر.ع تستحق في 2026-10-05.\nالمرجع INV-8841\nhttps://r.bhd-om.com/ar/portal',
      textEn:
        'October rent invoice — OMR 150.000 due 2026-10-05.\nRef INV-8841\nhttps://r.bhd-om.com/ar/portal',
    },
  },
  {
    id: 'arrears-reminder',
    channel: 'email',
    category: 'reminder',
    nameAr: 'تذكير متأخرات إيجار',
    nameEn: 'Rent arrears reminder',
    descriptionAr: 'تذكير ودّي آلي للمستأجر عند تأخر السداد.',
    descriptionEn: 'Friendly automated reminder when rent is overdue.',
    editable: false,
    tone: 'arrears',
    email: {
      tone: 'arrears',
      subject: 'تذكير ودّي بمتأخرات الإيجار',
      recipientName: 'أحمد الزدجالي',
      title: 'تذكير لطيف ⏰',
      intro: 'نذكّرك بوجود مبلغ مستحق. إن دفعتَ مسبقاً فتجاهل هذه الرسالة.',
      details: [
        { label: 'المبلغ', value: '150.000 ر.ع' },
        { label: 'الوحدة', value: 'مبنى النور · A-12' },
      ],
      cta: { label: 'عرض التفاصيل', url: `${SAMPLE_ORIGIN}/ar/portal` },
    },
  },
  {
    id: 'maintenance-update',
    channel: 'email',
    category: 'maintenance',
    nameAr: 'تحديث طلب صيانة',
    nameEn: 'Maintenance request update',
    descriptionAr: 'إشعار عند تحديث حالة طلب صيانة.',
    descriptionEn: 'Notice when a maintenance request status changes.',
    editable: false,
    tone: 'maintenance',
    email: {
      tone: 'maintenance',
      subject: 'تحديث على طلب الصيانة',
      recipientName: 'أحمد الزدجالي',
      title: 'طلب الصيانة قيد التنفيذ 🛠️',
      intro: 'الفني في الطريق أو يعمل على البلاغ. سنُعلمك عند الإغلاق.',
      details: [
        { label: 'الوحدة', value: 'A-12' },
        { label: 'الحالة', value: 'قيد التنفيذ' },
      ],
      cta: { label: 'عرض الطلب', url: `${SAMPLE_ORIGIN}/ar/portal` },
    },
  },
  {
    id: 'verification',
    channel: 'email',
    category: 'account',
    nameAr: 'توثيق الحساب',
    nameEn: 'Account verification',
    descriptionAr: 'نتيجة مراجعة طلب التوثيق.',
    descriptionEn: 'Outcome of an account verification review.',
    editable: false,
    tone: 'reward',
    email: {
      tone: 'reward',
      subject: 'تم اعتماد توثيق حسابك',
      recipientName: 'عبد الحميد الرواحي',
      title: 'حسابك موثّق 🏆',
      intro: 'اعتماد التوثيق يفتح صلاحيات أوضح وثقة أعلى للمستأجرين.',
      cta: { label: 'فتح الحساب', url: `${SAMPLE_ORIGIN}/ar/portal` },
    },
  },
  {
    id: 'badge-awarded',
    channel: 'email',
    category: 'account',
    nameAr: 'شارة / مكافأة',
    nameEn: 'Badge / reward',
    descriptionAr: 'عند منح شارة للمنشأة أو الطرف.',
    descriptionEn: 'When a badge is awarded to an organization or party.',
    editable: false,
    tone: 'reward',
    email: {
      tone: 'reward',
      subject: 'حصلت على شارة جديدة',
      recipientName: 'عبد الحميد الرواحي',
      title: 'شارة جديدة تستحق الاحتفال ✨',
      intro: 'أُضيفت شارة إلى ملفك تقديراً لالتزامك.',
      details: [{ label: 'الشارة', value: 'مضيف موثوق' }],
      cta: { label: 'عرض الشارات', url: `${SAMPLE_ORIGIN}/ar/owner/badges` },
    },
  },
];

export function listNotificationTemplates(): NotificationTemplateMeta[] {
  return NOTIFICATION_TEMPLATES.map(
    ({ email: _e, whatsapp: _w, ...meta }) => meta,
  );
}

export function getNotificationTemplate(id: string): NotificationTemplateSample | null {
  return NOTIFICATION_TEMPLATES.find((item) => item.id === id) ?? null;
}
