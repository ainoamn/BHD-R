/** Categories an owner may wipe while testing — properties and units are never included. */

export const LAB_RESET_CATEGORIES = [
  'tasks',
  'accounting',
  'leasing',
  'bookings',
  'stays',
  'maintenance',
  'legal',
  'sales',
  'approvals',
] as const;

export type LabResetCategory = (typeof LAB_RESET_CATEGORIES)[number];

export const LAB_RESET_CONFIRM = 'RESET';

export type LabResetCounts = Record<LabResetCategory, number>;

export type LabResetResult = {
  deleted: Partial<Record<LabResetCategory, number>>;
};

export function labResetLabel(category: LabResetCategory, locale: 'ar' | 'en'): string {
  const copy: Record<LabResetCategory, [string, string]> = {
    tasks: ['المهام وسجل النشاط (آخر النشاط)', 'Tasks & activity feed (recent activity)'],
    accounting: ['المحاسبة والمصروفات والقيود', 'Accounting, expenses & journals'],
    leasing: ['الإيجارات والفواتير والمدفوعات والإيصالات', 'Leases, invoices, payments & receipts'],
    bookings: ['الحجوزات والعقود والطلبات المرتبطة', 'Reservations, contracts & related holds'],
    stays: [
      'حجوزات الإقامة اليومية (بدون إعداد العقار)',
      'Daily stay bookings (keep property stay setup)',
    ],
    maintenance: ['الصيانة وأوامر العمل والطلبات', 'Maintenance, work orders & requests'],
    legal: ['القضايا القانونية', 'Legal cases'],
    sales: ['صفقات البيع', 'Sales deals'],
    approvals: ['طلبات الاعتماد', 'Approval requests'],
  };
  return locale === 'ar' ? copy[category][0] : copy[category][1];
}
