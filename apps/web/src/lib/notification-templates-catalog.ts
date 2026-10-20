/**
 * Catalog of outbound notifications (email + WhatsApp) for the studio preview page.
 * Every sample is bilingual (Arabic first, then English) so previews match the product rule.
 */
import type { BrandedEmailInput, EmailTone } from '@/lib/email-template';
import type { WhatsAppDraft } from '@/lib/whatsapp-message';

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
  /** Draft rendered live with cheerful wishes (same seed as email). */
  whatsapp?: WhatsAppDraft;
};

const SAMPLE_ORIGIN = 'https://r.bhd-om.com';
const EN_MARK = '— English —';

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

type BilingualSample = {
  tone: EmailTone;
  subjectAr: string;
  subjectEn: string;
  recipientName: string;
  titleAr: string;
  titleEn: string;
  introAr: string;
  introEn: string;
  linesAr?: readonly string[];
  linesEn?: readonly string[];
  details: ReadonlyArray<{ labelAr: string; labelEn: string; value: string }>;
  ctaAr: string;
  ctaEn: string;
  ctaUrl: string;
  footnoteAr: string;
  footnoteEn: string;
};

/** Build a bilingual branded email sample (Arabic block, then English block). */
function bilingualEmail(input: BilingualSample): BrandedEmailInput & { subject: string } {
  return {
    tone: input.tone,
    subject: `${input.subjectAr} · ${input.subjectEn}`,
    recipientName: input.recipientName,
    title: `${input.titleAr} · ${input.titleEn}`,
    intro: input.introAr,
    lines: [
      ...(input.linesAr ?? []),
      EN_MARK,
      input.introEn,
      ...(input.linesEn ?? []),
    ],
    details: input.details.map((item) => ({
      label: `${item.labelAr} / ${item.labelEn}`,
      value: item.value,
    })),
    cta: {
      label: `${input.ctaAr} · ${input.ctaEn}`,
      url: input.ctaUrl,
    },
    footnote: `${input.footnoteAr} · ${input.footnoteEn}`,
  };
}

/** Matching WhatsApp draft — rendered with icons + rotating wishes at preview time. */
function bilingualWhatsApp(input: BilingualSample): WhatsAppDraft {
  return {
    tone: input.tone,
    recipientName: input.recipientName,
    titleAr: input.titleAr,
    titleEn: input.titleEn,
    introAr: input.introAr,
    introEn: input.introEn,
    linesAr: input.linesAr,
    linesEn: input.linesEn,
    details: input.details,
    linkLabelAr: input.ctaAr,
    linkLabelEn: input.ctaEn,
    link: input.ctaUrl,
  };
}

function pair(input: BilingualSample): {
  email: BrandedEmailInput & { subject: string };
  whatsapp: WhatsAppDraft;
} {
  return { email: bilingualEmail(input), whatsapp: bilingualWhatsApp(input) };
}

