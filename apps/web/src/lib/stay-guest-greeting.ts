export type StayGreeting = {
  stage:
    | 'submitted'
    | 'review'
    | 'payment'
    | 'payment_failed'
    | 'confirmed'
    | 'checked_in'
    | 'checked_out'
    | 'refund'
    | 'ended';
  headline: string;
  body: string;
  guide?: string[];
  rebook?: boolean;
  /** Recorded check-in / check-out moment shown under the message. */
  stamp?: { label: string; at: string; notes: string | null } | undefined;
  /** Arrival / departure moment drawn as a car arriving and unloading, parked, or loading up and leaving. */
  trip?: StayTripMoment | undefined;
  /** Host approval drawn as the host at the desk: reading the request, or signing it. */
  desk?: StayDeskMoment | undefined;
  /** Deposit refund after check-out: request form, or where the refund stands. */
  refund?: StayRefundMoment | undefined;
};

export type StayTripMoment = { kind: 'arrive' | 'parked' | 'depart'; status: string };
export type StayDeskMoment = { signed: boolean; status: string };

/** Display-ready deposit refund state; amounts and dates already formatted. */
export type StayRefundMoment = {
  state: 'open' | 'requested' | 'approved' | 'rejected' | 'paid';
  referenceCode: string;
  deposit: string;
  amount: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  note: string | null;
  paidAt: string | null;
  paidTo: string | null;
};

