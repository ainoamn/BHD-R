'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';

type Row = { id: string; reference: string; title: string; status: string };

const STATUS: Record<string, [string, string]> = {
  pending: ['جديدة', 'New'],
  approved: ['معتمدة', 'Approved'],
  in_progress: ['قيد التنفيذ', 'In progress'],
  on_hold: ['معلقة', 'On hold'],
  completed: ['مغلقة', 'Closed'],
  cancelled: ['ملغاة', 'Cancelled'],
  rejected: ['مرفوضة', 'Rejected'],
};

/** Tasks linked to a building, or to one unit when a unit is in focus. */
export function SubjectTasks({
  portal,
  locale,
  propertyId,
  unitId,
}: {
  portal: 'owner' | 'developer';
  locale: 'ar' | 'en';
  propertyId: string;
  unitId?: string | null | undefined;
}) {
  const ar = locale === 'ar';
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const query = unitId
      ? `unitId=${encodeURIComponent(unitId)}`
      : `propertyId=${encodeURIComponent(propertyId)}`;
    const controller = new AbortController();
    void fetch(`/api/portal/tasks?${query}`, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { tasks?: Row[] };
        setRows(payload.tasks ?? []);
      })
      .catch(() => setRows([]));
    return () => controller.abort();
  }, [propertyId, unitId]);

  if (!rows?.length) return null;
  return (
    <section
      className="property-360__section"
      aria-label={ar ? 'مهام هذا الأصل' : 'Tasks for this asset'}
    >
      <h2>
        {unitId
          ? ar
            ? 'مهام هذه الوحدة'
            : 'Tasks for this unit'
          : ar
            ? 'مهام هذا المبنى'
            : 'Tasks for this building'}
      </h2>
      <ul className="task-page__checks">
        {rows.map((row) => {
          const label = STATUS[row.status] ?? [row.status, row.status];
          return (
            <li key={row.id}>
              <Link href={`/${portal}/tasks/${encodeURIComponent(row.id)}`}>
                <strong dir="ltr">{row.reference}</strong> · {row.title}
              </Link>
              <small>{ar ? label[0] : label[1]}</small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
