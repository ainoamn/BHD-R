import type { AccountingHubTab } from '@/lib/accounting-gl';

/** Bilingual copy for the owner accounting hub (Arabic primary, English secondary). */
export function accountingHubCopy(locale: 'ar' | 'en') {
  const ar = locale === 'ar';
  return {
    ar,
    eyebrow: ar ? 'دفتر الأستاذ العقاري' : 'Property general ledger',
    title: ar ? 'نظام المحاسبة' : 'Accounting system',
    subtitle: ar
      ? 'قيد مزدوج، مستندات مصدر، تتبع كامل للمعاملات، وتقارير قابلة لإعادة الإنتاج — وفق معايير المحاسبة الدولية.'
      : 'Double-entry, source documents, full transaction trails, and reproducible reports — IFRS-ready property GL.',
    sync: ar ? 'مزامنة المدفوعات' : 'Sync payments',
    hisaby: ar ? 'حسابي' : 'Hisaby',
    warming: ar ? 'تجهيز الأقسام في الخلفية…' : 'Warming sections in the background…',
    loadFailed: ar ? 'تعذر التحميل' : 'Load failed',
    saveFailed: ar ? 'تعذر الحفظ' : 'Save failed',
    tabs: {
      dashboard: { ar: 'الملخص', en: 'Summary' },
      documents: { ar: 'المستندات', en: 'Documents' },
      journal: { ar: 'القيود اليومية', en: 'Journal' },
      tasks: { ar: 'المهام', en: 'Tasks' },
      deposits: { ar: 'أمانات التأمين', en: 'Deposits' },
      accounts: { ar: 'دليل الحسابات', en: 'Chart of accounts' },
      expenses: { ar: 'صرف ودخل', en: 'Expense & income' },
      trading: { ar: 'مشتريات ومبيعات', en: 'Purchases & sales' },
      cheques: { ar: 'شيكات المستأجرين', en: 'Tenant cheques' },
      ledgers: { ar: 'أستاذ تحليلي', en: 'Dimensional ledger' },
      reports: { ar: 'التقارير', en: 'Reports' },
      periods: { ar: 'الفترات', en: 'Periods' },
      settings: { ar: 'ضبط الحسابات', en: 'Settings' },
      audit: { ar: 'التدقيق', en: 'Audit' },
    } satisfies Record<AccountingHubTab, { ar: string; en: string }>,
    tabLabel(id: AccountingHubTab) {
      const row = this.tabs[id];
      return ar ? row.ar : row.en;
    },
    moneyGlance: ar ? 'ملخص الماليات' : 'Money at a glance',
    moneyHint: ar
      ? 'يشمل تحصيل الإيجارات والإقامات، والعربون والتأمين، والمصروفات المسجّلة.'
      : 'Includes rent and stay collections, booking deposits held in trust, and recorded expenses.',
    collected: ar ? 'المحصّل' : 'Collected',
    depositsHeld: ar ? 'تأمينات وعربون' : 'Deposits held',
    receivables: ar ? 'الذمم المدينة' : 'Receivables',
    expenses: ar ? 'المصروفات' : 'Expenses',
    posted: ar ? 'قيود مرحّلة' : 'Posted',
    accounts: ar ? 'حسابات' : 'Accounts',
    overdue: ar ? 'فواتير متأخرة' : 'Overdue',
    recent: ar ? 'آخر التحصيلات' : 'Recent collections',
    noCollections: ar
      ? 'لا تحصيلات ظاهرة بعد — اضغط «مزامنة المدفوعات» لجلب مدفوعات الإقامة والعربون إلى القيود.'
      : 'No collections yet — press “Sync payments” to pull stay and deposit money into journals.',
    docsTitle: ar ? 'المستندات والإيصالات' : 'Documents & receipts',
    docsHint: ar
      ? 'فواتير المطالبة، إيصالات القبض، وقيود المصدر المرتبطة — بنفس ترويسة الشركة والتوقيع الإلكتروني لفواتير الإيجار. اضغط سطراً لفتح القيد، أو اطبع/أرسل.'
      : 'Demand invoices, receipts and linked journals — same company letterhead and e-signature as rent invoices. Open a row for the GL entry, or print/send.',
    kindReceipt: ar ? 'إيصال' : 'Receipt',
    kindInvoice: ar ? 'فاتورة' : 'Invoice',
    kindJournal: ar ? 'قيد' : 'Journal',
    colKind: ar ? 'النوع' : 'Kind',
    colRef: ar ? 'المرجع' : 'Ref',
    colTitle: ar ? 'العنوان' : 'Title',
    colParty: ar ? 'الطرف / العقار' : 'Party / property',
    colNote: ar ? 'ملاحظة' : 'Note',
    colAmount: ar ? 'المبلغ' : 'Amount',
    colActions: ar ? 'إجراءات' : 'Actions',
    print: ar ? 'طباعة' : 'Print',
    send: ar ? 'إرسال' : 'Send',
    noDocs: ar
      ? 'لا مستندات بعد — سجّل قبض إيجار أو ادفع إقامة ثم اضغط مزامنة المدفوعات.'
      : 'No documents yet — record rent or stay payments, then sync.',
    journalTitle: ar ? 'دفتر اليومية' : 'General journal',
    journalHint: ar
      ? 'أنشئ قيداً مزدوجاً متوازناً، أو افتح أي قيد للاطلاع على الأسطر والملاحظات وسجل التتبع — والطباعة بترويسة الشركة.'
      : 'Create a balanced double-entry, or open any entry for lines, memos and audit trail — print with company letterhead.',
    newJournal: ar ? '＋ إضافة قيد' : '+ Add entry',
    hideComposer: ar ? 'إغلاق' : 'Close',
    expensesTitle: ar ? 'صرف ودخل' : 'Expense & income',
    expensesHint: ar
      ? 'سجّل صرفاً أو دخلاً واربطه بمبنى أو وحدة. اضغط الزر لفتح نافذة الإدخال.'
      : 'Record expense or income linked to a property or unit. Use the button to open the entry window.',
    addExpenseIncome: ar ? '＋ إضافة صرف / دخل' : '+ Add expense / income',
    tradingTitle: ar ? 'مشتريات ومبيعات' : 'Purchases & sales',
    tradingHint: ar
      ? 'قيود المشتريات والمبيعات مع ربط اختياري بالعقار. اضغط الزر لفتح نافذة الإدخال.'
      : 'Purchase and sale journals with optional property link. Use the button to open the entry window.',
    addTrading: ar ? '＋ إضافة مشتريات / مبيعات' : '+ Add purchase / sale',
    chequesTitle: ar ? 'شيكات المستأجرين' : 'Tenant cheques',
    chequesHint: ar
      ? 'تُجلب تلقائياً من جداول الشيكات في عقود الإيجار المعتمدة، مع الحالة وتاريخ الاستحقاق.'
      : 'Loaded automatically from cheque schedules on approved lease contracts, with status and due date.',
    reportsTitle: ar ? 'التقارير المالية' : 'Financial reports',
    printReport: ar ? 'طباعة التقرير' : 'Print report',
    sendReport: ar ? 'إرسال التقرير' : 'Send report',
    run: ar ? 'عرض' : 'Run',
    trial: ar ? 'ميزان المراجعة' : 'Trial balance',
    income: ar ? 'قائمة الدخل' : 'Income statement',
    balance: ar ? 'الميزانية العمومية' : 'Balance sheet',
    cashflow: ar ? 'التدفقات النقدية' : 'Cash flow',
    aging: ar ? 'أعمار الذمم' : 'AR aging',
    chartTitle: ar ? 'دليل الحسابات' : 'Chart of accounts',
    ledgersTitle: ar ? 'أستاذ تحليلي (مبنى / وحدة / طرف)' : 'Dimensional ledger',
    periodsTitle: ar ? 'إقفال الفترات المالية' : 'Fiscal period lock',
    auditTitle: ar ? 'سجل التدقيق المحاسبي' : 'Accounting audit trail',
    date: ar ? 'التاريخ' : 'Date',
    description: ar ? 'البيان' : 'Description',
    status: ar ? 'الحالة' : 'Status',
    source: ar ? 'المصدر' : 'Source',
    manual: ar ? 'يدوي' : 'Manual',
    debit: ar ? 'مدين' : 'Debit',
    credit: ar ? 'دائن' : 'Credit',
    from: ar ? 'من' : 'From',
    to: ar ? 'إلى' : 'To',
    report: ar ? 'التقرير' : 'Report',
  };
}

export type AccountingHubCopy = ReturnType<typeof accountingHubCopy>;
