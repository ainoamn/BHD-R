'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PENDING_APPROVALS_CHANGED_EVENT } from '@/lib/pending-approvals-shared';

export type SaleDecisionPromptUnit = {
  unitId: string;
  unitCode: string | null;
  unitNameAr: string;
  unitNameEn: string | null;
  tenant: string | null;
  salePriceMinor: string | null;
  currency: string;
};

/** "This unit was listed for rent and sale and is now leased — still want to sell it?" */
export function UnitSaleDecisionPrompt({
  units,
  locale,
}: {
  units: SaleDecisionPromptUnit[];
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'sale' | 'rent'>>({});
  const [error, setError] = useState<string | null>(null);

  async function decide(unitId: string, keepSelling: boolean) {
    setBusy(unitId);
    setError(null);
    try {
      const result = await browserNextMutation<{ listingPurpose: 'sale' | 'rent' }>(
        `/api/owner/units/${encodeURIComponent(unitId)}/sale-decision`,
        { method: 'POST', body: JSON.stringify({ keepSelling }) },
      );
      setDone((current) => ({ ...current, [unitId]: result.listingPurpose }));
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      router.refresh();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      setError(
        code === 'sale_decision_not_open'
          ? ar
            ? 'تم اتخاذ القرار لهذه الوحدة مسبقاً.'
            : 'This unit was already decided.'
          : ar
            ? 'تعذّر حفظ القرار — أعد المحاولة.'
            : 'Could not save the decision — try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sale-decision" aria-live="polite">
      {units.map((unit) => {
        const name = ar ? unit.unitNameAr : unit.unitNameEn || unit.unitNameAr;
        const outcome = done[unit.unitId];
        const price =
          unit.salePriceMinor && /^\d+$/.test(unit.salePriceMinor)
            ? formatMoney(unit.salePriceMinor, unit.currency, locale)
            : null;
        return (
          <article key={unit.unitId} className="sale-decision__card">
            <div className="sale-decision__text">
              <strong>
                {ar
                  ? `الوحدة «${name}» ${unit.unitCode ? `(${unit.unitCode}) ` : ''}أصبحت مؤجّرة — هل ما زلت تريد بيعها؟`
                  : `Unit “${name}” ${unit.unitCode ? `(${unit.unitCode}) ` : ''}is now leased — do you still want to sell it?`}
              </strong>
              <p>
                {ar
                  ? 'كانت معروضة للإيجار والبيع. إن اخترت «نعم» تبقى في الموقع كعقار للبيع فقط ويختفي زر التأجير، وإن اخترت «لا» تُخفى من العقارات المعروضة.'
                  : 'It was listed for rent and sale. “Yes” keeps it on the site for sale only and removes the rent button; “No” removes it from the listings.'}
                {unit.tenant
                  ? ar
                    ? ` المستأجر: ${unit.tenant}.`
                    : ` Tenant: ${unit.tenant}.`
                  : ''}
                {price
                  ? ar
                    ? ` سعر البيع المعروض: ${price}.`
                    : ` Listed sale price: ${price}.`
                  : ''}
              </p>
            </div>
            {outcome ? (
              <p className="sale-decision__done" role="status">
                {outcome === 'sale'
                  ? ar
                    ? 'تم — الوحدة معروضة الآن للبيع فقط.'
                    : 'Done — the unit is now listed for sale only.'
                  : ar
                    ? 'تم — أُخفيت الوحدة من العقارات المعروضة.'
                    : 'Done — the unit was removed from the listings.'}
              </p>
            ) : (
              <div className="sale-decision__actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy !== null}
                  onClick={() => void decide(unit.unitId, true)}
                >
                  {ar ? 'نعم، اعرضها للبيع' : 'Yes, list it for sale'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy !== null}
                  onClick={() => void decide(unit.unitId, false)}
                >
                  {ar ? 'لا، أخفِها من العقارات' : 'No, remove it from listings'}
                </button>
              </div>
            )}
          </article>
        );
      })}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
