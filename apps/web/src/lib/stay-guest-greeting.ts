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
  /** Recorded check-in / check-out moment shown under the message. */
  stamp?: { label: string; at: string; notes: string | null } | undefined;
  /** Arrival / departure moment drawn as a plane landing, waiting on the runway, or taking off. */
  flight?: StayFlightMoment | undefined;
};

export type StayFlightMoment = { kind: 'landing' | 'ready' | 'takeoff'; status: string };

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
  const flight = (kind: StayFlightMoment['kind'], arText: string, enText: string) => ({
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
        flight:
          input.arrival === 'today'
            ? flight('landing', 'وصول اليوم · جاهزون للهبوط', 'Arriving today · cleared to land')
            : input.arrival === 'due'
              ? flight('landing', 'حان موعد الهبوط', 'Cleared to land')
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
        flight:
          input.departure === 'today' || input.departure === 'due'
            ? flight(
                'ready',
                'مغادرة اليوم · استعد للإقلاع',
                'Departing today · ready for take-off',
              )
            : flight('landing', 'هبطت بالسلامة', 'Landed safely'),
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
        flight: flight('takeoff', 'أقلعت · رحلة سعيدة', 'Departed · safe travels'),
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

/** Journey position: 1 = waiting on host/payment, 2 = awaiting arrival, 3 = in stay, 4 = checked out. */
export function stayJourneyCurrent(status: string): number {
  if (status === 'request_pending' || status === 'payment_pending' || status === 'payment_failed') {
    return 1;
  }
  if (status === 'checked_in') return 3;
  if (status === 'checked_out' || status === 'closed') return 4;
  return 2;
}

/**
 * One screen per journey step (submitted, host approval / payment, arrival,
 * departure), each showing how the page read at that moment. Steps not yet
 * reached are null so the guest cannot open them.
 */
export function stayJourneyScreens(
  input: GreetingInput & {
    mode?: string | undefined;
    checkOutDate?: string | null | undefined;
    checkIn?: StampText | null | undefined;
    checkOut?: StampText | null | undefined;
  },
): Array<StayGreeting | null> {
  const { status, ar } = input;
  const current = stayJourneyCurrent(status);
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
            flight: { kind: 'landing', status: ar ? 'هبطت بالسلامة' : 'Landed safely' },
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
            };
          })();

  return [submitted, approval, arrival, departure];
}

/** Step opened first: the welcome guide right after submitting, otherwise where the booking stands. */
export function stayJourneyInitialStep(status: string, welcome: boolean): number {
  const current = stayJourneyCurrent(status);
  if (current === 1 && welcome) return 0;
  return Math.min(current, 3);
}
