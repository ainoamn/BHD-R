export type BookingSceneKind = 'stay' | 'details' | 'terms' | 'review' | 'payment';

export type BookingStepGreeting = {
  kind: BookingSceneKind;
  status: string;
  heading: string;
  body: string;
};

/** Placeholder names shown before the real one loads; never used to greet anyone. */
const PLACEHOLDER_NAMES = new Set(['مستخدم bhd', 'bhd user']);

/** First name for a friendly greeting ("ABDUL" → "Abdul"); empty when not known yet. */
export function greetingName(fullName: string | null | undefined): string {
  const full = fullName?.trim() ?? '';
  if (!full || PLACEHOLDER_NAMES.has(full.toLowerCase())) return '';
  const first = full.split(/\s+/)[0]!;
  return /^[A-Z]+$/.test(first) ? first[0] + first.slice(1).toLowerCase() : first;
}

/** The daily stay checkout: choose the stay, the guest's details, review, payment. */
export function stayCheckoutGreeting(
  step: 'stay' | 'guest' | 'review' | 'payment',
  { ar, title, name }: { ar: boolean; title: string; name: string },
): BookingStepGreeting {
  const place = title.trim();
  switch (step) {
    case 'stay':
      return ar
        ? {
            kind: 'stay',
            status: 'نختار أجمل الأيام',
            heading: place
              ? `أهلاً بك في ${place}! لنرتّب إقامتك على ذوقك`
              : 'أهلاً بك! لنرتّب إقامتك على ذوقك',
            body: 'اختر نوع الإقامة والتواريخ وعدد الضيوف، ونحسب لك المبلغ في الحال. أربع خطوات خفيفة وتكون المفاتيح في يدك.',
          }
        : {
            kind: 'stay',
            status: 'Picking the best days',
            heading: place
              ? `Welcome to ${place}! Let’s plan your stay`
              : 'Welcome! Let’s plan your stay',
            body: 'Choose the stay type, dates and guests and we price it instantly. Four light steps and the keys are yours.',
          };
    case 'guest':
      return ar
        ? {
            kind: 'details',
            status: 'نجهّز بطاقة الضيف',
            heading: name ? `تشرّفنا يا ${name}! عرّفنا بنفسك` : 'تشرّفنا! عرّفنا بنفسك',
            body: 'تصل بياناتك للمالك ليستقبلك كما يليق، ويصلك تأكيد الحجز على بريدك. نحفظها بأمان ولا يراها إلا من يخدم حجزك.',
          }
        : {
            kind: 'details',
            status: 'Preparing your guest card',
            heading: name ? `Lovely to meet you, ${name}!` : 'Lovely to meet you!',
            body: 'Your details reach the host so they can welcome you properly, and your confirmation comes by email. They stay safe and only those serving your booking see them.',
          };
    case 'review':
      return ar
        ? {
            kind: 'review',
            status: 'نتأكد من كل التفاصيل',
            heading: 'لحظة تدقيق قبل الانطلاق',
            body: 'راجع التفاصيل على مهل واقرأ الشروط، ويمكنك الرجوع وتعديل أي شيء قبل التأكيد. كل شيء بين يديك.',
          }
        : {
            kind: 'review',
            status: 'Checking every detail',
            heading: 'A quick check before we go',
            body: 'Take your time over the details and the terms; you can go back and change anything before confirming.',
          };
    case 'payment':
      return ar
        ? {
            kind: 'payment',
            status: 'الدفع الآمن بانتظارك',
            heading: name
              ? `حجزك محفوظ يا ${name}! بقيت خطوة واحدة`
              : 'حجزك محفوظ! بقيت خطوة واحدة',
            body: 'أكمل الدفع عبر البوابة الآمنة ليصبح حجزك مؤكداً، ويصلك الإيصال على بريدك فوراً. المكان بدأ يستعد لاستقبالك!',
          }
        : {
            kind: 'payment',
            status: 'Secure payment awaits',
            heading: name
              ? `Your booking is held, ${name}! One step left`
              : 'Your booking is held! One step left',
            body: 'Complete the secure payment to confirm, and your receipt arrives by email at once. The place is already getting ready for you!',
          };
  }
}

/** Monthly rent or purchase deposit: terms, details, review, payment. */
export function leaseCheckoutGreeting(
  step: 'terms' | 'details' | 'review' | 'payment',
  { ar, sale, name }: { ar: boolean; sale: boolean; name: string },
): BookingStepGreeting {
  const home = ar
    ? sale
      ? 'عقارك الجديد'
      : 'بيتك الجديد'
    : sale
      ? 'your new property'
      : 'your new home';
  switch (step) {
    case 'terms':
      return ar
        ? {
            kind: 'terms',
            status: 'نقرأ الشروط معاً',
            heading: name
              ? `أهلاً يا ${name}! خطوتك الأولى نحو ${home}`
              : `أهلاً بك! خطوتك الأولى نحو ${home}`,
            body: 'اقرأ الشروط والأحكام بهدوء ووافق عليها؛ فهي ما يحفظ حقك وحق المالك من أول يوم.',
          }
        : {
            kind: 'terms',
            status: 'Reading the terms together',
            heading: name
              ? `Welcome, ${name}! Your first step to ${home}`
              : `Welcome! Your first step to ${home}`,
            body: 'Read the terms calmly and accept them; they protect you and the owner from day one.',
          };
    case 'details':
      return ar
        ? {
            kind: 'details',
            status: 'نجهّز بياناتك للعقد',
            heading: name ? `تشرّفنا يا ${name}! عرّفنا بنفسك` : 'تشرّفنا! عرّفنا بنفسك',
            body: 'نحتاج بياناتك ليتواصل معك المالك ويصدر العقد باسمك. نحفظها بأمان ولا يراها إلا من يخدم حجزك.',
          }
        : {
            kind: 'details',
            status: 'Preparing your details',
            heading: name ? `Lovely to meet you, ${name}!` : 'Lovely to meet you!',
            body: 'We need your details so the owner can reach you and the contract is issued in your name. They stay safe and only those serving your booking see them.',
          };
    case 'review':
      return ar
        ? {
            kind: 'review',
            status: 'نتأكد من كل التفاصيل',
            heading: 'لحظة تدقيق قبل الانطلاق',
            body: 'راجع بياناتك ومبلغ الضمان على مهل، ويمكنك الرجوع وتعديل أي شيء قبل إنشاء الحجز.',
          }
        : {
            kind: 'review',
            status: 'Checking every detail',
            heading: 'A quick check before we go',
            body: 'Take your time over your details and the deposit; you can go back and change anything before booking.',
          };
    case 'payment':
      return ar
        ? {
            kind: 'payment',
            status: 'الدفع الآمن بانتظارك',
            heading: name ? `مبروك يا ${name}! بقي دفع مبلغ الضمان` : 'مبروك! بقي دفع مبلغ الضمان',
            body: `ادفع الضمان عبر البوابة الآمنة ليُحجز ${home} باسمك، ثم توقّع العقد وترفق مستنداتك إلكترونياً. نحن معك حتى تستلم المفاتيح.`,
          }
        : {
            kind: 'payment',
            status: 'Secure payment awaits',
            heading: name
              ? `Congratulations, ${name}! Just the deposit left`
              : 'Congratulations! Just the deposit left',
            body: `Pay the deposit through the secure gateway to hold ${home} in your name, then sign the contract and attach your documents online. We are with you until you get the keys.`,
          };
  }
}
