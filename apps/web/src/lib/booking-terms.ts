export type BookingTermsMode = 'rent' | 'sale' | 'daily';

export const BOOKING_TERMS_MODES: BookingTermsMode[] = ['sale', 'rent', 'daily'];

export const BOOKING_TERMS_MAX_LINES = 60;
export const BOOKING_TERMS_MAX_BODY = 12_000;

/** What the owner saved for one property + booking type (latest active version). */
export type OwnerBookingTerms = {
  version: number;
  bodyAr: string | null;
  bodyEn: string | null;
  updatedAt: string;
};

/** Public payload for checkout: `version` 0 means platform defaults (no owner text). */
export type BookingTermsForCheckout = {
  version: number;
  ownerLinesAr: string[];
  ownerLinesEn: string[];
};

export function bookingTermsModeLabel(mode: BookingTermsMode, ar: boolean): string {
  if (mode === 'sale') return ar ? 'البيع' : 'Sale';
  if (mode === 'daily') return ar ? 'الإيجار اليومي' : 'Daily rental';
  return ar ? 'الإيجار الشهري / السنوي' : 'Monthly / yearly rental';
}

/** One clause per line; numbering or bullets typed by the owner are stripped. */
export function parseTermsBody(body: string | null | undefined): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^(?:[-•*·]+|\(?[0-9\u0660-\u0669]{1,3}[).:\-–]|[0-9\u0660-\u0669]{1,3}\s*[-–])\s*/, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, BOOKING_TERMS_MAX_LINES)
    .map((line) => line.slice(0, 600));
}

export function checkoutTermsFromOwner(terms: OwnerBookingTerms | null): BookingTermsForCheckout {
  if (!terms) return { version: 0, ownerLinesAr: [], ownerLinesEn: [] };
  return {
    version: terms.version,
    ownerLinesAr: parseTermsBody(terms.bodyAr),
    ownerLinesEn: parseTermsBody(terms.bodyEn),
  };
}

/** Owner text in the reader's language, falling back to the other language. */
export function ownerLinesFor(terms: BookingTermsForCheckout | null | undefined, ar: boolean): string[] {
  if (!terms) return [];
  const primary = ar ? terms.ownerLinesAr : terms.ownerLinesEn;
  return primary.length ? primary : ar ? terms.ownerLinesEn : terms.ownerLinesAr;
}

/** Starting template offered in the owner editor and used when the owner saved nothing. */
export function suggestedOwnerTerms(mode: BookingTermsMode, ar: boolean): string[] {
  if (mode === 'sale') {
    return ar
      ? [
          'يُحتسب العربون من ثمن البيع عند إتمام البيع وفق اتفاقية البيع النهائية.',
          'يلتزم المشتري بإتمام إجراءات البيع ونقل الملكية خلال مدة الحجز.',
          'يخضع استرداد العربون عند العدول عن الشراء لسياسة المالك وللأنظمة المعمول بها في سلطنة عُمان.',
        ]
      : [
          'The deposit is credited toward the price when the sale completes under the final sale agreement.',
          'The buyer will complete the sale and title transfer within the reservation period.',
          'Refund of the deposit if the buyer withdraws follows the owner’s policy and the laws of the Sultanate of Oman.',
        ];
  }
  if (mode === 'daily') {
    return ar
      ? [
          'يلتزم الضيف بمواعيد الوصول والمغادرة المحددة للعقار.',
          'يُمنع إقامة الحفلات أو تجاوز العدد المسموح من الضيوف دون موافقة المالك.',
          'يتحمل الضيف مسؤولية أي أضرار تلحق بالعقار أو محتوياته خلال فترة الإقامة.',
          'تخضع سياسة الإلغاء والاسترداد لما هو معلن في صفحة الإقامة.',
        ]
      : [
          'The guest will respect the property’s check-in and check-out times.',
          'Parties or exceeding the allowed number of guests require the owner’s approval.',
          'The guest is responsible for any damage to the property or its contents during the stay.',
          'Cancellation and refunds follow the policy shown on the stay page.',
        ];
  }
  return ar
    ? [
        'يُحتسب مبلغ الضمان ضمن مستحقات عقد الإيجار (التأمين أو الدفعة الأولى) عند توقيع العقد النهائي.',
        'تُحدد مدة الإيجار والدفعات في عقد الإيجار النهائي، ويخضع العقد لقانون الإيجارات المعمول به في سلطنة عُمان وتسجيله لدى الجهات المختصة.',
        'يخضع استرداد مبلغ الضمان عند عدول المستأجر لسياسة المالك.',
        'يلتزم المستأجر بالمحافظة على الوحدة واستخدامها للغرض المخصص لها.',
      ]
    : [
        'The deposit is credited toward the lease dues (security or first payment) when the final lease is signed.',
        'Lease term and payments are set in the final lease, which follows the rental law of the Sultanate of Oman and official registration.',
        'Refund of the deposit if the tenant withdraws follows the owner’s policy.',
        'The tenant will take care of the unit and use it only for its intended purpose.',
      ];
}

