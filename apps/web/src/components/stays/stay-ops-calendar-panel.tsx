import { EmptyState } from '@bhd-r/ui';

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

  if (!items.length) {
    return (
      <EmptyState
        title={ar ? 'لا وحدات إقامة بعد' : 'No stay units yet'}
        description={
          ar
            ? 'أنشئ ملف إقامة عبر معالج الإعداد، ثم صدّر تقويم الوحدة.'
            : 'Create a stay profile via setup, then export the unit calendar.'
        }
      />
    );
  }

  return (
    <div className="ops-panel stays-ops-calendar">
      <p className="muted">
        {ar
          ? 'تصدير iCal للقراءة فقط من أقفال المخزون النشطة. استيراد القنوات / OTA ما زال موقوفاً حتى ضوابط SSRF.'
          : 'Read-only iCal export from active inventory locks. Channel/OTA import stays blocked until SSRF controls.'}
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
    </div>
  );
}
