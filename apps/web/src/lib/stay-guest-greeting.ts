export type StayGreeting = {
  stage:
    | 'submitted'
    | 'review'
    | 'payment'
    | 'payment_failed'
    | 'confirmed'
    | 'checked_in'
    | 'checked_out'
    | 'ended';
  headline: string;
  body: string;
  guide?: string[];
  rebook?: boolean;
};

/** "ABDUL HAMID AL RAWAHI" → "Abdul Hamid Al Rawahi"; Arabic and mixed-case names stay as typed. */
export function friendlyGuestName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (trimmed !== trimmed.toUpperCase() || !/[A-Z]/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, lead: string, letter: string) => {
    return lead + letter.toUpperCase();
  });
}

/**
 * The warm note at the top of the guest's stay page; it follows the booking
 * as it moves (submitted → host review → confirmed → checked in → checked out).
 */
export function stayGuestGreeting(input: {
  status: string;
  ar: boolean;
  welcome: boolean;
  guestName?: string | null | undefined;
  checkInDate?: string | null | undefined;
  needsEsign?: boolean;
}): StayGreeting | null {
  const { status, ar, welcome, checkInDate, needsEsign } = input;
  const name = friendlyGuestName(input.guestName);
  const hi = (arText: string, enText: string) =>
    ar
      ? arText.replace('{name}', name ? ` يا ${name}` : '')
      : enText.replace('{name}', name ? `, ${name}` : '');

  const afterApproval = ar
    ? [
        'يوم الوصول نسلّمك المفاتيح، ونسجّل هنا وقت دخولك.',
        'وعند المغادرة نودّعك بابتسامة… ونترك الباب مفتوحاً لعودتك.',
      ]
    : [
        'On arrival day we hand you the keys and record your check-in time right here.',
        'And when you leave, we wave goodbye with a smile… and leave the door open for your return.',
      ];

  switch (status) {
    case 'request_pending':
      if (welcome) {
        return {
          stage: 'submitted',
          headline: hi('يا هلا ويا مرحبا{name}!', 'Welcome aboard{name}!'),
          body: ar
            ? 'وصلنا طلبك سالماً غانماً، ورحلتك معنا بدأت من هذه اللحظة. إليك الطريق خطوة بخطوة، بلا مفاجآت… إلا السارّة منها:'
            : 'Your request landed safely, and your trip with us starts right now. Here is the road ahead, step by step — no surprises, except the nice kind:',
          guide: [
            ...(ar
              ? [
                  'المالك أو من ينوب عنه يراجع طلبك ويدقّقه، وعادةً لا يطول الأمر أكثر من فنجان قهوة أو اثنين.',
                  'فور الاعتماد تتحدّث هذه الصفحة وحدها، ويصلك بريد بالتأكيد.',
                ]
              : [
                  'The host (or someone on their team) reviews your request — usually no longer than a coffee or two.',
                  'The moment it is approved, this page updates by itself and a confirmation email is on its way.',
                ]),
            ...afterApproval,
          ],
        };
      }
      return {
        stage: 'review',
        headline: hi('أهلاً بعودتك{name}!', 'Welcome back{name}!'),
        body: ar
          ? 'طلبك الآن بين يدَي المالك أو ممثليه، يفحصونه ويدقّقونه بعناية من يختار ضيفاً عزيزاً. خذ راحتك واشرب قهوتك على مهل؛ هذه الصفحة ستتحدّث وحدها فور صدور القرار، فلا داعي لتحديثها كل دقيقة (نعرف أنك ستفعل على أي حال).'
          : 'Your request is now with the host or their team, being checked with the care of someone choosing a very welcome guest. Sit back and enjoy your coffee — this page updates itself the moment there is news, so no need to refresh every minute (we know you will anyway).',
      };

    case 'payment_pending':
      if (welcome) {
        return {
          stage: 'submitted',
          headline: hi('يا هلا ويا مرحبا{name}!', 'Welcome aboard{name}!'),
          body: ar
            ? 'اخترت بعناية، والتواريخ محجوزة لك مؤقتاً. إليك ما تبقّى، وهو أسهل مما تظن:'
            : 'Great choice — your dates are held for you. Here is what is left, and it is easier than you think:',
          guide: [
            ...(ar
              ? [
                  'أكمل الدفع لتثبيت تواريخك قبل انتهاء المهلة.',
                  'يصلك تأكيد الحجز والإيصال بالبريد فوراً، وتتحدّث هذه الصفحة وحدها.',
                ]
              : [
                  'Complete payment to lock in your dates before the hold runs out.',
                  'Your confirmation and receipt arrive by email instantly, and this page updates by itself.',
                ]),
            ...afterApproval,
          ],
        };
      }
      return {
        stage: 'payment',
        headline: hi('خطوة أخيرة وتكتمل الحكاية{name}!', 'One last step{name}!'),
        body: ar
          ? 'تواريخك محجوزة لك مؤقتاً، تماماً كمن وضع حقيبته على كرسي في مقهى مزدحم. أكمل الدفع لتثبيتها قبل أن يسبقك إليها غيرك.'
          : 'Your dates are on hold — like a bag left on a chair in a busy café. Complete payment to make them yours before someone else sits down.',
      };

    case 'payment_failed':
      return {
        stage: 'payment_failed',
        headline: hi(
          'لا تقلق{name}، تحدث لأمهر المسافرين!',
          'No worries{name} — it happens to the best travellers!',
        ),
        body: ar
          ? 'لم يكتمل الدفع هذه المرة. جرّب مرة أخرى قبل انتهاء المهلة، وإن عاند فجرّب بطاقة أخرى.'
          : 'The payment did not go through this time. Try again before the hold ends, and if it keeps being stubborn, try another card.',
      };

    case 'confirmed':
    case 'paid':
    case 'pre_arrival': {
      const when = checkInDate
        ? ar
          ? ` نراك يوم ${checkInDate}.`
          : ` See you on ${checkInDate}.`
        : '';
      const sign = needsEsign
        ? ar
          ? ' وقبلها، وقّع عقد الإقامة بضغطة زر من الأسفل.'
          : ' Before then, sign your stay contract with one tap below.'
        : '';
      return {
        stage: 'confirmed',
        headline: hi('أبشر{name}، اعتُمد حجزك!', 'Good news{name} — you are confirmed!'),
        body:
          (ar
            ? 'كل شيء جاهز من طرفنا، والمكان بدأ يتزيّن لاستقبالك. بقيت عليك أهم مهمة: حزم الحقائب (ولا تنسَ الشاحن!).'
            : 'Everything is ready on our side, and the place is getting dressed up for you. Your only job now: packing (and do not forget the charger!).') +
          when +
          sign,
      };
    }

    case 'checked_in':
      return {
        stage: 'checked_in',
        headline: hi(
          'حيّاك الله{name}، نوّرت المكان!',
          'Welcome in{name} — the place just got brighter!',
        ),
        body: ar
          ? 'وصلت بالسلامة، والمكان صار أجمل بوجودك. نتمنى لك إقامة ممتعة وهانئة، مليئة بالراحة والذكريات الحلوة. وإن احتجت أي شيء فنحن أقرب مما تظن. استمتع… فأيام الإجازة لا تُحسب من العمر!'
          : 'You made it safely, and the place looks better already. We wish you a relaxing, happy stay full of good memories. If you need anything, we are closer than you think. Enjoy — holiday days do not count towards your age!',
      };

    case 'checked_out':
    case 'closed':
      return {
        stage: 'checked_out',
        headline: hi('شكراً من القلب{name}!', 'Thank you from the heart{name}!'),
        body: ar
          ? 'سعدنا باستضافتك، وسيفتقدك المكان (سألناه فأكّد لنا ذلك). نتمنى أن تكون رحلتك قد امتلأت بالذكريات الجميلة، وأن نراك قريباً في حجز جديد؛ فالبيت بيتك متى شئت.'
          : 'It was a joy to host you, and the place will miss you (we asked; it confirmed). We hope you are leaving with great memories — and that we see you again soon for another stay. Our door is always open.',
        rebook: true,
      };

    case 'rejected':
      return {
        stage: 'ended',
        headline: hi('نعتذر{name}', 'We are sorry{name}'),
        body: ar
          ? 'لم يتمكن المالك من قبول طلبك هذه المرة. لا تحزن، فلدينا أماكن أخرى جميلة تنتظرك.'
          : 'The host could not accept your request this time. Do not be sad — there are other lovely places waiting for you.',
        rebook: true,
      };
    case 'cancelled':
      return {
        stage: 'ended',
        headline: ar ? 'أُلغي هذا الحجز' : 'This booking was cancelled',
        body: ar
          ? 'نأسف أن الرحلة لم تكتمل هذه المرة. الأبواب مفتوحة دائماً، ونتطلّع لاستضافتك في وقت يناسبك.'
          : 'We are sorry this trip did not happen. Our doors are always open, and we look forward to hosting you whenever suits you.',
        rebook: true,
      };
    case 'expired':
      return {
        stage: 'ended',
        headline: ar ? 'انتهت مهلة هذا الحجز' : 'This booking expired',
        body: ar
          ? 'انتهت المهلة قبل إتمام الحجز. لا بأس، يمكنك الحجز من جديد بضغطة زر.'
          : 'The hold ran out before the booking was completed. No problem — you can book again in one tap.',
        rebook: true,
      };
    case 'no_show':
      return {
        stage: 'ended',
        headline: ar ? 'افتقدناك!' : 'We missed you!',
        body: ar
          ? 'سُجّل عدم الحضور لهذا الحجز. نتمنى أن يكون كل شيء على ما يرام، ونسعد بك في زيارة قادمة.'
          : 'This booking was marked as a no-show. We hope all is well, and we would love to welcome you another time.',
        rebook: true,
      };
    default:
      return null;
  }
}
