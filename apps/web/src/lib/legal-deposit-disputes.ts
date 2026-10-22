/** Public privacy / terms sections documenting the deposit dispute track. */

export type LegalSection = { title: string; body: string };

export function depositDisputeLegalSections(locale: 'ar' | 'en'): LegalSection[] {
  if (locale === 'ar') {
    return [
      {
        title: 'طلبات واعتراضات التأمين',
        body: 'بعد استرداد التأمين، يحق للضيف تقديم طلب أو اعتراض بشأن مبلغ التأمين مرتين فقط لكل إقامة، ولكل طلب رقم مستقل. يصل الطلب أولاً إلى المالك أو إدارة المبنى، وقد يُحال للمحاسب للتحقق. الملاحظات الداخلية بين المالك والمحاسب لا تظهر للضيف.',
      },
      {
        title: 'شكوى لإدارة العقار والتظلُّم',
        body: 'بعد استنفاد الطلبين، يقدّم الضيف شكوى لإدارة العقار. إن لم تُجب إدارة العقار خلال سبعة أيام عمل، تُحال الشكوى تلقائياً إلى إدارة الموقع. إذا ردّت الإدارة وأغلقت الشكوى، يحق للضيف تقديم تظلُّم واحد بنفس مهلة الرد (سبعة أيام عمل) وإلا يُحال تلقائياً لإدارة الموقع.',
      },
      {
        title: 'الشكوى النهائية لإدارة الموقع',
        body: 'بعد إغلاق التظلُّم من قبل المالك أو ممثليه، يحق للضيف تقديم شكوى نهائية لإدارة الموقع يشرح فيها المشكلة بالتفصيل. يرفق النظام تلقائياً الطلبات والشكاوى والتظلمات السابقة كسجل مرتّب بأرقام متسلسلة قابلة للعرض. تبتّ إدارة الموقع خلال ثلاثين يوماً تقويمياً من تاريخ الإحالة.',
      },
      {
        title: 'البيانات المستخدمة في النزاع',
        body: 'لأغراض الفصل في النزاع، قد تُعرض على إدارة الموقع بيانات الحجز ومبلغ التأمين وسجل التحويلات ونصوص الطلبات والردود العامة (دون الملاحظات الداخلية بين الموظفين). تُعالَج هذه البيانات وفق سياسة الخصوصية ولغرض حل النزاع فقط.',
      },
    ];
  }
  return [
    {
      title: 'Deposit requests and objections',
      body: 'After a deposit refund, a guest may submit at most two deposit requests or objections per stay, each with its own reference number. The request first reaches the owner or building management and may be referred to accounting. Internal staff notes between owner and accountant are never shown to the guest.',
    },
    {
      title: 'Property-management complaint and appeal',
      body: 'After those two requests, the guest may file a complaint with property management. If there is no reply within seven working days, the complaint auto-escalates to the site administration. If management replies and closes it, the guest may file one appeal with the same seven-working-day reply window, otherwise it auto-escalates to the site.',
    },
    {
      title: 'Final complaint to the site administration',
      body: 'After an appeal is closed by the owner or their representatives, the guest may file a final site complaint describing the issue in detail. The system attaches prior requests, complaints and appeals as a numbered, collapsible record. The site administration decides within thirty calendar days of escalation.',
    },
    {
      title: 'Data used in disputes',
      body: 'To resolve a dispute, the site administration may see booking and deposit details, transfer history, and guest-visible request and reply text (not internal staff notes). This data is processed under the privacy policy and only for dispute resolution.',
    },
  ];
}
