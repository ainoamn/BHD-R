/**
 * Mandatory notice on every electronically completed renewal addendum:
 * system e-sign without human intervention, admin document review, and
 * tenant liability if documents do not match.
 */

export const ELECTRONIC_RENEWAL_NOTICE_VERSION = 'bhd-r-electronic-renewal-v1';

export const ELECTRONIC_RENEWAL_NOTICE = {
  version: ELECTRONIC_RENEWAL_NOTICE_VERSION,
  titleAr: 'توثيق إلكتروني آلي',
  titleEn: 'Automated electronic documentation',
  bodyAr:
    'وُقِّع هذا الملحق إلكترونياً بواسطة نظام BHD R دون تدخل بشري في لحظة التوثيق. تراجع الإدارة المستندات المرفقة؛ وإذا تبيّن اختلافها أو عدم صحتها يحق للإدارة إلغاء الملحق والطلب، ويتحمل المستأجر كامل المسؤولية الإدارية والقانونية عن ذلك.',
  bodyEn:
    'This addendum was electronically signed by the BHD R system without human intervention at the moment of documentation. Management will verify the attached documents; if they differ or are inaccurate, management may cancel the addendum and request, and the tenant bears full administrative and legal responsibility.',
  consentAr:
    'أقر بأنني اطلعت على الملحق والمستندات المطلوبة، وأوافق على التوقيع الإلكتروني الآلي، وأتحمل المسؤولية إن اختلفت المستندات عن الواقع، بما في ذلك حق الإدارة في إلغاء الملحق.',
  consentEn:
    'I confirm I reviewed the addendum and required documents, consent to automated electronic signature, and accept liability if the documents differ from reality, including management’s right to cancel the addendum.',
} as const;

export type ElectronicRenewalDocumentation = {
  noticeVersion: string;
  signedBySystem: true;
  humanIntervention: false;
  docsPendingAdminReview: boolean;
  completedAt: string;
  tenantConsentAt: string;
};
