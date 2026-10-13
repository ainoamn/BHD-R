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
  question: 'keep_selling' | 'hide';
  reason: 'leased' | 'sold';
  tenant: string | null;
  salePriceMinor: string | null;
  currency: string;
};

type Outcome = { listingPurpose: 'rent' | 'sale' | 'both'; hidden: boolean };

function outcomeText(outcome: Outcome, ar: boolean): string {
  if (outcome.hidden) {
    return ar
      ? 'تم — أُخفيت الوحدة من العقارات المعروضة.'
      : 'Done — the unit was removed from the listings.';
  }
  if (outcome.listingPurpose === 'sale') {
    return ar
      ? 'تم — الوحدة معروضة الآن للبيع فقط.'
      : 'Done — the unit is now listed for sale only.';
  }
  return ar
    ? 'تم — تبقى الوحدة ظاهرة في العقارات مع حالتها، ولا يمكن حجزها.'
    : 'Done — the unit stays listed with its status and cannot be booked.';
}

/**
 * Leased or sold units stay listed until the owner answers: "still want to sell?" for a
 * rent-and-sale unit now leased, otherwise "hide it from the listings?".
 */
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
  const [done, setDone] = useState<Record<string, Outcome>>({});
  const [error, setError] = useState<string | null>(null);

  async function decide(unitId: string, body: { keepSelling: boolean } | { hide: boolean }) {
    setBusy(unitId);
    setError(null);
    try {
      const result = await browserNextMutation<Outcome>(
        `/api/owner/units/${encodeURIComponent(unitId)}/sale-decision`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setDone((current) => ({ ...current, [unitId]: result }));
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
        const label = `${name}${unit.unitCode ? ` (${unit.unitCode})` : ''}`;
        const outcome = done[unit.unitId];
        const sold = unit.reason === 'sold';
        const price =
          unit.salePriceMinor && /^\d+$/.test(unit.salePriceMinor)
            ? formatMoney(unit.salePriceMinor, unit.currency, locale)
            : null;
        const party = unit.tenant
          ? ar
            ? ` ${sold ? 'المشتري' : 'المستأجر'}: ${unit.tenant}.`
            : ` ${sold ? 'Buyer' : 'Tenant'}: ${unit.tenant}.`
          : '';
        const keepSelling = unit.question === 'keep_selling';
        return (
          <article key={unit.unitId} className="sale-decision__card">
            <div className="sale-decision__text">
              <strong>
                {keepSelling
                  ? ar
                    ? `الوحدة «${label}» أصبحت مؤجّرة — هل ما زلت تريد بيعها؟`
                    : `Unit “${label}” is now leased — do you still want to sell it?`
                  : ar
                    ? `الوحدة «${label}» ${sold ? 'بيعت' : 'أصبحت مؤجّرة بعقد طويل'} — هل تريد إخفاءها من العقارات المعروضة؟`
                    : `Unit “${label}” is now ${sold ? 'sold' : 'on a long lease'} — hide it from the listings?`}
              </strong>
              <p>
                {keepSelling
                  ? ar
                    ? 'كانت معروضة للإيجار والبيع. إن اخترت «نعم» تبقى في الموقع كعقار للبيع فقط ويختفي زر التأجير، وإن اخترت «لا» تُخفى من العقارات المعروضة.'
                    : 'It was listed for rent and sale. “Yes” keeps it on the site for sale only and removes the rent button; “No” removes it from the listings.'
                  : ar
                    ? `حتى تقرّر تبقى ظاهرة في الموقع بحالة «${sold ? 'مباع' : 'مؤجّر'}» ولا يمكن حجزها. إن أخفيتها تعود للظهور تلقائياً عند ${sold ? 'إلغاء البيع' : 'انتهاء العقد'}.`
                    : `Until you decide it stays on the site marked ${sold ? 'sold' : 'leased'} and cannot be booked. If hidden, it returns automatically when the ${sold ? 'sale is undone' : 'lease ends'}.`}
                {party}
                {keepSelling && price
                  ? ar
                    ? ` سعر البيع المعروض: ${price}.`
                    : ` Listed sale price: ${price}.`
                  : ''}
              </p>
            </div>
            {outcome ? (
              <p className="sale-decision__done" role="status">
                {outcomeText(outcome, ar)}
              </p>
            ) : (
              <div className="sale-decision__actions">
                {keepSelling ? (
                  <>
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busy !== null}
                      onClick={() => void decide(unit.unitId, { keepSelling: true })}
                    >
                      {ar ? 'نعم، اعرضها للبيع' : 'Yes, list it for sale'}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={busy !== null}
                      onClick={() => void decide(unit.unitId, { keepSelling: false })}
                    >
                      {ar ? 'لا، أخفِها من العقارات' : 'No, remove it from listings'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busy !== null}
                      onClick={() => void decide(unit.unitId, { hide: true })}
                    >
                      {ar ? 'نعم، أخفِها' : 'Yes, hide it'}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={busy !== null}
                      onClick={() => void decide(unit.unitId, { hide: false })}
                    >
                      {ar ? 'لا، أبقِها ظاهرة' : 'No, keep it listed'}
                    </button>
                  </>
                )}
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