const refundSettled = (refund: StayRefundMoment) =>
  refund.state === 'rejected' || refund.state === 'paid';

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
  /** Check-in day relative to today in Muscat. */
  arrival?: 'upcoming' | 'today' | 'due' | undefined;
  /** Check-out day relative to today in Muscat. */
  departure?: 'upcoming' | 'today' | 'due' | undefined;
  needsEsign?: boolean;
}): StayGreeting | null {
  const { status, ar, welcome, checkInDate, needsEsign } = input;
  const trip = (kind: StayTripMoment['kind'], arText: string, enText: string) => ({
    kind,
    status: ar ? arText : enText,
  });
  const name = friendlyGuestName(input.guestName);
  const hi = (arText: string, enText: string) =>
    ar
      ? arText.replace('{name}', name ? ` يا ${name}` : '')
      : enText.replace('{name}', name ? `, ${name}` : '');

  const afterApproval = ar
    ? [
        'يوم الوصول تستلم المفاتيح، ونسجّل هنا وقت دخولك بالدقيقة.',
        'وعند المغادرة نودّعك بابتسامة عريضة… ونُبقي الباب مفتوحاً لعودتك.',
      ]
    : [
        'On arrival day you get the keys, and we note your check-in time right here, to the minute.',
        'And when you leave, we wave you off with a big smile… and keep the door open for your return.',
      ];

  switch (status) {
    case 'request_pending':
      if (welcome) {
        return {
          stage: 'submitted',
          headline: hi('يا هلا ويا مرحبا{name}!', 'Welcome aboard{name}!'),
          body: ar
            ? 'وصلَنا طلبك، ورحلتك معنا بدأت من هذه اللحظة. إليك الطريق خطوة بخطوة، بلا مفاجآت… إلا السارّة منها:'
            : 'Your request has reached us, and your trip starts right now. Here is the road ahead, step by step — no surprises, except the nice kind:',
          guide: [
            ...(ar
              ? [
                  'يراجع المالك أو من ينوب عنه طلبك بعناية، وغالباً لا يستغرق ذلك أكثر من فنجان قهوة أو فنجانين.',
                  'فور الاعتماد تتحدّث هذه الصفحة من تلقاء نفسها، ويصلك التأكيد على بريدك.',
                ]
              : [
                  'The host (or someone on their team) looks over your request — usually no longer than a coffee or two.',
                  'The moment it is approved, this page updates by itself and the confirmation lands in your inbox.',
                ]),
            ...afterApproval,
          ],
        };
      }
      return {
        stage: 'review',
        desk: {
          signed: false,
          status: ar ? 'قيد المراجعة لدى المالك' : 'With the host for review',
        },
        headline: hi('أهلاً بك مجدداً{name}!', 'Welcome back{name}!'),
        body:
          input.arrival === 'due'
            ? ar
              ? 'ما زال طلبك بانتظار ردّ المالك أو ممثليه، مع أن تاريخ الوصول الذي اخترته قد مضى. لا تقلق؛ يمكنك تعديل التواريخ من الأسفل لتناسبك، أو انتظار ردّهم، وستتحدّث هذه الصفحة وحدها فور صدور القرار.'
              : 'Your request is still waiting for the host, even though the arrival date you picked has passed. No worries — you can change the dates below to suit you, or wait for their reply; this page updates by itself the moment they decide.'
            : input.arrival === 'today'
              ? ar
                ? 'طلبك بين يدَي المالك أو ممثليه، وموعد وصولك اليوم، فالردّ قد يصل في أي لحظة. أبقِ هذه الصفحة مفتوحة؛ فهي تتحدّث وحدها فور صدور القرار.'
                : 'Your request is with the host, and your arrival is today, so a reply could come any minute. Keep this page open — it updates by itself the moment they decide.'
              : ar
                ? 'طلبك الآن بين يدَي المالك أو ممثليه، يراجعونه ويتأكّدون من تفاصيله بعناية. خذ راحتك واستمتع بقهوتك على مهل؛ فهذه الصفحة تتحدّث وحدها فور صدور القرار، ولا حاجة إلى تحديثها كل دقيقة (مع أننا نعرف أنك ستفعل!).'
                : 'Your request is now with the host or their team, who are going over the details with care. Sit back and enjoy your coffee — this page updates itself the moment there is news, so no need to refresh every minute (though we know you will!).',
      };

    case 'payment_pending':
      if (welcome) {
        return {
          stage: 'submitted',
          headline: hi('يا هلا ويا مرحبا{name}!', 'Welcome aboard{name}!'),
          body: ar
            ? 'اختيار موفّق! تواريخك محجوزة لك مؤقتاً، وما تبقّى أسهل مما تظن:'
            : 'Great choice! Your dates are held for you, and what is left is easier than you think:',
          guide: [
            ...(ar
              ? [
                  'أكمل الدفع لتثبيت تواريخك قبل انتهاء المهلة.',
                  'يصلك تأكيد الحجز والإيصال على بريدك فوراً، وتتحدّث هذه الصفحة من تلقاء نفسها.',
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
          ? 'تواريخك محجوزة لك مؤقتاً، تماماً كمن ترك حقيبته على كرسي في مقهى مزدحم. أكمل الدفع لتثبيتها قبل أن يسبقك إليها أحد.'
          : 'Your dates are on hold — like a bag left on a chair in a busy café. Complete payment to make them yours before someone else sits down.',
      };

    case 'payment_failed':
      return {
        stage: 'payment_failed',
        headline: hi(
          'لا تقلق{name}، يحدث هذا لأمهر المسافرين!',
          'No worries{name} — it happens to the best travellers!',
        ),
        body: ar
          ? 'لم يكتمل الدفع هذه المرة. أعد المحاولة قبل انتهاء المهلة، وإن عاندتك البطاقة فجرّب بطاقة أخرى.'
          : 'The payment did not go through this time. Try again before the hold ends, and if the card keeps being stubborn, try another one.',
      };

    case 'confirmed':
    case 'paid':
    case 'pre_arrival': {
      const when =
        input.arrival === 'today'
          ? ar
            ? ' واليوم يومك! المكان جاهز لاستقبالك، ونراك بعد قليل.'
            : ' And today is the day! Everything is ready — see you very soon.'
          : input.arrival === 'due'
            ? ar
              ? ' حلّ موعد وصولك والمكان ينتظرك بفارغ الصبر؛ أبلغ المالك عند وصولك ليسلّمك المفاتيح.'
              : ' Your arrival day is here and the place can hardly wait. Let the host know when you arrive to get your keys.'
            : checkInDate
              ? ar
                ? ` موعدنا يوم ${checkInDate}.`
                : ` See you on ${checkInDate}.`
              : '';
      const sign = needsEsign
        ? ar
          ? ' وقبل ذلك، وقّع عقد الإقامة بضغطة زر من الأسفل.'
          : ' Before then, sign your stay contract with one tap below.'
        : '';
      return {
        stage: 'confirmed',
        trip:
          input.arrival === 'today'
            ? trip('arrive', 'وصول اليوم · بانتظارك', 'Arriving today · we are expecting you')
            : input.arrival === 'due'
              ? trip('arrive', 'حان موعد الوصول', 'Time to arrive')
              : undefined,
        headline: hi('أبشر{name}، اعتُمد حجزك!', 'Good news{name} — you are confirmed!'),
        body:
          (input.arrival === 'today' || input.arrival === 'due'
            ? ar
              ? 'كل شيء جاهز من جهتنا، والمكان في أبهى حلّة لاستقبالك.'
              : 'Everything is ready on our side, and the place is looking its best for you.'
            : ar
              ? 'كل شيء جاهز من جهتنا، والمكان يتهيّأ لاستقبالك. بقيت عليك المهمة الأصعب: حزم الحقائب (ولا تنسَ الشاحن!).'
              : 'Everything is ready on our side, and the place is getting ready for you. Your toughest job now: packing (and do not forget the charger!).') +
          when +
          sign,
      };
    }

    case 'checked_in':
      return {
        stage: 'checked_in',
        trip:
          input.departure === 'today' || input.departure === 'due'
            ? trip('parked', 'مغادرة اليوم · جهّز أمتعتك', 'Leaving today · time to pack')
            : trip('arrive', 'وصلت بالسلامة · الأمتعة في الداخل', 'Arrived safely · bags are in'),
        headline: hi(
          'حيّاك الله{name}، نوّرت المكان!',
          'Welcome in{name} — the place just got brighter!',
        ),
        body: ar
          ? 'وصلت بالسلامة، والمكان ازداد جمالاً بوجودك. نتمنى لك إقامة هانئة مليئة بالراحة والذكريات الحلوة، وإن احتجت أي شيء فنحن أقرب مما تظن. استمتع بكل لحظة… فأيام الإجازة لا تُحسب من العمر!'
          : 'You made it safely, and the place looks better already. We wish you a relaxing, happy stay full of good memories. If you need anything, we are closer than you think. Enjoy every moment — holiday days do not count towards your age!',
      };

    case 'checked_out':
    case 'closed':
      return {
        stage: 'checked_out',
        trip: trip('depart', 'غادرت · طريق السلامة', 'Checked out · safe drive home'),
        headline: hi('شكراً من القلب{name}!', 'Thank you from the heart{name}!'),
        body: ar
          ? 'سعدنا باستضافتك، وسيفتقدك المكان (سألناه فأكّد لنا ذلك!). نرجو أن تكون رحلتك قد امتلأت بالذكريات الجميلة، وأن نراك قريباً في حجز جديد؛ فالبيت بيتك متى شئت.'
          : 'It was a joy to host you, and the place will miss you (we asked; it confirmed!). We hope you are leaving with great memories — and that we see you again soon. Our door is always open.',
        rebook: true,
      };

    case 'rejected':
      return {
        stage: 'ended',
        headline: hi('نعتذر منك{name}', 'We are sorry{name}'),
        body: ar
          ? 'لم يتمكن المالك من قبول طلبك هذه المرة، ولا داعي للحزن؛ فأماكن جميلة أخرى بانتظارك، وقد يكون أجملها على بُعد نقرة واحدة.'
          : 'The host could not accept your request this time — but no need to be sad: other lovely places are waiting, and the best one may be a single tap away.',
        rebook: true,
      };
    case 'cancelled':
      return {
        stage: 'ended',
        headline: ar ? 'أُلغي هذا الحجز' : 'This booking was cancelled',
        body: ar
          ? 'يؤسفنا أن الرحلة لم تكتمل هذه المرة، لكن أبوابنا مفتوحة دائماً، ويسعدنا أن نستضيفك في الوقت الذي يناسبك.'
          : 'We are sorry this trip did not happen, but our doors are always open and we would love to host you whenever suits you.',
        rebook: true,
      };
    case 'expired':
      return {
        stage: 'ended',
        headline: ar ? 'انتهت مهلة هذا الحجز' : 'This booking expired',
        body: ar
          ? 'انتهت المهلة قبل إتمام الحجز. لا بأس، فالفرص لا تنتهي؛ يمكنك الحجز من جديد بضغطة زر.'
          : 'The hold ran out before the booking was completed. No problem — chances never run out; you can book again in one tap.',
        rebook: true,
      };
    case 'no_show':
      return {
        stage: 'ended',
        headline: ar ? 'افتقدناك!' : 'We missed you!',
        body: ar
          ? 'سُجّل عدم حضورك في هذا الحجز. نرجو أن يكون المانع خيراً، ويسعدنا أن نستقبلك في زيارة قادمة.'
          : 'This booking was marked as a no-show. We hope all is well, and we would love to welcome you another time.',
        rebook: true,
      };
    default:
      return null;
  }
}

type GreetingInput = Parameters<typeof stayGuestGreeting>[0];
type StampText = { at: string; notes: string | null };

/**
 * Journey position: 1 = waiting on host/payment, 2 = awaiting arrival, 3 = in stay,
 * 4 = checked out (with a deposit: the refund step is open), 5 = deposit refund settled.
 */
export function stayJourneyCurrent(status: string, refund?: StayRefundMoment): number {
  if (status === 'request_pending' || status === 'payment_pending' || status === 'payment_failed') {
    return 1;
  }
  if (status === 'checked_in') return 3;
  if (status === 'checked_out' || status === 'closed') {
    return refund && (status === 'closed' || refundSettled(refund)) ? 5 : 4;
  }
  return 2;
}

function refundScreen(
  refund: StayRefundMoment,
  ar: boolean,
  hi: (arText: string, enText: string) => string,
): StayGreeting {
  const amount = refund.amount ?? refund.deposit;
  switch (refund.state) {
    case 'open':
      return {
        stage: 'refund',
        refund,
        headline: hi('بقي تأمينك{name}', 'Your deposit is next{name}'),
        body: ar
          ? `غادرت بالسلامة، وبقيت خطوة أخيرة: استرداد مبلغ التأمين (${refund.deposit}). اطلبه الآن وأخبرنا أين نحوّله؛ يراجعه المالك ثم يحوّله المحاسب، وتتابع كل خطوة من هنا.`
          : `You left safely, and one last step remains: getting your deposit (${refund.deposit}) back. Ask for it now and tell us where to send it; the host reviews it, the accountant transfers it, and you follow every step right here.`,
      };
    case 'requested':
      return {
        stage: 'refund',
        refund,
        headline: hi('وصلنا طلبك{name}', 'Request received{name}'),
        body: ar
          ? `طلب استرداد التأمين (${refund.deposit}) بين يدَي المالك الآن لمراجعته، وقد يستغرق من يوم عمل واحد حتى أسبوعَي عمل بحسب أولوية الطلبات السابقة. سيصلك إشعار عند القبول أو الرفض وعند تحويل المبلغ.`
          : `Your deposit refund request (${refund.deposit}) is with the host for review; it may take from one working day up to two working weeks, depending on earlier requests. You will be notified when it is approved or declined and when the money is transferred.`,
      };
    case 'approved':
      return {
        stage: 'refund',
        refund,
        headline: hi('وافق المالك على الاسترداد{name}!', 'The host approved your refund{name}!'),
        body: ar
          ? `اعتُمد استرداد ${amount}، والطلب الآن لدى المحاسب لتحويل المبلغ إليك. قيد الإجراء… وسيظهر هنا تاريخ التحويل فور إتمامه.`
          : `${amount} was approved and is now with the accountant for the transfer. In progress… the transfer date will show here as soon as it is done.`,
      };
    case 'rejected':
      return {
        stage: 'refund',
        refund,
        rebook: true,
        headline: hi('نعتذر منك{name}', 'We are sorry{name}'),
        body: ar
          ? 'لم يعتمد المالك استرداد مبلغ التأمين. تجد سبب الرفض أدناه، ويسعدنا التواصل معك لأي استفسار.'
          : 'The host did not approve the deposit refund. You will find the reason below; we are happy to help with any question.',
      };
    case 'paid':
      return {
        stage: 'refund',
        refund,
        rebook: true,
        headline: hi('وصل تأمينك{name}!', 'Your deposit is on its way{name}!'),
        body: ar
          ? `حُوّل مبلغ ${amount}${refund.paidTo ? ` إلى ${refund.paidTo}` : ''}${refund.paidAt ? ` بتاريخ ${refund.paidAt}` : ''}. شكراً لأنك تركت المكان كما وجدته… وأجمل!`
          : `${amount} was transferred${refund.paidTo ? ` to ${refund.paidTo}` : ''}${refund.paidAt ? ` on ${refund.paidAt}` : ''}. Thank you for leaving the place as you found it… or nicer!`,
      };
  }
}

/**
 * One screen per journey step (submitted, host approval / payment, arrival,
 * departure, and deposit refund when the stay holds a deposit), each showing how
 * the page read at that moment. Steps not yet reached are null so the guest
 * cannot open them.
 */
export function stayJourneyScreens(
  input: GreetingInput & {
    mode?: string | undefined;
    checkOutDate?: string | null | undefined;
    checkIn?: StampText | null | undefined;
    checkOut?: StampText | null | undefined;
    refund?: StayRefundMoment | undefined;
  },
): Array<StayGreeting | null> {
  const { status, ar } = input;
  const current = stayJourneyCurrent(status, input.refund);
  const request = input.mode === 'request' || status === 'request_pending';
  const name = friendlyGuestName(input.guestName);
  const hi = (arText: string, enText: string) =>
    ar
      ? arText.replace('{name}', name ? ` يا ${name}` : '')
      : enText.replace('{name}', name ? `, ${name}` : '');
  const live = (overrides: Partial<GreetingInput>) => stayGuestGreeting({ ...input, ...overrides });

  const submitted = live({
    status: request ? 'request_pending' : 'payment_pending',
    welcome: true,
  });

  const approval: StayGreeting | null =
    current === 1
      ? live({ welcome: false })
      : request
        ? {
            stage: 'confirmed',
            desk: {
              signed: true,
              status: ar ? 'وُقّع الطلب واعتُمد' : 'Request signed & approved',
            },
            headline: hi('تمّت الموافقة{name}!', 'Approved{name}!'),
            body: ar
              ? 'راجع المالك طلبك ووافق عليه بكل سرور، فأصبح حجزك مؤكَّداً رسمياً. (أما نحن فصفّقنا خلف الشاشة!)'
              : 'The host reviewed your request and happily said yes — your stay is officially confirmed. (We clapped behind the screen!)',
          }
        : {
            stage: 'confirmed',
            headline: hi('اكتمل الدفع{name}!', 'Payment complete{name}!'),
            body: ar
              ? 'وصلنا مبلغك بأمان، وثُبّتت التواريخ باسمك. لم يبقَ إلا العدّ التنازلي!'
              : 'Your payment arrived safely and the dates are yours. Only the countdown is left!',
          };

  const arrival: StayGreeting | null =
    current < 2
      ? null
      : current === 2
        ? live({})
        : {
            stage: 'checked_in',
            trip: { kind: 'arrive', status: ar ? 'وصلت بالسلامة' : 'Arrived safely' },
            headline: hi('وصلت بالسلامة{name}!', 'You made it{name}!'),
            body: ar
              ? 'من هنا بدأت الحكاية: استلمت المفاتيح، وانفتح الباب على أيام من الراحة.'
              : 'This is where the story began: keys in hand, door open to days of rest.',
            stamp: input.checkIn
              ? { label: ar ? 'وقت الدخول والاستلام' : 'Checked in at', ...input.checkIn }
              : undefined,
          };

  const departure: StayGreeting | null =
    current < 3
      ? null
      : current === 3
        ? (() => {
            const inStay = live({});
            if (!inStay || !input.checkOutDate) return inStay;
            return {
              ...inStay,
              body:
                inStay.body +
                (ar
                  ? ` موعد المغادرة يوم ${input.checkOutDate}، فلا داعي للعجلة… فقط تفقّد الأدراج قبل أن تخرج، فالشواحن تهوى الاختباء!`
                  : ` Check-out is on ${input.checkOutDate} — no rush… just check the drawers before you go; chargers love to hide!`),
            };
          })()
        : (() => {
            const farewell = live({});
            if (!farewell) return null;
            return {
              ...farewell,
              stamp: input.checkOut
                ? { label: ar ? 'وقت المغادرة' : 'Checked out at', ...input.checkOut }
                : undefined,
              ...(input.refund ? { rebook: false } : {}),
            };
          })();

  if (!input.refund) return [submitted, approval, arrival, departure];
  const refund = current < 4 ? null : refundScreen(input.refund, ar, hi);
  return [submitted, approval, arrival, departure, refund];
}

/** Step opened first: the welcome guide right after submitting, otherwise where the booking stands. */
export function stayJourneyInitialStep(
  status: string,
  welcome: boolean,
  refund?: StayRefundMoment,
): number {
  const current = stayJourneyCurrent(status, refund);
  if (current === 1 && welcome) return 0;
  return Math.min(current, refund ? 4 : 3);
}
