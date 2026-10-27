/** Default contract wording; the binding details live in the contract payload snapshot. */
export const DEFAULT_CONTRACT_TEMPLATES = {
  lease_default: {
    ar: '<h1>عقد إيجار</h1><p>يُبرم هذا العقد بين المؤجر والمستأجر المذكورين في بيانات العقد لتأجير الوحدة المحددة فيه، للمدة وبالقيمة المبينتين. وتُعدّ شروط التأجير الواردة في مستند حجز الوحدة متمّمةً ومكمّلةً لهذا العقد وجزءاً لا يتجزأ منه، وقد أقرّ المستأجر بالاطّلاع عليها والالتزام بها عند توقيع مستند الحجز وهذا العقد.</p>',
    en: '<h1>Lease Agreement</h1><p>This agreement is made between the landlord and the tenant named in the contract details for the lease of the unit specified therein, for the term and at the rent stated. The rental terms in the unit booking document form an integral, complementary part of this agreement; the tenant acknowledged and agreed to be bound by them upon signing the booking document and this agreement.</p>',
  },
  sale_default: {
    ar: '<h1>عقد بيع</h1><p>يُبرم هذا العقد بين البائع والمشتري المذكورين في بيانات العقد لبيع الوحدة المحددة فيه بالثمن المتفق عليه، وتنتقل الملكية وفق الإجراءات النظامية المعمول بها.</p>',
    en: '<h1>Sale Agreement</h1><p>This agreement is made between the seller and the buyer named in the contract details for the sale of the unit specified therein at the agreed price; ownership transfers in accordance with the applicable statutory procedures.</p>',
  },
  stay_reschedule_amendment: {
    ar: '<h1>ملحق تعديل تواريخ الإقامة</h1><p>يُبرم هذا الملحق اتفاقاً على تعديل مواعيد الإقامة و/أو نوعها و/أو قيمتها المبينة في العقد الأصلي المشار إليه، ويُعد جزءاً لا يتجزأ منه ومتمّماً له. التفاصيل من وإلى، والفروقات المالية، وموافقات الطرفين مبيّنة في بيانات الملحق أدناه.</p>',
    en: '<h1>Stay Date-Change Addendum</h1><p>This addendum records the parties’ agreement to amend the stay dates and/or stay type and/or amount set out in the original contract referenced herein, and forms an integral part of that contract. The from–to particulars, any price difference, and both parties’ approvals are set out in the addendum details below.</p>',
  },
  stay_termination_addendum: {
    ar: '<h1>ملحق إلغاء العقد</h1><p>يُحرَّر هذا الملحق محضراً لإلغاء عقد الإقامة المشار إليه بعد تسجيل مغادرة الضيف من الوحدة، ويُعد جزءاً لا يتجزأ من العقد الأصلي ومتمّماً له. يبيّن تاريخ ووقت الإلغاء، وموعد المغادرة المتفق عليه، وأي تأخير في التسليم إن وُجد؛ ويترك قرار الخصم من مبلغ التأمين أو المطالبة بقيمة التأخير للمالك.</p>',
    en: '<h1>Contract Cancellation Addendum</h1><p>This addendum records the cancellation of the referenced stay contract after the guest’s check-out from the unit, and forms an integral part of the original contract. It states the cancellation date and time, the agreed check-out time, and any late return; deducting from the deposit or claiming a late fee remains the owner’s decision.</p>',
  },
} as const;

export type DefaultContractTemplateKey = keyof typeof DEFAULT_CONTRACT_TEMPLATES;

/** The other-language wording of a built-in template, when `html` is one of them verbatim. */
export function defaultTemplateCounterpart(
  html: string | null | undefined,
): { ar: string; en: string } | null {
  if (!html) return null;
  for (const pair of Object.values(DEFAULT_CONTRACT_TEMPLATES)) {
    if (pair.ar === html || pair.en === html) return pair;
  }
  return null;
}