/** Platform clauses appended after the owner's terms — they describe how BHD R booking works. */
export function platformTerms(input: {
  mode: BookingTermsMode;
  ar: boolean;
  deposit?: string | null;
}): string[] {
  const { mode, ar, deposit } = input;
  if (mode === 'daily') {
    return ar
      ? [
          'يُعتبر الحجز مؤكداً فقط بعد إتمام الدفع بنجاح عبر المنصة.',
          'أقر بصحة بياناتي وأتعهد بإرفاق صورة البطاقة الشخصية وصورة شخصية عند توقيع العقد، ويُعد توقيعي الإلكتروني موافقة ملزمة على هذه الشروط وفق قانون المعاملات الإلكترونية.',
        ]
      : [
          'The booking is confirmed only after successful payment through the platform.',
          'I confirm my details are correct and will attach my ID card and a portrait photo when signing; my electronic signature is a binding acceptance of these terms under the Electronic Transactions Law.',
        ];
  }
  const sale = mode === 'sale';
  return ar
    ? [
        `مبلغ الضمان (العربون) المحدد من المالك${deposit ? ` هو ${deposit}، و` : ' '}يُدفع إلكترونياً لحجز ${sale ? 'العقار للشراء' : 'الوحدة للإيجار'} باسمك، وتبقى محجوزة لك 30 يوماً بعد الدفع لإتمام ${sale ? 'إجراءات البيع' : 'عقد الإيجار النهائي'}.`,
        'أقر بصحة بياناتي وأتعهد بإرفاق صورة البطاقة الشخصية (الوجه والخلف) وصورة شخصية عند توقيع العقد، ويُعد توقيعي الإلكتروني بعد الدفع موافقة ملزمة على هذه الشروط وفق قانون المعاملات الإلكترونية.',
      ]
    : [
        `The owner’s deposit${deposit ? ` of ${deposit}` : ''} is paid online to reserve this ${sale ? 'property for purchase' : 'unit for rent'} in your name; it stays reserved for 30 days after payment to complete ${sale ? 'the sale' : 'the final lease'}.`,
        'I confirm my details are correct and will attach my ID card (front and back) and a portrait photo when signing; my electronic signature after payment is a binding acceptance of these terms under the Electronic Transactions Law.',
      ];
}

/** Full list shown to the customer and printed in the contract. */
export function bookingTermsLines(input: {
  mode: BookingTermsMode;
  ar: boolean;
  deposit?: string | null;
  terms?: BookingTermsForCheckout | null;
}): string[] {
  const owner = ownerLinesFor(input.terms, input.ar);
  return [
    ...(owner.length ? owner : suggestedOwnerTerms(input.mode, input.ar)),
    ...platformTerms(input),
  ];
}
