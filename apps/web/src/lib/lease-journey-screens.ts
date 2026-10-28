import {
  leaseJourneyStageIndex,
  leaseJourneyStageLabels,
  type LeaseJourneyPhase,
} from '@/lib/lease-reservation-lifecycle';
import type { LeaseLifecycleView } from '@/lib/public-lease-booking-neon';

export type LeaseJourneyProps = {
  locale: 'ar' | 'en';
  referenceCode: string;
  mode: 'rent' | 'sale';
  phase: LeaseJourneyPhase;
  lifecycle: LeaseLifecycleView;
  deposit: string;
  propertyName: string;
};

export function journeyStamp(iso: string | null, ar: boolean): string {
  if (!iso) return '';
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00.000Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

export type LeaseJourneyScreen = {
  headline: string;
  body: string;
  guide?: string[] | undefined;
  scene?: 'send' | 'desk' | 'contract' | 'handover' | 'keys' | undefined;
  sceneDone?: boolean | undefined;
  sceneStatus?: string | undefined;
  action?:
    'sign_terms' | 'view_terms' | 'documents' | 'sign_contract' | 'view_contract' | undefined;
};

/** Warm, plain wording for each stage the customer can open. */
export function leaseScreens(props: LeaseJourneyProps): Array<LeaseJourneyScreen | null> {
  const { phase, lifecycle, mode, deposit } = props;
  const ar = props.locale === 'ar';
  const sale = mode === 'sale';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const current = leaseJourneyStageIndex(phase);
  const contractWord = sale ? t('عقد البيع', 'sale contract') : t('عقد الإيجار', 'lease');
  const requirements = lifecycle.requirements;

  const docsReturn = lifecycle.bookingDocsReturn;
  const docsReturnOpen = Boolean(docsReturn);

  const booking: LeaseJourneyScreen =
    phase === 'awaiting_terms_signature'
      ? {
          headline: docsReturnOpen
            ? t('أعد المالك مستندات حجزك للتعديل 📎', 'The owner asked you to fix booking documents 📎')
            : t('خطوة صغيرة تفصلك عن حجزك 🖊️', 'One small step to secure it 🖊️'),
          body: docsReturnOpen
            ? t(
                `العربون ${deposit} محفوظ. راجع قائمة المستندات أدناه — عدّل المطلوب فقط؛ المعتمدة مقفلة — ثم وقّع اتفاقية الحجز من جديد.`,
                `Your ${deposit} deposit is kept. Review the document list below — fix only what was returned; approved ones stay locked — then e-sign again.`,
              )
            : t(
                `استلمنا العربون ${deposit} بأمان. بقي أن توقّع اتفاقية الحجز إلكترونياً مع صورة هويتك — دقيقتان لا أكثر، ثم نرسل حجزك للمالك.`,
                `We safely received your ${deposit} deposit. Just e-sign the booking agreement with your ID — two minutes — and we send it to the owner.`,
              ),
          scene: 'send',
          sceneStatus: docsReturnOpen
            ? t('بانتظار تعديل المستندات والتوقيع', 'Awaiting document fixes & signature')
            : t('بانتظار توقيعك', 'Awaiting your signature'),
          action: 'sign_terms',
        }
      : {
          headline: t('تم الحجز بنجاح 🎉', 'Booked successfully 🎉'),
          body: t(
            `استلمنا العربون ${deposit} ووقّعتَ اتفاقية الحجز إلكترونياً. ${sale ? 'العقار' : 'الوحدة'} محجوزة باسمك الآن، ولن يحجزها أحد غيرك.`,
            `We received your ${deposit} deposit and you e-signed the booking agreement. It is now reserved in your name only.`,
          ),
          scene: 'send',
          sceneDone: true,
          sceneStatus: t('تم الحجز', 'Booked'),
          action: 'view_terms',
        };

  const approval: LeaseJourneyScreen | null =
    current < 1
      ? null
      : phase === 'awaiting_payment_review'
        ? {
            headline: t('نتحقق من وصول العربون 🔎', 'Checking your deposit arrived 🔎'),
            body: t(
              `أبلغتنا قناة الدفع بنجاح دفع العربون ${deposit}، ويتحقق المالك الآن من وصول المبلغ. بعد التأكيد مباشرة ينتقل حجزك إلى الاعتماد.`,
              `The payment channel reported your ${deposit} deposit as paid and the owner is confirming it arrived. Your booking moves on to approval right after.`,
            ),
            scene: 'desk',
            sceneStatus: t('التحقق من الدفع', 'Payment check'),
          }
        : lifecycle.approvedAutomatically
          ? {
              headline: t(
                'اعتُمد حجزك إلكترونياً ✅',
                'Your booking was approved electronically ✅',
              ),
              body: t(
                `اعتمد النظام حجزك إلكترونياً نيابةً عن المالك${lifecycle.approvedAt ? ` في ${journeyStamp(lifecycle.approvedAt, ar)}` : ''} فور اكتمال الدفع والتوقيع. الخطوة التالية أن يُعدّ المالك ${contractWord}.`,
                `The system approved your booking for the owner${lifecycle.approvedAt ? ` on ${journeyStamp(lifecycle.approvedAt, ar)}` : ''} as soon as payment and signature were complete. Next, the owner prepares your ${contractWord}.`,
              ),
              scene: 'desk',
              sceneDone: true,
              sceneStatus: t('معتمد إلكترونياً', 'Approved electronically'),
            }
          : phase === 'awaiting_owner_approval'
            ? {
                headline: t(
                  'حجزك على مكتب المالك الآن ☕',
                  'Your booking is on the owner’s desk ☕',
                ),
                body: t(
                  'أرسلنا حجزك إلى المالك ليعتمده. عادةً لا يطول الأمر — وسيتغيّر هذا المشهد فور الاعتماد، فعُد إلى هذه الصفحة متى شئت.',
                  'We sent your booking to the owner for approval. It rarely takes long — this scene changes the moment they approve.',
                ),
                scene: 'desk',
                sceneStatus: t('قيد المراجعة', 'Under review'),
              }
            : {
                headline: t(
                  'مبروك! المالك اعتمد حجزك ✅',
                  'Congratulations! The owner approved ✅',
                ),
                body: t(
                  `اعتمد المالك حجزك${lifecycle.approvedAt ? ` في ${journeyStamp(lifecycle.approvedAt, ar)}` : ''}. حجزك الآن معتمد، والخطوة التالية أن يُعدّ المالك ${contractWord}.`,
                  `The owner approved your booking${lifecycle.approvedAt ? ` on ${journeyStamp(lifecycle.approvedAt, ar)}` : ''}. Next, the owner prepares your ${contractWord}.`,
                ),
                scene: 'desk',
                sceneDone: true,
                sceneStatus: t('معتمد', 'Approved'),
              };

  let documents: LeaseJourneyScreen | null = null;
  if (current >= 2) {
    if (phase === 'awaiting_contract_draft') {
      documents = {
        headline: t('المالك يجهّز عقدك الآن 📝', 'The owner is preparing your contract 📝'),
        body: t(
          `حجزك معتمد وفي انتظار قيام المالك بعمل ${contractWord}. سيحدد المالك المستندات اللازمة، وستظهر لك هنا لترفعها بلمسة.`,
          `Your booking is approved and waiting for the owner to draw up the ${contractWord}. Any documents needed will appear here.`,
        ),
        scene: 'contract',
        sceneStatus: t('قيد الإعداد', 'Being prepared'),
      };
    } else if (phase === 'awaiting_documents') {
      const rejected = requirements.some((item) => item.status === 'rejected');
      documents = {
        headline: rejected
          ? t('مستند يحتاج نسخة أوضح 🔁', 'One document needs a clearer copy 🔁')
          : t(
              'المالك اعتمد حجزك — ارفع المستندات والشيكات 📎',
              'Owner approved — upload documents and cheques 📎',
            ),
        body: rejected
          ? t(
              'راجع المالك ما أرسلت وطلب بديلاً لمستند — ستجد السبب بجانبه. أعد رفعه وسنُبلغ المالك فوراً.',
              'The owner asked for a replacement — the reason is next to it. Upload again and we tell the owner right away.',
            )
          : t(
              `المالك اعتمد حجزك. ليكتمل ${contractWord}: أكّد بياناتك، ارفع المستندات المطلوبة${lifecycle.cheques?.length ? '، وأدخل رقم كل شيك مع صورة الشيك' : ''}. يمكنك معاينة الملف وضبط صورة الشيك قبل الإرسال.`,
              `The owner approved your booking. To complete the ${contractWord}: confirm your details, upload the required documents${lifecycle.cheques?.length ? ', and enter each cheque number with its photo' : ''}. You can preview files and adjust cheque photos before sending.`,
            ),
        action: 'documents',
      };
    } else if (phase === 'awaiting_documents_review') {
      documents = {
        headline: t('وصلت مستنداتك، والمالك يراجعها 🔍', 'Documents received — under review 🔍'),
        body: t(
          'شكراً لك! أرسلت كل المستندات المطلوبة، وهي الآن قيد مراجعة المالك. إن احتاج أي تعديل ستجده هنا.',
          'Thank you! Everything requested is in and the owner is reviewing it.',
        ),
        action: 'documents',
      };
    } else if (requirements.some((item) => item.autoApproved)) {
      documents = {
        headline: t('قُبلت مستنداتك إلكترونياً 👌', 'Documents accepted electronically 👌'),
        body: t(
          'قبل النظام مستنداتك إلكترونياً فور اكتمالها، وسيتحقق الفريق منها. إن تبيّن أن أي مستند يخالف الاشتراطات أو غير ملائم يُلغى الحجز مباشرة.',
          'The system accepted your documents as soon as they were complete, and the team will verify them. If any breaks the requirements or is unsuitable, the booking is cancelled at once.',
        ),
        action: 'documents',
      };
    } else {
      documents = {
        headline: t('مستنداتك مكتملة ومقبولة 👌', 'Documents complete and accepted 👌'),
        body: requirements.length
          ? t('قبل المالك كل مستنداتك. أحسنت!', 'The owner accepted all your documents. Well done!')
          : t('لم يطلب المالك مستندات إضافية.', 'The owner did not need extra documents.'),
        action: requirements.length ? 'documents' : undefined,
      };
    }
  }

  let contract: LeaseJourneyScreen | null = null;
  if (current >= 3) {
    if (phase === 'awaiting_contract_approval') {
      contract = {
        headline: t('العقد في مرحلة الاعتماد ✍️', 'Your contract is being approved ✍️'),
        body: t(
          `مستنداتك مقبولة، والمالك يضع اللمسات الأخيرة على ${contractWord} ليعتمده. سيصلك هنا للتوقيع فور اعتماده.`,
          `Your documents are accepted and the owner is finalising the ${contractWord}. It comes here for your signature once approved.`,
        ),
        scene: 'contract',
        sceneStatus: t('بانتظار اعتماد المالك', 'Awaiting owner approval'),
      };
    } else if (phase === 'awaiting_tenant_signature') {
      contract = {
        headline: t('عقدك جاهز وينتظر توقيعك ✨', 'Your contract is ready for your signature ✨'),
        body: lifecycle.contract?.automatic
          ? t(
              `اعتمد النظام ${contractWord} ${lifecycle.contract.reference} إلكترونياً نيابةً عن المالك ووُقّع باسمه. اقرأه بتمعّن، ثم وقّع بإصبعك — وبتوقيعك يصبح العقد موقّعاً إلكترونياً من الطرفين.`,
              `The system approved ${lifecycle.contract.reference} electronically for the owner and signed it in their name. Read it carefully, then sign with your finger.`,
            )
          : t(
              `اعتمد المالك ${contractWord} ${lifecycle.contract?.reference ?? ''} ووقّعه. اقرأه بتمعّن، ثم وقّع بإصبعك — وبتوقيعك يصبح العقد موقّعاً إلكترونياً من الطرفين.`,
              `The owner approved and signed ${lifecycle.contract?.reference ?? 'the contract'}. Read it carefully, then sign with your finger — it becomes signed by both parties.`,
            ),
        scene: 'contract',
        sceneStatus: t('بانتظار توقيع الطرف الثاني', 'Awaiting second-party signature'),
        action: 'sign_contract',
      };
    } else {
      contract = {
        headline: t(
          'عقدك موقّع إلكترونياً من الطرفين 🤝',
          'Signed electronically by both parties 🤝',
        ),
        body: t(
          `وقّعتَ ${contractWord} ${lifecycle.contract?.reference ?? ''}${lifecycle.tenantSignedAt ? ` في ${journeyStamp(lifecycle.tenantSignedAt, ar)}` : ''}، وأصبح نافذاً وموقّعاً من الطرفين. احتفظ به دائماً في متناول يدك.`,
          `You signed ${lifecycle.contract?.reference ?? 'the contract'}; it is now in force and signed by both parties.`,
        ),
        scene: 'contract',
        sceneDone: true,
        sceneStatus: t('موقّع من الطرفين', 'Signed by both parties'),
        action: 'view_contract',
      };
    }
  }

  let handover: LeaseJourneyScreen | null = null;
  if (current >= 4) {
    handover = lifecycle.handover
      ? {
          headline: sale
            ? t('مبروك تملّك عقارك الجديد 🏡', 'Congratulations on your new property 🏡')
            : t('أهلاً بك في بيتك الجديد 🏡', 'Welcome to your new home 🏡'),
          body: t(
            `تم تسليم العقار في ${journeyStamp(lifecycle.handover.on, ar)} واستلمه ${lifecycle.handover.recipientName}${lifecycle.handover.keys ? ` (${lifecycle.handover.keys})` : ''}. اطّلع على المحضر أدناه؛ يحق لك الاعتراض خلال المهلة.`,
            `Handed over on ${journeyStamp(lifecycle.handover.on, ar)} to ${lifecycle.handover.recipientName}. Review the record below; you may object within the window.`,
          ),
          guide: lifecycle.handover.notes ? [lifecycle.handover.notes] : undefined,
          scene: 'keys',
          sceneDone: true,
          sceneStatus: t('تم التسليم', 'Handed over'),
          action: 'view_contract',
        }
      : {
          headline: t('اقتربت لحظة استلام المفاتيح 🔑', 'Almost time for the keys 🔑'),
          body: t(
            'العقد موقّع من الطرفين. عند الاستلام اعرض رمز التسليم الظاهر في هذه الصفحة على المالك أو ممثله أو حارس المبنى ليمسحه؛ يُسجَّل المحضر ويصبح نافذاً دون حاجة لموافقتك، ويحق لك الاعتراض لاحقاً.',
            'The contract is signed by both parties. At handover, show the code on this page to be scanned; the record is filed and takes effect without a separate approval, and you may object afterwards.',
          ),
          guide: [
            t(
              'رمز التسليم خاص بك ويتجدد تلقائياً كل خمس دقائق؛ لا تشاركه قبل وصولك.',
              'Your handover code is personal and renews every five minutes; do not share it before you arrive.',
            ),
            t('راجع حالة العقار ودوّن أي ملاحظة.', 'Check the premises and note anything.'),
            t(
              'قراءات العدادات يُكملها المالك/الإدارة بعد التسليم.',
              'Meter readings are completed by the owner/admin after handover.',
            ),
          ],
          scene: 'handover',
          sceneStatus: t('بانتظار التسليم', 'Awaiting handover'),
          action: 'view_contract',
        };
  }

  return [booking, approval, documents, contract, handover];
}

export function leaseJourneySteps(
  props: LeaseJourneyProps,
): { label: string; state: 'done' | 'current' | 'upcoming'; detail: string | null }[] {
  const ar = props.locale === 'ar';
  const current = leaseJourneyStageIndex(props.phase);
  const labels = leaseJourneyStageLabels(props.mode === 'sale', ar);
  const details = [
    null,
    props.lifecycle.approvedAt ? journeyStamp(props.lifecycle.approvedAt, ar) : null,
    null,
    props.lifecycle.tenantSignedAt ? journeyStamp(props.lifecycle.tenantSignedAt, ar) : null,
    props.lifecycle.handover ? journeyStamp(props.lifecycle.handover.on, ar) : null,
  ];
  return labels.map((label, index) => ({
    label,
    state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
    detail: details[index] ?? null,
  }));
}

export function leaseJourneyInitialStep(phase: LeaseJourneyPhase): number {
  return Math.min(Math.max(leaseJourneyStageIndex(phase), 0), 4);
}

export function leaseJourneyReachable(props: LeaseJourneyProps): boolean[] {
  return leaseScreens(props).map((screen) => screen !== null);
}
