/**
 * Catalog of outbound notifications (email + WhatsApp) for the studio preview page.
 * Every sample is bilingual (Arabic first, then English) so previews match the product rule.
 */
import type { BrandedEmailInput, EmailTone } from '@/lib/email-template';
import { EXTRA_NOTIFICATION_TEMPLATES } from '@/lib/notification-templates-catalog-extra';
import type { WhatsAppDraft } from '@/lib/whatsapp-message';

export type NotificationChannel = 'email' | 'whatsapp' | 'both';

export type NotificationCategory =
  'team' | 'viewing' | 'booking' | 'contract' | 'finance' | 'maintenance' | 'reminder' | 'account';

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
  /** Draft rendered live (same seed as email); warm wishes only on non-sensitive tones. */
  whatsapp?: WhatsAppDraft;
};

const SAMPLE_ORIGIN = 'https://r.bhd-om.com';
const EN_MARK = '— English —';

/** Demo identity — always the owner and his son; never generic filler names. */
const SAMPLE_OWNER = 'عبد الحميد الرواحي';
const SAMPLE_OWNER_EN = 'Abdul Hamid Al Rawahi';
const SAMPLE_SON = 'مدرك الرواحي';
const SAMPLE_SON_EN = 'Mudrik Al Rawahi';
const SAMPLE_SON_EMAIL = 'mudrik@example.com';

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
    lines: [...(input.linesAr ?? []), EN_MARK, input.introEn, ...(input.linesEn ?? [])],
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
      subjectAr: 'دعوة للانضمام إلى فريق مبنى النور على BHD R',
      subjectEn: 'Invitation to join Mabani Al Noor on BHD R',
      recipientName: SAMPLE_SON,
      titleAr: 'مرحبًا بك في الفريق',
      titleEn: 'Welcome to the team',
      introAr:
        'دعاك عبد الحميد الرواحي للانضمام إلى فريق مبنى النور على منصة BHD R. راجع تفاصيل الدعوة والصلاحيات المحددة، ثم اختر قبول الدعوة أو رفضها.',
      introEn:
        'Abdul Hamid Al Rawahi has invited you to join Mabani Al Noor on BHD R. Review the invitation and assigned permissions, then choose whether to accept or decline.',
      linesAr: ['إن لم يكن لديك حساب بعد، اضغط الزر أدناه وسجّل أو فعّل حسابك بنفس هذا البريد.'],
      linesEn: [
        'If you do not have an account yet, tap the button below and sign in or activate with this same email.',
      ],
      details: [
        { labelAr: 'الفريق', labelEn: 'Team', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الدور', labelEn: 'Role', value: 'حارس مبنى / Building guard' },
        { labelAr: 'البريد', labelEn: 'Email', value: SAMPLE_SON_EMAIL },
      ],
      ctaAr: 'مراجعة الدعوة',
      ctaEn: 'Review invitation',
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
    descriptionEn:
      'Email and WhatsApp to the guest after the viewing is confirmed, with visit pass.',
    editable: false,
    tone: 'booking',
    ...pair({
      tone: 'booking',
      subjectAr: 'تأكيد موعد معاينة العقار',
      subjectEn: 'Property viewing confirmed',
      recipientName: SAMPLE_SON,
      titleAr: 'تم تأكيد موعد المعاينة',
      titleEn: 'Your viewing is confirmed',
      introAr:
        'تم تأكيد معاينتك للعقار مبنى النور يوم 22 أكتوبر 2026 الساعة 5:00 م. يرجى مراجعة موقع العقار وتعليمات الوصول وبطاقة الزيارة قبل التوجه.',
      introEn:
        'Your viewing of Mabani Al Noor is confirmed for 22 October 2026 at 5:00 PM. Please review the property location, arrival instructions and visit pass before you set off.',
      linesAr: ['سيصلك أيضاً اسم مستخدم ورقم سري للدخول إن لزم.'],
      linesEn: ['You will also receive a username and PIN if access credentials are needed.'],
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'A-12' },
        { labelAr: 'الموعد', labelEn: 'When', value: '2026-10-22 17:00' },
        { labelAr: 'المرجع', labelEn: 'Reference', value: 'VR-1042' },
        {
          labelAr: 'الحارس',
          labelEn: 'Guard',
          value: `${SAMPLE_SON} / ${SAMPLE_SON_EN}`,
        },
        { labelAr: 'هاتف الحارس', labelEn: 'Guard phone', value: '+968 9XXX XXXX' },
        {
          labelAr: 'الموقع',
          labelEn: 'Location',
          value: 'مسقط، بوشر · Muscat, Bausher',
        },
        {
          labelAr: 'خريطة الوصول',
          labelEn: 'Map',
          value: 'https://www.google.com/maps?q=23.588000,58.382900',
        },
      ],
      ctaAr: 'عرض تفاصيل المعاينة',
      ctaEn: 'View viewing details',
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
      subjectAr: 'موعد معاينة مجدول — تعليمات استقبال الزائر',
      subjectEn: 'Scheduled viewing — guest arrival details',
      recipientName: SAMPLE_SON,
      titleAr: 'موعد معاينة قادم',
      titleEn: 'Upcoming property viewing',
      introAr:
        'جرى تحديد موعد معاينة للعقار مبنى النور يوم 22 أكتوبر 2026 الساعة 5:00 م. عند وصول الزائر، تحقّق من بطاقة الزيارة وامسح رمزها عبر الإجراء المعتمد.',
      introEn:
        'A viewing for Mabani Al Noor is scheduled for 22 October 2026 at 5:00 PM. When the guest arrives, verify the visit pass and scan its code using the approved process.',
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'A-12' },
        { labelAr: 'الموعد', labelEn: 'When', value: '2026-10-22 17:00' },
        { labelAr: 'الزائر', labelEn: 'Guest', value: `${SAMPLE_OWNER} / ${SAMPLE_OWNER_EN}` },
      ],
      ctaAr: 'فتح بطاقة الزيارة',
      ctaEn: 'Open visit pass',
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
      subjectAr: 'طلب معاينة جديد للعقار مبنى النور',
      subjectEn: 'New viewing request for Mabani Al Noor',
      recipientName: SAMPLE_OWNER,
      titleAr: 'طلب معاينة بانتظار مراجعتك',
      titleEn: 'A viewing request awaits your review',
      introAr:
        'أبدى مدرك الرواحي اهتمامه بمعاينة العقار مبنى النور، والوقت المفضّل هو مساء الأربعاء. راجع الطلب لتأكيد الموعد أو اقتراح وقت بديل.',
      introEn:
        'Mudrik Al Rawahi has requested to view Mabani Al Noor, preferably at Wednesday evening. Review the request to confirm the time or suggest an alternative.',
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'A-12' },
        { labelAr: 'الطالب', labelEn: 'Prospect', value: `${SAMPLE_SON} / ${SAMPLE_SON_EN}` },
      ],
      ctaAr: 'مراجعة طلب المعاينة',
      ctaEn: 'Review viewing request',
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
      subjectAr: 'تم تأكيد حجزك — مبنى النور',
      subjectEn: 'Booking confirmed — Mabani Al Noor',
      recipientName: SAMPLE_SON,
      titleAr: 'حجزك مؤكد',
      titleEn: 'Your booking is confirmed',
      introAr:
        'تم تأكيد حجزك للعقار مبنى النور. تاريخ الوصول: 1 نوفمبر 2026، وتاريخ المغادرة: 5 نوفمبر 2026. راجع تعليمات الوصول وشروط الحجز قبل موعد الإقامة.',
      introEn:
        'Your booking at Mabani Al Noor is confirmed. Check-in: 1 November 2026. Check-out: 5 November 2026. Please review the arrival instructions and booking terms before your stay.',
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور / Mabani Al Noor' },
        { labelAr: 'الوصول', labelEn: 'Check-in', value: '2026-11-01' },
        { labelAr: 'المغادرة', labelEn: 'Check-out', value: '2026-11-05' },
      ],
      ctaAr: 'عرض تفاصيل الحجز',
      ctaEn: 'View booking details',
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
      subjectAr: 'عقد LC-2201 جاهز للمراجعة والتوقيع',
      subjectEn: 'Contract LC-2201 is ready for review and signature',
      recipientName: SAMPLE_SON,
      titleAr: 'العقد جاهز لخطوتك التالية',
      titleEn: 'Your contract is ready for the next step',
      introAr:
        'أصبحت نسخة العقد LC-2201 متاحة للمراجعة. اقرأ البنود والتواريخ والأطراف بعناية، ثم أتمّ التوقيع إذا كانت التفاصيل صحيحة.',
      introEn:
        'Contract LC-2201 is available for review. Please check the terms, dates and parties carefully, then sign if the details are correct.',
      details: [
        { labelAr: 'العقار', labelEn: 'Property', value: 'مبنى النور · A-12' },
        { labelAr: 'المرجع', labelEn: 'Reference', value: 'LC-2201' },
      ],
      ctaAr: 'مراجعة العقد',
      ctaEn: 'Review contract',
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
      subjectAr: 'فاتورة رقم INV-8841 — تاريخ الاستحقاق 5 أكتوبر 2026',
      subjectEn: 'Invoice INV-8841 — due 5 October 2026',
      recipientName: SAMPLE_SON,
      titleAr: 'صدرت فاتورة جديدة',
      titleEn: 'A new invoice is available',
      introAr:
        'صدرت الفاتورة رقم INV-8841 بمبلغ 150.000 ر.ع، وتاريخ استحقاقها 5 أكتوبر 2026. يرجى مراجعة تفاصيل البنود ووسائل السداد المتاحة من صفحة الفاتورة.',
      introEn:
        'Invoice INV-8841 has been issued for 150.000 OMR, due on 5 October 2026. Please review the line items and available payment methods on the invoice page.',
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
      subjectAr: 'إشعار بشأن رصيد إيجار مستحق',
      subjectEn: 'Notice regarding an outstanding rent balance',
      recipientName: SAMPLE_SON,
      titleAr: 'يرجى مراجعة رصيد الإيجار',
      titleEn: 'Please review your rent balance',
      introAr:
        'تُظهر سجلاتنا رصيدًا مستحقًا قدره 150.000 ر.ع مرتبطًا بالفترة أكتوبر 2026، وتاريخ استحقاقه 5 أكتوبر 2026. إذا كنت قد سددت المبلغ بالفعل، فيرجى تحديثنا أو مراجعة سجل الدفعات حتى نتحقق من القيد.',
      introEn:
        'Our records show an outstanding balance of 150.000 OMR for October 2026, due on 5 October 2026. If you have already paid, please update us or review the payment record so the entry can be checked.',
      details: [
        { labelAr: 'المبلغ', labelEn: 'Amount', value: '150.000 ر.ع / OMR' },
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'مبنى النور · A-12' },
      ],
      ctaAr: 'مراجعة الرصيد',
      ctaEn: 'Review balance',
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
      subjectAr: 'تحديث طلب الصيانة MR-441',
      subjectEn: 'Update on maintenance request MR-441',
      recipientName: SAMPLE_SON,
      titleAr: 'تم تحديث حالة طلب الصيانة',
      titleEn: 'Your maintenance request has been updated',
      introAr:
        'تم تحديث حالة طلب الصيانة MR-441 الخاص بالعقار مبنى النور إلى: قيد التنفيذ. يمكنك الاطلاع على تفاصيل التحديث وأي موعد أو إجراء مطلوب من صفحة الطلب.',
      introEn:
        'Maintenance request MR-441 for Mabani Al Noor has been updated to: In progress. Visit the request page for the latest details and any required appointment or action.',
      details: [
        { labelAr: 'الوحدة', labelEn: 'Unit', value: 'A-12' },
        { labelAr: 'الحالة', labelEn: 'Status', value: 'قيد التنفيذ / In progress' },
      ],
      ctaAr: 'متابعة طلب الصيانة',
      ctaEn: 'Track maintenance request',
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
      subjectEn: 'Your account verification is approved',
      recipientName: SAMPLE_OWNER,
      titleAr: 'اكتمل توثيق حسابك',
      titleEn: 'Your account is verified',
      introAr:
        'تمت مراجعة طلب التوثيق واعتماده. يمكنك مراجعة حالة حسابك والصلاحيات المتاحة من إعدادات الحساب.',
      introEn:
        'Your verification request has been reviewed and approved. You can check your account status and available features in your account settings.',
      details: [{ labelAr: 'الحالة', labelEn: 'Status', value: 'موثّق / Verified' }],
      ctaAr: 'عرض حالة الحساب',
      ctaEn: 'View account status',
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
      subjectAr: 'شارة جديدة أُضيفت إلى ملفك',
      subjectEn: 'A new badge has been added to your profile',
      recipientName: SAMPLE_OWNER,
      titleAr: 'تقديرًا لالتزامك، أُضيفت شارة جديدة',
      titleEn: 'A new badge recognises your contribution',
      introAr:
        'أُضيفت شارة «مضيف موثوق» إلى ملفك تقديرًا لـالالتزام بمعايير الضيافة. شكرًا لمساهمتك في رفع مستوى الجودة والموثوقية على المنصة.',
      introEn:
        'The “Trusted host” badge has been added to your profile in recognition of consistent hospitality standards. Thank you for helping strengthen quality and trust across the platform.',
      details: [{ labelAr: 'الشارة', labelEn: 'Badge', value: 'مضيف موثوق / Trusted host' }],
      ctaAr: 'عرض الشارة',
      ctaEn: 'View badge',
      ctaUrl: `${SAMPLE_ORIGIN}/ar/admin/badges`,
      footnoteAr: 'أُرسلت لأنك حصلت على شارة جديدة.',
      footnoteEn: 'Sent because you were awarded a new badge.',
    }),
  },
  ...EXTRA_NOTIFICATION_TEMPLATES,
];

export function listNotificationTemplates(): NotificationTemplateMeta[] {
  return NOTIFICATION_TEMPLATES.map(({ email: _e, whatsapp: _w, ...meta }) => meta);
}

export function getNotificationTemplate(id: string): NotificationTemplateSample | null {
  return NOTIFICATION_TEMPLATES.find((item) => item.id === id) ?? null;
}
