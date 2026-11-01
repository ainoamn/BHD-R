'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import type {
  PlatformAccountingNarrative,
  PlatformAccountingView,
} from '@/lib/site-admin-shared';
import {
  adminDate,
  adminErrorText,
  adminGet,
  type AdminNotice,
} from './admin-fetch';
import {
  SiteAdminBanner,
  SiteAdminFailed,
  SiteAdminLoading,
  SiteAdminPage,
  SiteAdminSurface,
} from './site-admin-page';

function omr(minor: number, ar: boolean): string {
  const value = (minor / 1000).toFixed(3);
  return ar ? `${value} ر.ع.` : `${value} OMR`;
}

/** Client-accounts desk: org money pulse and AI ranking (platform cash lives under /admin/finance). */
export function AccountingAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [view, setView] = useState<PlatformAccountingView | null>(null);
  const [narrative, setNarrative] = useState<PlatformAccountingNarrative | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'income' | 'expense' | 'net' | 'name'>('income');

  const load = useCallback(() => {
    let live = true;
    setFailed(false);
    adminGet<PlatformAccountingView>('/api/site-admin/accounting')
      .then((data) => live && setView(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  const accounts = useMemo(() => {
    if (!view) return [];
    const q = query.trim().toLowerCase();
    let rows = view.accounts;
    if (q) {
      rows = rows.filter(
        (row) =>
          row.nameAr.toLowerCase().includes(q) ||
          (row.nameEn ?? '').toLowerCase().includes(q) ||
          row.planKey.toLowerCase().includes(q),
      );
    }
    const ranked = narrative?.rankedOrganizationIds ?? [];
    const rank = new Map(ranked.map((id, index) => [id, index]));
    return [...rows].sort((a, b) => {
      if (rank.size) {
        const ra = rank.has(a.organizationId) ? rank.get(a.organizationId)! : 999;
        const rb = rank.has(b.organizationId) ? rank.get(b.organizationId)! : 999;
        if (ra !== rb) return ra - rb;
      }
      if (sort === 'expense') return b.expenseMinor - a.expenseMinor;
      if (sort === 'net')
        return b.incomeMinor - b.expenseMinor - (a.incomeMinor - a.expenseMinor);
      if (sort === 'name') return a.nameAr.localeCompare(b.nameAr, 'ar');
      return b.incomeMinor - a.incomeMinor;
    });
  }, [view, query, sort, narrative]);

  async function runAi() {
    setAiBusy(true);
    try {
      const data = await browserNextMutation<{ narrative: PlatformAccountingNarrative }>(
        '/api/site-admin/accounting/narrative',
        { method: 'POST', body: '{}' },
      );
      setNarrative(data.narrative);
      setNotice({
        tone: 'success',
        text:
          data.narrative.engine === 'ai'
            ? ar
              ? 'اكتمل تحليل الذكاء الاصطناعي.'
              : 'AI analysis ready.'
            : ar
              ? 'تحليل قواعدي جاهز (الذكاء الاصطناعي غير متاح حالياً).'
              : 'Rules analysis ready (AI unavailable right now).',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر التحليل.', 'Analysis failed.'),
      });
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <SiteAdminPage
      locale={locale}
      title={ar ? 'حسابات العملاء' : 'Client accounts'}
      lead={
        ar
          ? 'دخل وصرف كل منشأة على المنصة ونبض التسويق — مع تحليل وفرز بالذكاء الاصطناعي. أموال اشتراكات الموقع في صفحة مستقلة.'
          : 'Per-organization income and spend with a marketing pulse and AI ranking. Platform subscription cash lives on its own page.'
      }
      actions={
        <>
          <Link className="button button--quiet" href={`/${locale}/admin/finance`}>
            {ar ? 'أموال المنصة' : 'Platform finance'}
          </Link>
          <button
            type="button"
            className="button button--primary"
            disabled={aiBusy || !view}
            onClick={() => void runAi()}
          >
            {aiBusy
              ? ar
                ? 'جارٍ التحليل…'
                : 'Analyzing…'
              : ar
                ? 'تحليل بالذكاء الاصطناعي'
                : 'Analyze with AI'}
          </button>
        </>
      }
    >
      <SiteAdminBanner notice={notice} />

      {failed ? (
        <SiteAdminFailed
          locale={locale}
          messageAr="تعذّر تحميل المحاسبة."
          messageEn="Could not load accounting."
        />
      ) : view === null ? (
        <SiteAdminLoading locale={locale} />
      ) : (
        <>
          <SiteAdminSurface title={ar ? 'نبض العملاء' : 'Client pulse'}>
            <div className="sa-pulse-grid">
              <div className="sa-pulse-card sa-pulse-card--in">
                <span>{ar ? 'إجمالي دخل العملاء' : 'Client income'}</span>
                <strong>{omr(view.pulse.clientIncomeMinor, ar)}</strong>
              </div>
              <div className="sa-pulse-card sa-pulse-card--out">
                <span>{ar ? 'إجمالي صرف العملاء' : 'Client spend'}</span>
                <strong>{omr(view.pulse.clientExpenseMinor, ar)}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'تحصيلات الموقع (مرجع)' : 'Site collections (ref)'}</span>
                <strong>{omr(view.pulse.siteIncomeMinor, ar)}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'مصروفات الموقع (مرجع)' : 'Site expenses (ref)'}</span>
                <strong>{omr(view.pulse.siteExpenseMinor, ar)}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'تقدير اشتراكات شهري' : 'Est. subscription MRR'}</span>
                <strong>{omr(view.pulse.estimatedSubscriptionMonthlyMinor, ar)}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'منشآت' : 'Organizations'}</span>
                <strong>{view.pulse.organizations}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'مستخدمون' : 'Users'}</span>
                <strong>{view.pulse.users}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'عقارات' : 'Properties'}</span>
                <strong>{view.pulse.properties}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'وحدات' : 'Units'}</span>
                <strong>{view.pulse.units}</strong>
              </div>
            </div>
            <p className="muted sa-footnote">
              {ar
                ? `آخر تحديث: ${adminDate(view.generatedAt, ar)} · إدارة الإيصالات والاشتراكات المحصّلة من «أموال المنصة».`
                : `Updated: ${adminDate(view.generatedAt, ar)} · Manage receipts and collected subscriptions in Platform finance.`}
            </p>
          </SiteAdminSurface>

          {narrative ? (
            <SiteAdminSurface
              title={
                ar
                  ? `تحليل ${narrative.engine === 'ai' ? 'الذكاء الاصطناعي' : 'قواعدي'}`
                  : `${narrative.engine === 'ai' ? 'AI' : 'Rules'} analysis`
              }
            >
              <p className="sa-metric">{ar ? narrative.summaryAr : narrative.summaryEn}</p>
              <div className="sa-ai-columns">
                <div>
                  <h3>{ar ? 'أبرز النقاط' : 'Highlights'}</h3>
                  <ul className="sa-orgs">
                    {narrative.highlights.map((item, index) => (
                      <li key={`h-${index}`}>{ar ? item.ar : item.en}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>{ar ? 'مخاطر للمتابعة' : 'Watchouts'}</h3>
                  <ul className="sa-orgs">
                    {narrative.risks.map((item, index) => (
                      <li key={`r-${index}`}>{ar ? item.ar : item.en}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>{ar ? 'نصائح تسويق' : 'Marketing tips'}</h3>
                  <ul className="sa-orgs">
                    {narrative.marketingTips.map((item, index) => (
                      <li key={`m-${index}`}>{ar ? item.ar : item.en}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </SiteAdminSurface>
          ) : null}

          <SiteAdminSurface title={ar ? 'حسابات العملاء' : 'Client accounts'}>
            <div className="sa-toolbar">
              <input
                className="sa-input"
                type="search"
                value={query}
                placeholder={ar ? 'بحث باسم المنشأة' : 'Search by organization'}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                className="sa-input sa-input--compact"
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as 'income' | 'expense' | 'net' | 'name')
                }
              >
                <option value="income">{ar ? 'ترتيب: الدخل' : 'Sort: income'}</option>
                <option value="expense">{ar ? 'ترتيب: الصرف' : 'Sort: spend'}</option>
                <option value="net">{ar ? 'ترتيب: الصافي' : 'Sort: net'}</option>
                <option value="name">{ar ? 'ترتيب: الاسم' : 'Sort: name'}</option>
              </select>
            </div>
            {accounts.length ? (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الحساب' : 'Account'}</th>
                      <th>{ar ? 'الباقة' : 'Plan'}</th>
                      <th>{ar ? 'الدخل' : 'Income'}</th>
                      <th>{ar ? 'الصرف' : 'Spend'}</th>
                      <th>{ar ? 'الصافي' : 'Net'}</th>
                      <th>{ar ? 'عقارات / وحدات' : 'Props / units'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((row) => (
                      <tr key={row.organizationId}>
                        <td>
                          <strong>{ar ? row.nameAr : row.nameEn || row.nameAr}</strong>
                          <small>
                            {row.members} {ar ? 'أعضاء' : 'members'}
                          </small>
                        </td>
                        <td>
                          <bdi dir="ltr">{row.planKey}</bdi>
                        </td>
                        <td>
                          {omr(row.incomeMinor, ar)}
                          <small>
                            {ar ? 'إيجار' : 'Rent'} {omr(row.rentIncomeMinor, ar)} ·{' '}
                            {ar ? 'إقامة' : 'Stay'} {omr(row.stayIncomeMinor, ar)}
                          </small>
                        </td>
                        <td>{omr(row.expenseMinor, ar)}</td>
                        <td>{omr(row.incomeMinor - row.expenseMinor, ar)}</td>
                        <td>
                          {row.properties} / {row.units}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {ar ? 'لا حسابات مطابقة.' : 'No matching accounts.'}
              </p>
            )}
          </SiteAdminSurface>
        </>
      )}
    </SiteAdminPage>
  );
}
