/** Shared task status / priority labels and colors for list + workspace (AR/EN). */

export const TASK_STATUS_LABEL: Record<string, { ar: string; en: string }> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  pending: { ar: 'جديدة', en: 'New' },
  approved: { ar: 'معتمدة', en: 'Approved' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In progress' },
  on_hold: { ar: 'معلقة', en: 'On hold' },
  completed: { ar: 'مغلقة', en: 'Closed' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled' },
  rejected: { ar: 'مرفوضة', en: 'Rejected' },
};

export const TASK_PRIORITY_LABEL: Record<string, { ar: string; en: string }> = {
  low: { ar: 'منخفضة', en: 'Low' },
  normal: { ar: 'عادية', en: 'Normal' },
  high: { ar: 'عالية', en: 'High' },
  urgent: { ar: 'عاجلة', en: 'Urgent' },
};

/** Statuses that need a written reason before the change is saved. */
export const TASK_REASON_STATUSES = new Set(['rejected', 'cancelled', 'completed']);

export const TASK_STATUS_ORDER = [
  'pending',
  'approved',
  'in_progress',
  'on_hold',
  'draft',
  'completed',
  'rejected',
  'cancelled',
] as const;

export function taskStatusLabel(status: string, locale: 'ar' | 'en'): string {
  const row = TASK_STATUS_LABEL[status];
  if (!row) return status;
  return locale === 'ar' ? row.ar : row.en;
}

export function taskPriorityLabel(priority: string, locale: 'ar' | 'en'): string {
  const row = TASK_PRIORITY_LABEL[priority];
  if (!row) return priority;
  return locale === 'ar' ? row.ar : row.en;
}

export function taskNeedsReason(status: string): boolean {
  return TASK_REASON_STATUSES.has(status);
}
