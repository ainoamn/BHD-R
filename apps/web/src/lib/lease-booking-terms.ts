export type LeaseBookingTermsInput = {
  mode: 'rent' | 'sale';
  ar: boolean;
  deposit: string;
  price: string | null;
};

/** Booking terms shown before payment and repeated in the signed contract. */
export function leaseBookingTerms({ mode, ar, deposit, price }: LeaseBookingTermsInput): string[] {
  if (mode === 'sale') {
    return ar
      ? [
          `مبلغ الضمان (العربون) المحدد من مالك العقار هو ${deposit}، ويُدفع إلكترونياً لحجز العقار للشراء باسمك.`,
          'بعد إتمام الدفع تبقى الوحدة محجوزة لك لمدة 30 يوماً لإتمام إجراءات البيع ونقل الملكية، ولا تُعرض لمشترين آخرين خلال هذه المدة.',
          price
            ? `سعر البيع المعلن ${price}، ويُحتسب العربون من الثمن عند إتمام البيع وفق اتفاقية البيع النهائية.`
            : 'يُحدد سعر البيع النهائي في اتفاقية البيع، ويُحتسب العربون من الثمن عند إتمام البيع.',
          'يخضع استرداد العربون عند العدول عن الشراء لسياسة المالك المعلنة وللأنظمة المعمول بها في سلطنة عُمان.',
          'أقر بصحة البيانات التي أدخلتها، وأتعهد بإرفاق صورة البطاقة الشخصية (الوجه والخلف) وصورة شخصية عند توقيع العقد.',
          'يُعد توقيعي الإلكتروني بعد الدفع موافقة ملزمة على هذه الشروط وفق قانون المعاملات الإلكترونية.',
        ]
      : [
          `Deposit set by the owner: ${deposit}, paid online to reserve this property for purchase in your name.`,
          'After payment the unit stays reserved for you for 30 days to complete the sale and title transfer, and is not offered to other buyers meanwhile.',
          price
            ? `Listed sale price: ${price}. The deposit is credited toward the price when the sale completes under the final sale agreement.`
            : 'The final price is set in the sale agreement; the deposit is credited toward it when the sale completes.',
          'Refund of the deposit if you withdraw follows the owner’s stated policy and the laws of the Sultanate of Oman.',
          'I confirm the details I entered are correct and will attach my ID card (front and back) and a portrait photo when signing.',
          'My electronic signature after payment is a binding acceptance of these terms under the Electronic Transactions Law.',
        ];
  }
  return ar
    ? [
        `مبلغ الضمان (العربون) المحدد من مالك العقار هو ${deposit}، ويُدفع إلكترونياً لحجز الوحدة للإيجار باسمك.`,
        'بعد إتمام الدفع تبقى الوحدة محجوزة لك لمدة 30 يوماً لإتمام عقد الإيجار النهائي مع المالك، ولا تُعرض لمستأجرين آخرين خلال هذه المدة.',
        price
          ? `الإيجار الشهري المعلن ${price}، ويُحتسب مبلغ الضمان ضمن مستحقات عقد الإيجار عند إتمامه.`
          : 'تُحدد قيمة الإيجار في عقد الإيجار النهائي، ويُحتسب مبلغ الضمان ضمن مستحقاته عند إتمامه.',
        'يخضع عقد الإيجار النهائي لقانون الإيجارات المعمول به في سلطنة عُمان وتسجيله لدى الجهات المختصة، ويخضع استرداد مبلغ الضمان عند العدول لسياسة المالك المعلنة.',
        'أقر بصحة البيانات التي أدخلتها، وأتعهد بإرفاق صورة البطاقة الشخصية (الوجه والخلف) وصورة شخصية عند توقيع العقد.',
        'يُعد توقيعي الإلكتروني بعد الدفع موافقة ملزمة على هذه الشروط وفق قانون المعاملات الإلكترونية.',
      ]
    : [
        `Deposit set by the owner: ${deposit}, paid online to reserve this unit for rent in your name.`,
        'After payment the unit stays reserved for you for 30 days to sign the final lease with the owner, and is not offered to other tenants meanwhile.',
        price
          ? `Listed monthly rent: ${price}. The deposit is credited toward the lease dues when the lease is signed.`
          : 'Rent is set in the final lease; the deposit is credited toward its dues when signed.',
        'The final lease follows the rental law of the Sultanate of Oman and official registration; refund of the deposit if you withdraw follows the owner’s stated policy.',
        'I confirm the details I entered are correct and will attach my ID card (front and back) and a portrait photo when signing.',
        'My electronic signature after payment is a binding acceptance of these terms under the Electronic Transactions Law.',
      ];
}