/** Full samples used for live preview — every channel is AR + EN. */
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
    ...pair({
      tone: 'team',
      subjectAr: 'مرحباً بك في فريق مبنى النور على BHD R',
      subjectEn: 'Welcome to the Mabani Al Noor team on BHD R',
      recipientName: 'سعيد الحارثي',
      titleAr: 'أنت مدعو لفريق مبنى النور 🎉',
      titleEn: 'You’re invited to Mabani Al Noor',
      introAr:
        'خبر سار: عبد الحميد دعاك للانضمام إلى فريق «مبنى النور» بصفة حارس مبنى. مرحباً بك معنا — فنجان القهوة الافتراضي جاهز!',
      introEn:
        'Good news: Abdul Hamid invited you to join the “Mabani Al Noor” team as Building guard. Welcome aboard — virtual coffee is on us!',
      linesAr: [
        'إن لم يكن لديك حساب بعد، اضغط الزر أدناه وسجّل أو فعّل حسابك بنفس هذا البريد.',
      ],
      linesEn: [
        'If you do not have an account yet, tap the button below and sign in or activate with this same email.',
      ],
      details: [
        { labelAr: 'الفريق', labelEn: 'Team', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الدور', labelEn: 'Role', value: 'حارس مبنى / Building guard' },
        { labelAr: 'البريد', labelEn: 'Email', value: 'guard@example.com' },
      ],
      ctaAr: 'تفعيل الحساب والدخول',
      ctaEn: 'Activate & sign in',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/login?org=sample`,
      footnoteAr: 'وصلت هذه الدعوة لأن مدير الفريق أضاف بريدك في BHD R.',
      footnoteEn: 'You received this because a team admin added your email in BHD R.',
    }),
  },
  {
    id: 'viewing-scheduled-guest',
    channel: 'both',
    category: 'viewing',
    nameAr: 'تأكيد موعد معاينة للعميل',
    nameEn: 'Viewing schedule — guest',
    descriptionAr: 'بريد وواتساب للعميل بعد تأكيد الموعد مع بطاقة الزيارة.',
    descriptionEn: 'Email and WhatsApp to the guest after the viewing is confirmed, with visit pass.',
    editable: false,
    tone: 'booking',
    ...pair({
      tone: 'booking',
      subjectAr: 'تم تأكيد موعد معاينتك',
      subjectEn: 'Your viewing is confirmed',
      recipientName: 'أحمد الزدجالي',
      titleAr: 'موعد المعاينة جاهز 🗝️',
      titleEn: 'Your viewing is ready',
      introAr: 'حدّدنا لك موعداً لمعاينة الوحدة. احفظ بطاقة الزيارة وأظهرها عند الوصول.',
      introEn: 'Your unit viewing is confirmed. Keep the visit pass ready and show it on arrival.',
      linesAr: ['سيصلك أيضاً اسم مستخدم ورقم سري للدخول إن لزم.'],
      linesEn: ['You will also receive a username and PIN if access credentials are needed.'],
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'A-12' },
        { labelAr: 'الموعد', labelEn: 'When', value: '2026-10-22 17:00' },
        { labelAr: 'المرجع', labelEn: 'Reference', value: 'VR-1042' },
      ],
      ctaAr: 'فتح بطاقة المعاينة',
      ctaEn: 'Open visit pass',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/viewing-pass?t=sample`,
      footnoteAr: 'أُرسلت لأن موعد معاينتك اعتُمد.',
      footnoteEn: 'Sent because your viewing appointment was confirmed.',
    }),
  },
  {
    id: 'viewing-scheduled-contact',
    channel: 'both',
    category: 'viewing',
    nameAr: 'إشعار مسؤول المعاينة / الحارس',
    nameEn: 'Viewing notice — guard / contact',
    descriptionAr: 'يُرسل لمسؤول المعاينة لمسح باركود الزائر عند الوصول.',
    descriptionEn: 'Sent to the viewing contact to scan the guest barcode on arrival.',
    editable: false,
    tone: 'team',
    ...pair({
      tone: 'team',
      subjectAr: 'معاينة قادمة — امسح البطاقة عند الوصول',
      subjectEn: 'Upcoming viewing — scan the pass on arrival',
      recipientName: 'سعيد الحارثي',
      titleAr: 'زائر معاينة في الطريق 🤝',
      titleEn: 'A viewing guest is coming',
      introAr: 'حُدّد موعد معاينة. عند وصول الزائر امسح باركود بطاقة الزيارة من بوابة المسح.',
      introEn: 'A viewing is scheduled. When the guest arrives, scan their visit-pass barcode at the gate.',
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'A-12' },
        { labelAr: 'الموعد', labelEn: 'When', value: '2026-10-22 17:00' },
        { labelAr: 'الزائر', labelEn: 'Guest', value: 'أحمد الزدجالي' },
      ],
      ctaAr: 'فتح بوابة المسح',
      ctaEn: 'Open scan gate',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/viewing-gate?t=sample`,
      footnoteAr: 'أُرسلت لأنك مسؤول المعاينة لهذا العقار.',
      footnoteEn: 'Sent because you are the viewing contact for this property.',
    }),
  },
  {
    id: 'viewing-request-owner',
    channel: 'both',
    category: 'viewing',
    nameAr: 'طلب معاينة جديد للمالك',
    nameEn: 'New viewing request — owner',
    descriptionAr: 'تنبيه المالك عند تقديم عميل لطلب معاينة.',
    descriptionEn: 'Owner alert when a prospect requests a viewing.',
    editable: false,
    tone: 'request',
    ...pair({
      tone: 'request',
      subjectAr: 'طلب معاينة جديد',
      subjectEn: 'New viewing request',
      recipientName: 'عبد الحميد الرواحي',
      titleAr: 'طلب معاينة بانتظار ردك 📨',
      titleEn: 'A viewing request awaits your reply',
      introAr: 'عميل مهتم بمعاينة وحدة. افتح الطلب لتحديد الموعد أو إضافة ملاحظة.',
      introEn: 'A prospect wants to view a unit. Open the request to set a time or add a note.',
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'A-12' },
        { labelAr: 'الطالب', labelEn: 'Prospect', value: 'أحمد الزدجالي' },
      ],
      ctaAr: 'فتح طلب المعاينة',
      ctaEn: 'Open viewing request',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/owner/bookings/viewings/sample`,
      footnoteAr: 'أُرسلت لأن عقارك استقبل طلب معاينة.',
      footnoteEn: 'Sent because your property received a viewing request.',
    }),
  },
  {
    id: 'booking-confirmed',
    channel: 'both',
    category: 'booking',
    nameAr: 'تأكيد حجز / إقامة',
    nameEn: 'Booking / stay confirmed',
    descriptionAr: 'إشعار تأكيد بعد اعتماد الحجز.',
    descriptionEn: 'Confirmation after a booking is approved.',
    editable: false,
    tone: 'booking',
    ...pair({
      tone: 'booking',
      subjectAr: 'تم تأكيد حجزك',
      subjectEn: 'Your booking is confirmed',
      recipientName: 'سارة الكندي',
      titleAr: 'حجزك مؤكّد 🌴',
      titleEn: 'Booking confirmed',
      introAr: 'تم اعتماد طلبك. تفاصيل الوصول والمغادرة أدناه.',
      introEn: 'Your request was approved. Check-in and check-out details are below.',
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الوصول', labelEn: 'Check-in', value: '2026-11-01' },
        { labelAr: 'المغادرة', labelEn: 'Check-out', value: '2026-11-05' },
      ],
      ctaAr: 'عرض الحجز',
      ctaEn: 'View booking',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/portal`,
      footnoteAr: 'أُرسلت بعد اعتماد حجزك.',
      footnoteEn: 'Sent after your booking was approved.',
    }),
  },
  {
    id: 'contract-ready',
    channel: 'both',
    category: 'contract',
    nameAr: 'عقد جاهز للتوقيع',
    nameEn: 'Contract ready to sign',
    descriptionAr: 'يُرسل عندما يصبح العقد بانتظار توقيع الطرف.',
    descriptionEn: 'Sent when a contract awaits a party signature.',
    editable: false,
    tone: 'contract',
    ...pair({
      tone: 'contract',
      subjectAr: 'عقد الإيجار جاهز للتوقيع',
      subjectEn: 'Lease contract ready to sign',
      recipientName: 'أحمد الزدجالي',
      titleAr: 'عقدك بانتظار التوقيع 📜',
      titleEn: 'Your contract awaits signature',
      introAr: 'راجع البنود ووقّع إلكترونياً لإكمال الإجراء.',
      introEn: 'Review the terms and sign electronically to complete the process.',
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور · A-12' },
        { labelAr: 'المرجع', labelEn: 'Reference', value: 'LC-2201' },
      ],
      ctaAr: 'فتح العقد',
      ctaEn: 'Open contract',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/portal`,
      footnoteAr: 'أُرسلت لأن عقدك بانتظار توقيعك.',
      footnoteEn: 'Sent because your contract is waiting for your signature.',
    }),
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
    ...pair({
      tone: 'invoice',
      subjectAr: 'فاتورة إيجار أكتوبر',
      subjectEn: 'October rent invoice',
      recipientName: 'أحمد الزدجالي',
      titleAr: 'فاتورتك جاهزة 🧾',
      titleEn: 'Your invoice is ready',
      introAr: 'مرفق تفاصيل المبلغ وتاريخ الاستحقاق.',
      introEn: 'Amount and due date are listed below.',
      details: [
        { labelAr: 'المبلغ', labelEn: 'Amount', value: '150.000 ر.ع / OMR' },
        { labelAr: 'الاستحقاق', labelEn: 'Due', value: '2026-10-05' },
        { labelAr: 'المرجع', labelEn: 'Reference', value: 'INV-8841' },
      ],
      ctaAr: 'عرض الفاتورة',
      ctaEn: 'View invoice',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/portal`,
      footnoteAr: 'أُرسلت من محاسبة العقار.',
      footnoteEn: 'Sent from property accounting.',
    }),
  },
  {
    id: 'arrears-reminder',
    channel: 'both',
    category: 'reminder',
    nameAr: 'تذكير متأخرات إيجار',
    nameEn: 'Rent arrears reminder',
    descriptionAr: 'تذكير ودّي آلي للمستأجر عند تأخر السداد.',
    descriptionEn: 'Friendly automated reminder when rent is overdue.',
    editable: false,
    tone: 'arrears',
    ...pair({
      tone: 'arrears',
      subjectAr: 'تذكير ودّي بمتأخرات الإيجار',
      subjectEn: 'Friendly rent arrears reminder',
      recipientName: 'أحمد الزدجالي',
      titleAr: 'تذكير لطيف ⏰',
      titleEn: 'A gentle reminder',
      introAr: 'نذكّرك بوجود مبلغ مستحق. إن دفعتَ مسبقاً فتجاهل هذه الرسالة.',
      introEn: 'This is a friendly note about an outstanding amount. If you already paid, please ignore this.',
      details: [
        { labelAr: 'المبلغ', labelEn: 'Amount', value: '150.000 ر.ع / OMR' },
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'مبنى النور · A-12' },
      ],
      ctaAr: 'عرض التفاصيل',
      ctaEn: 'View details',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/portal`,
      footnoteAr: 'تذكير آلي من نظام التحصيل.',
      footnoteEn: 'Automated reminder from collections.',
    }),
  },
  {
    id: 'maintenance-update',
    channel: 'both',
    category: 'maintenance',
    nameAr: 'تحديث طلب صيانة',
    nameEn: 'Maintenance request update',
    descriptionAr: 'إشعار عند تحديث حالة طلب صيانة.',
    descriptionEn: 'Notice when a maintenance request status changes.',
    editable: false,
    tone: 'maintenance',
    ...pair({
      tone: 'maintenance',
      subjectAr: 'تحديث على طلب الصيانة',
      subjectEn: 'Maintenance request update',
      recipientName: 'أحمد الزدجالي',
      titleAr: 'طلب الصيانة قيد التنفيذ 🛠️',
      titleEn: 'Maintenance in progress',
      introAr: 'الفني في الطريق أو يعمل على البلاغ. سنُعلمك عند الإغلاق.',
      introEn: 'A technician is on the way or working on the request. We will notify you when it is closed.',
      details: [
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'A-12' },
        { labelAr: 'الحالة', labelEn: 'Status', value: 'قيد التنفيذ / In progress' },
      ],
      ctaAr: 'عرض الطلب',
      ctaEn: 'View request',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/portal`,
      footnoteAr: 'أُرسلت لأن حالة طلب الصيانة تغيّرت.',
      footnoteEn: 'Sent because the maintenance request status changed.',
    }),
  },
  {
    id: 'verification',
    channel: 'both',
    category: 'account',
    nameAr: 'توثيق الحساب',
    nameEn: 'Account verification',
    descriptionAr: 'نتيجة مراجعة طلب التوثيق.',
    descriptionEn: 'Outcome of an account verification review.',
    editable: false,
    tone: 'reward',
    ...pair({
      tone: 'reward',
      subjectAr: 'تم اعتماد توثيق حسابك',
      subjectEn: 'Your account verification was approved',
      recipientName: 'عبد الحميد الرواحي',
      titleAr: 'حسابك موثّق 🏆',
      titleEn: 'Your account is verified',
      introAr: 'اعتماد التوثيق يفتح صلاحيات أوضح وثقة أعلى للمستأجرين.',
      introEn: 'Verification unlocks clearer permissions and stronger trust with tenants.',
      details: [
        { labelAr: 'الحالة', labelEn: 'Status', value: 'موثّق / Verified' },
      ],
      ctaAr: 'فتح الحساب',
      ctaEn: 'Open account',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/portal`,
      footnoteAr: 'أُرسلت بعد مراجعة طلب التوثيق.',
      footnoteEn: 'Sent after your verification request was reviewed.',
    }),
  },
  {
    id: 'badge-awarded',
    channel: 'both',
    category: 'account',
    nameAr: 'شارة / مكافأة',
    nameEn: 'Badge / reward',
    descriptionAr: 'عند منح شارة للمنشأة أو الطرف.',
    descriptionEn: 'When a badge is awarded to an organization or party.',
    editable: false,
    tone: 'reward',
    ...pair({
      tone: 'reward',
      subjectAr: 'حصلت على شارة جديدة',
      subjectEn: 'You earned a new badge',
      recipientName: 'عبد الحميد الرواحي',
      titleAr: 'شارة جديدة تستحق الاحتفال ✨',
      titleEn: 'A new badge to celebrate',
      introAr: 'أُضيفت شارة إلى ملفك تقديراً لالتزامك.',
      introEn: 'A badge was added to your profile in recognition of your commitment.',
      details: [
        { labelAr: 'الشارة', labelEn: 'Badge', value: 'مضيف موثوق / Trusted host' },
      ],
      ctaAr: 'عرض الشارات',
      ctaEn: 'View badges',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/owner/badges`,
      footnoteAr: 'أُرسلت لأنك حصلت على شارة جديدة.',
      footnoteEn: 'Sent because you were awarded a new badge.',
    }),
  },
];

export function listNotificationTemplates(): NotificationTemplateMeta[] {
  return NOTIFICATION_TEMPLATES.map(({ email: _e, whatsapp: _w, ...meta }) => meta);
}

export function getNotificationTemplate(id: string): NotificationTemplateSample | null {
  return NOTIFICATION_TEMPLATES.find((item) => item.id === id) ?? null;
}
