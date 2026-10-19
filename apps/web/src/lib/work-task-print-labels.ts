/** Shared bilingual labels for task event types (safe for client + server). */

export const TASK_EVENT_LABEL: Record<string, { ar: string; en: string }> = {
  'task.created': { ar: 'أُنشئت المهمة', en: 'Task opened' },
  'task.reply': { ar: 'رد', en: 'Reply' },
  'task.status': { ar: 'تغيير الحالة', en: 'Status change' },
  'task.reassigned': { ar: 'تحويل', en: 'Reassigned' },
  'task.legal': { ar: 'فُتحت قضية', en: 'Legal case opened' },
  'task.roster': { ar: 'أُضيف متابع', en: 'Follower added' },
  'task.link': { ar: 'رُبطت المهمة', en: 'Task linked' },
  'task.file': { ar: 'مرفق', en: 'File' },
  'task.tags': { ar: 'تحديث الوسوم', en: 'Tags updated' },
  'task.dates': { ar: 'تحديث التواريخ', en: 'Dates updated' },
  'task.priority': { ar: 'تحديث الأولوية', en: 'Priority updated' },
  'task.reopen': { ar: 'إعادة فتح / متابعة', en: 'Reopened / follow-up' },
};

export function taskEventLabel(type: string, locale: 'ar' | 'en'): string {
  const row = TASK_EVENT_LABEL[type];
  if (!row) return type;
  return locale === 'ar' ? row.ar : row.en;
}
