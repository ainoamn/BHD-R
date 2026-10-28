'use client';

import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { browserNextMutation } from '@/lib/api';
import {
  LeaseContractForm,
  type LeaseContractPayload,
} from '@/components/lease-contract-form';
import type { PropertyRecordTenant, PropertyRecordUnit } from '@/lib/property-records-neon';

type OptionRow = {
  id: string;
  propertyId?: string;
  code?: string;
  name?: string;
  nameAr?: string;
  nameEn?: string;
  displayName?: string;
  currency?: string;
  type?: string;
  email?: string | null;
  phone?: string | null;
};

type ReservationOption = {
  id: string;
  unitId?: string;
  tenantPartyId?: string;
  name?: string;
  status?: string;
};

/**
 * Full lease contract form (same as booking workflow) for /owner/leasing convert,
 * plus shortcuts into confirmed reservations that already have that form.
 */
export function LeasingConvertPanel({
  portal,
  locale,
  vacantUnits,
  tenants,
  reservations,
  prefillReservationId,
  onDone,
  onCancel,
}: {
  portal: string;
  locale: 'ar' | 'en';
  vacantUnits: OptionRow[];
  tenants: OptionRow[];
  reservations: ReservationOption[];
  prefillReservationId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const units: PropertyRecordUnit[] = useMemo(
    () =>
      vacantUnits.map((row) => ({
        id: row.id,
        code: row.code || row.name || row.id.slice(0, 8),
        rentMinor: null,
        salePriceMinor: null,
        depositMinor: null,
        currency: row.currency || 'OMR',
        floor: null,
        areaSquareMeters: null,
        electricityMeter: null,
        waterMeter: null,
      })),
    [vacantUnits],
  );

  const directory: PropertyRecordTenant[] = useMemo(
    () =>
      tenants.map((row) => ({
        id: row.id,
        displayName: row.displayName || row.name || row.nameAr || row.nameEn || row.id.slice(0, 8),
        type: row.type === 'company' ? 'company' : 'person',
        email: row.email ?? null,
        phone: row.phone ?? null,
      })),
    [tenants],
  );

  const propertyIdByUnit = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of vacantUnits) {
      if (row.propertyId) map.set(row.id, row.propertyId);
    }
    return map;
  }, [vacantUnits]);

  async function submit(payload: LeaseContractPayload) {
    const propertyId = propertyIdByUnit.get(payload.unitId);
    if (!propertyId) {
      setError(ar ? 'تعذّر تحديد العقار للوحدة المختارة.' : 'Could not resolve property for the unit.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(`/api/owner/properties/${encodeURIComponent(propertyId)}/records`, {
        method: 'POST',
        body: JSON.stringify({ action: 'create_lease', ...payload }),
      });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="leasing-convert-panel">
      {reservations.length ? (
        <section className="notice" style={{ marginBottom: '1rem' }}>
          <strong>{ar ? 'من حجز مؤكد' : 'From a confirmed reservation'}</strong>
          <p className="muted" style={{ margin: '0.35rem 0 0.75rem' }}>
            {ar
              ? 'لفتح نفس صفحة العقد والمستندات المستخدمة في مسار الحجز، اختر حجزاً:'
              : 'To open the same contract page used in the booking workflow, pick a reservation:'}
          </p>
          <ul className="ops-action-group" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {reservations.map((row) => (
              <li key={row.id} style={{ marginBottom: '0.35rem' }}>
                <Link
                  className={
                    prefillReservationId === row.id
                      ? 'button button--primary'
                      : 'button button--quiet'
                  }
                  href={`/${portal}/bookings/${encodeURIComponent(row.id)}`}
                  prefetch
                >
                  {row.name || row.id.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h3 style={{ marginTop: reservations.length ? '1.25rem' : 0 }}>
        {ar ? 'أو أنشئ عقد إيجار جديداً' : 'Or create a new lease contract'}
      </h3>
      <p className="muted">
        {ar
          ? 'نفس خانات وخيارات صفحة العقد في الحجز: الإيجار، فترة السماح، الرسوم، المبالغ والتخفيضات الأخرى، والتأمين وجدول الشيكات.'
          : 'Same fields as the booking contract page: rent, grace, fees, other amounts/discounts, deposit and cheque schedule.'}
      </p>

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}

      {units.length ? (
        <LeaseContractForm
          units={units}
          tenants={directory}
          canSign
          locale={locale}
          busy={busy}
          onSubmit={(payload) => void submit(payload)}
          onCancel={onCancel}
          heading={ar ? 'عقد إيجار جديد' : 'New lease contract'}
          submitLabel={ar ? 'حفظ وبدء سير العمل' : 'Save & start workflow'}
        />
      ) : (
        <p className="muted">
          {ar
            ? 'لا توجد وحدات شاغرة حالياً لإنشاء عقد يدوي. استخدم حجزاً مؤكداً أعلاه إن وُجد.'
            : 'No vacant units for a walk-in lease. Use a confirmed reservation above if available.'}
        </p>
      )}
    </div>
  );
}
