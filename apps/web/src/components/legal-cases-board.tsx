'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import {
  LEGAL_POLL_MS,
  LEGAL_STAGE_LABELS,
  legalDate,
  type LegalCaseSummary,
} from '@/lib/legal-case-shared';
import type { PortalRole } from '@/lib/types';

/** Legal cases as cards: stage, court, next hearing, amounts and unread messages. */
export function LegalCasesBoard({
  portal,
  locale,
  active,
  lawyer = false,
}: {
  portal: PortalRole;
  locale: 'ar' | 'en';
  active: boolean;
  lawyer?: boolean;
}) {
  const ar = locale === 'ar';
  const [cases, setCases] = useState<LegalCaseSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/portal/legal/cases', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(String(response.status));
      setCases(((await response.json()) as { cases: LegalCaseSummary[] }).cases);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = window.setInterval(() => void load(), LEGAL_POLL_MS * 2);
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: string }>).detail;
      if (!detail || detail.section === 'legal') void load();
    };
    window.addEventListener('bhd-r-ops-refresh', onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('bhd-r-ops-refresh', onRefresh);
    };
  }, [active, load]);

  const needle = query.trim().toLowerCase();
  const shown = (cases ?? []).filter(
    (item) =>
      !needle ||
      [
        item.reference,
        item.title,
        item.caseNumber,
        item.court,
        item.counterpartyName,
        item.lawyerName,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
  );

  return (
    <section className="legal-board" aria-label={ar ? 'القضايا' : 'Cases'}>
      {lawyer ? (
        <p className="legal-board__intro">
          {ar
            ? 'هذه القضايا المسندة إليك. افتح القضية لتحديث مرحلتها ومبالغها وجلساتها، ولمراسلة فريق المالك وإرفاق المستندات.'
            : 'These are the cases assigned to you. Open a case to update its stage, amounts and hearings, and to message the owner’s team with documents.'}
        </p>
      ) : null}
      <div className="legal-board__tools">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            ar ? 'بحث برقم الملف أو الموضوع أو الخصم' : 'Search by file, subject or party'
          }
          aria-label={ar ? 'بحث في القضايا' : 'Search cases'}
        />
      </div>
      {cases === null && !failed ? (
        <p className="legal-board__empty">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : failed && cases === null ? (
        <p className="legal-board__empty">
          {ar ? 'تعذّر تحميل القضايا.' : 'Could not load the cases.'}{' '}
          <button type="button" className="ops-action" onClick={() => void load()}>
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </p>
      ) : !shown.length ? (
        <p className="legal-board__empty">
          {needle
            ? ar
              ? 'لا قضايا مطابقة.'
              : 'No matching cases.'
            : lawyer
              ? ar
                ? 'لم تُسند إليك قضايا بعد.'
                : 'No cases are assigned to you yet.'
              : ar
                ? 'لا قضايا بعد.'
                : 'No cases yet.'}
        </p>
      ) : (
        <ul className="legal-board__list">
          {shown.map((item) => {
            const stage = LEGAL_STAGE_LABELS[item.status];
            const place = [
              ar ? item.propertyNameAr : item.propertyNameEn || item.propertyNameAr,
              item.unitCode,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={item.id}>
                <Link
                  href={`/${portal}/legal/${encodeURIComponent(item.id)}`}
                  className={item.unread ? 'legal-card has-unread' : 'legal-card'}
                  prefetch={false}
                >
                  <span className="legal-card__head">
                    <strong dir="ltr">{item.reference}</strong>
                    <span className={`legal-stage legal-stage--${item.status}`}>
                      {ar ? stage.ar : stage.en}
                    </span>
                    {item.unread ? (
                      <span className="legal-card__unread">
                        {ar ? `${item.unread} جديد` : `${item.unread} new`}
                      </span>
                    ) : null}
                  </span>
                  <span className="legal-card__title">{item.title}</span>
                  <span className="legal-card__meta">
                    {[
                      item.court,
                      item.caseNumber ? `${ar ? 'رقم' : 'No.'} ${item.caseNumber}` : null,
                      item.counterpartyName
                        ? `${ar ? 'الخصم:' : 'Against:'} ${item.counterpartyName}`
                        : null,
                      place || null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || (ar ? 'لا تفاصيل بعد' : 'No details yet')}
                  </span>
                  <span className="legal-card__facts">
                    <span>
                      <small>{ar ? 'الجلسة القادمة' : 'Next hearing'}</small>
                      {legalDate(item.nextHearingAt, locale, true)}
                    </span>
                    <span>
                      <small>{ar ? 'المطالبة' : 'Claimed'}</small>
                      {formatMoney(item.claimAmountMinor, item.currency, locale)}
                    </span>
                    <span>
                      <small>{ar ? 'المحصّل' : 'Recovered'}</small>
                      {formatMoney(item.recoveredAmountMinor, item.currency, locale)}
                    </span>
                    {!lawyer ? (
                      <span>
                        <small>{ar ? 'المحامي' : 'Lawyer'}</small>
                        {item.lawyerName ?? (ar ? 'غير مسند' : 'Unassigned')}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
