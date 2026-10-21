'use client';

import { useMemo, useState, useTransition } from 'react';
import { browserNextMutation } from '@/lib/api';
import type { PropertyStaySettingsUnit } from '@/lib/property-stay-settings';

/**
 * Portfolio toggles for whether guest date/period changes auto-apply or wait for the owner.
 */
export function StayReschedulePolicyBoard({
  locale,
  units: initial,
}: {
  locale: 'ar' | 'en';
  units: PropertyStaySettingsUnit[];
}) {
  const ar = locale === 'ar';
  const [units, setUnits] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, PropertyStaySettingsUnit[]>();
    for (const unit of units) {
      const list = map.get(unit.propertyId) ?? [];
      list.push(unit);
      map.set(unit.propertyId, list);
    }
    return [...map.entries()];
  }, [units]);

  const autoCount = units.filter((unit) => unit.autoApproveReschedule !== false).length;

  async function saveUnit(unit: PropertyStaySettingsUnit, autoApproveReschedule: boolean) {
    setBusyId(unit.profileId);
    setMessage(null);
    try {
      await browserNextMutation('/api/owner/stays/setup', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_profile',
          profileId: unit.profileId,
          payload: { autoApproveReschedule },
        }),
      });
      setUnits((current) =>
        current.map((row) =>
          row.profileId === unit.profileId ? { ...row, autoApproveReschedule } : row,
        ),
      );
      setMessage({
        ok: true,
        text: ar ? 'تم حفظ إعداد تعديل التواريخ.' : 'Date-change setting saved.',
      });
    } catch {
      setMessage({
        ok: false,
        text: ar ? 'تعذّر الحفظ — أعد المحاولة.' : 'Could not save — try again.',
      });
    } finally {
      setBusyId(null);
    }
  }

  function setAll(autoApproveReschedule: boolean) {
    startTransition(async () => {
      setMessage(null);
      let failed = 0;
      for (const unit of units) {
        if ((unit.autoApproveReschedule !== false) === autoApproveReschedule) continue;
        try {
          await browserNextMutation('/api/owner/stays/setup', {
            method: 'POST',
            body: JSON.stringify({
              action: 'update_profile',
              profileId: unit.profileId,
              payload: { autoApproveReschedule },
            }),
          });
          setUnits((current) =>
            current.map((row) =>
              row.profileId === unit.profileId ? { ...row, autoApproveReschedule } : row,
            ),
          );
        } catch {
          failed += 1;
        }
      }
      setMessage({
        ok: failed === 0,
        text:
          failed === 0
            ? ar
              ? autoApproveReschedule
                ? 'فُعّلت الموافقة التلقائية لكل الوحدات.'
                : 'أُوقف الاعتماد التلقائي — ستراجع كل طلب تعديل بنفسك.'
              : autoApproveReschedule
                ? 'Auto-approval enabled for every unit.'
                : 'Auto-approval turned off — you will review every change.'
            : ar
              ? `تعذّر حفظ ${failed} وحدة — أعد المحاولة.`
              : `Could not save ${failed} unit(s) — try again.`,
      });
    });
  }

  if (!units.length) {
    return (
      <section className="portal-settings__card" aria-labelledby="stay-reschedule-title">
        <h2 id="stay-reschedule-title">
          {ar
            ? 'تخصيص اعتماد التعديل لكل وحدة إقامة'
            : 'Per-unit override for date-change approval'}
        </h2>
        <p className="muted">
          {ar
            ? 'لا توجد وحدات إيجار يومي بعد. استخدم خطوة «اعتماد تعديل الحجز» في السياسة أعلاه؛ وبعد إضافة إقامة يومية تظهر الوحدات هنا للتخصيص.'
            : 'No daily-stay units yet. Use the “Approve booking changes” step in the policy above; units appear here for overrides after you add a daily stay.'}
        </p>
      </section>
    );
  }

  return (
    <section className="portal-settings__card" aria-labelledby="stay-reschedule-title">
      <header className="portal-settings__card-head">
        <div>
          <h2 id="stay-reschedule-title">
            {ar
              ? 'تخصيص اعتماد التعديل لكل وحدة إقامة'
              : 'Per-unit override for date-change approval'}
          </h2>
          <p className="muted">
            {ar
              ? 'السياسة العامة أعلاه هي المرجع. هنا يمكنك إبقاء وحدة بموافقة تلقائية وأخرى بمراجعة يدوية.'
              : 'The policy above is the default. Here you can keep one unit automatic and another manual.'}
          </p>
        </div>
        <span className="portal-settings__stat">
          {ar
            ? `${autoCount} من ${units.length} بموافقة تلقائية`
            : `${autoCount} of ${units.length} auto-approve`}
        </span>
      </header>

      <div className="portal-settings__bulk">
        <button
          type="button"
          className="button button--quiet"
          disabled={pending || busyId !== null}
          onClick={() => setAll(true)}
        >
          {ar ? 'تفعيل للجميع' : 'Enable for all'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={pending || busyId !== null}
          onClick={() => setAll(false)}
        >
          {ar ? 'مراجعة يدوية للجميع' : 'Manual review for all'}
        </button>
      </div>

      <div className="portal-settings__groups">
        {grouped.map(([propertyId, propertyUnits]) => {
          const first = propertyUnits[0]!;
          const name = ar
            ? first.propertyNameAr || first.propertyNameEn
            : first.propertyNameEn || first.propertyNameAr;
          return (
            <div key={propertyId} className="portal-settings__group">
              <h3>{name}</h3>
              <ul>
                {propertyUnits.map((unit) => {
                  const checked = unit.autoApproveReschedule !== false;
                  const busy = busyId === unit.profileId || pending;
                  const label = ar
                    ? unit.unitNameAr || unit.unitNameEn || unit.unitCode
                    : unit.unitNameEn || unit.unitNameAr || unit.unitCode;
                  return (
                    <li key={unit.unitId}>
                      <label className="portal-settings__toggle">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={(event) => void saveUnit(unit, event.target.checked)}
                        />
                        <span>
                          <strong>
                            {label} · {unit.unitCode}
                          </strong>
                          <em>
                            {checked
                              ? ar
                                ? 'موافقة تلقائية على تعديل التواريخ'
                                : 'Auto-approve date changes'
                              : ar
                                ? 'بانتظار اعتمادك لكل طلب تعديل'
                                : 'You approve every change request'}
                          </em>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {message ? (
        <p
          className={message.ok ? 'notice notice--success' : 'notice notice--error'}
          role={message.ok ? 'status' : 'alert'}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
