'use client';

import { useState } from 'react';
import { EmptyState } from '@bhd-r/ui';
import { StayAvailabilityCalendar } from '@/components/stays/stay-availability-calendar';

export type StayCalendarUnit = {
  unitId: string;
  propertyId: string;
  stayProfileId: string;
  timezone: string;
  unitCode: string;
  calendarPath: string;
};

export function StayOpsCalendarPanel({
  locale,
  items,
}: {
  locale: string;
  items: StayCalendarUnit[];
}) {
  const ar = locale === 'ar';
  const [activeUnitId, setActiveUnitId] = useState(items[0]?.unitId ?? '');

  if (!items.length) {
    return (
      <EmptyState
        title={ar ? 'لا وحدات إقامة بعد' : 'No stay units yet'}
        description={
          ar
            ? 'أنشئ ملف إقامة عبر معالج الإعداد، ثم راجع التقويم هنا.'
            : 'Create a stay profile via setup, then review the calendar here.'
        }
      />
    );
  }

  const activeUnit = items.find((unit) => unit.unitId === activeUnitId) ?? items[0]!;

  return (
    <div className="ops-panel stays-ops-calendar">
      <header className="stays-ops-calendar__header">
        <div>
          <h2>{ar ? 'تقويم الإشغال' : 'Occupancy calendar'}</h2>
          <p className="muted">
            {ar
              ? 'الأيام الخضراء شاغرة، والمحجوزة تظهر باللون الأحمر. استخدم التقويم لمتابعة الحجوزات والإغلاقات.'
              : 'Green days are available; booked nights appear in red. Use the calendar to track bookings and blocks.'}
          </p>
        </div>
      </header>

      <div className="stays-ops-calendar__units" role="tablist" aria-label={ar ? 'الوحدات' : 'Units'}>
        {items.map((unit) => (
          <button
            key={unit.unitId}
            type="button"
            role="tab"
            aria-selected={unit.unitId === activeUnit.unitId}
            className={
              unit.unitId === activeUnit.unitId
                ? 'button button--primary stays-ops-calendar__unit-tab'
                : 'button button--quiet stays-ops-calendar__unit-tab'
            }
            onClick={() => setActiveUnitId(unit.unitId)}
          >
            <span dir="ltr">{unit.unitCode}</span>
          </button>
        ))}
      </div>

      <StayAvailabilityCalendar
        key={activeUnit.unitId}
        locale={locale}
        mode="ops"
        unitId={activeUnit.unitId}
        monthCount={2}
      />

      <details className="stays-ops-calendar__export">
        <summary>{ar ? 'تصدير iCal' : 'iCal export'}</summary>
        <p className="muted">
          {ar
            ? 'تصدير للقراءة فقط من أقفال المخزون النشطة.'
            : 'Read-only export from active inventory locks.'}
        </p>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{ar ? 'الوحدة' : 'Unit'}</th>
                <th>{ar ? 'المنطقة الزمنية' : 'Timezone'}</th>
                <th>{ar ? 'تصدير' : 'Export'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((unit) => (
                <tr key={unit.unitId}>
                  <td dir="ltr">{unit.unitCode}</td>
                  <td dir="ltr">{unit.timezone}</td>
                  <td>
                    <a className="button button--quiet" href={unit.calendarPath} download>
                      {ar ? 'تنزيل .ics' : 'Download .ics'}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
