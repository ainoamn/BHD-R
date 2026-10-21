/** Default contract wording; the binding details live in the contract payload snapshot. */
export const DEFAULT_CONTRACT_TEMPLATES = {
  lease_default: {
    ar: '<h1>عقد إيجار</h1><p>يُبرم هذا العقد بين المؤجر والمستأجر المذكورين في بيانات العقد لتأجير الوحدة المحددة فيه، للمدة وبالقيمة المبينتين، ويخضع للشروط والأحكام المعتمدة للعقار التي وافق عليها المستأجر.</p>',
    en: '<h1>Lease Agreement</h1><p>This agreement is made between the landlord and the tenant named in the contract details for the lease of the unit specified therein, for the term and at the rent stated, and is subject to the approved terms and conditions of the property accepted by the tenant.</p>',
  },
  sale_default: {
    ar: '<h1>عقد بيع</h1><p>يُبرم هذا العقد بين البائع والمشتري المذكورين في بيانات العقد لبيع الوحدة المحددة فيه بالثمن المتفق عليه، وتنتقل الملكية وفق الإجراءات النظامية المعمول بها.</p>',
    en: '<h1>Sale Agreement</h1><p>This agreement is made between the seller and the buyer named in the contract details for the sale of the unit specified therein at the agreed price; ownership transfers in accordance with the applicable statutory procedures.</p>',
  },
  stay_reschedule_amendment: {
    ar: '<h1>ملحق تعديل تواريخ الإقامة</h1><p>يُبرم هذا الملحق اتفاقاً على تعديل مواعيد الإقامة و/أو نوعها و/أو قيمتها المبينة في العقد الأصلي المشار إليه، ويُعد جزءاً لا يتجزأ منه ومتمّماً له. التفاصيل من وإلى، والفروقات المالية، وموافقات الطرفين مبيّنة في بيانات الملحق أدناه.</p>',
    en: '<h1>Stay Date-Change Addendum</h1><p>This addendum records the parties’ agreement to amend the stay dates and/or stay type and/or amount set out in the original contract referenced herein, and forms an integral part of that contract. The from–to particulars, any price difference, and both parties’ approvals are set out in the addendum details below.</p>',
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
