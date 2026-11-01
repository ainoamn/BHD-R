'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import {
  PLATFORM_LEDGER_KINDS,
  PLATFORM_LEDGER_KIND_LABELS,
  type PlatformAccountingNarrative,
  type PlatformAccountingView,
  type PlatformLedgerKind,
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

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Platform accounting desk: client money pulse, accounts, site ledger, AI analysis. */
export function AccountingAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [view, setView] = useState<PlatformAccountingView | null>(null);
  const [narrative, setNarrative] = useState<PlatformAccountingNarrative | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'income' | 'expense' | 'net' | 'name'>('income');

  const [kind, setKind] = useState<PlatformLedgerKind>('subscription_in');
  const [category, setCategory] = useState(ar ? 'اشتراك' : 'Subscription');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [reference, setReference] = useState('');

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

  async function addEntry(event: React.FormEvent) {
    event.preventDefault();
    const amountOmr = Number(amount);
    if (!description.trim() || !Number.isFinite(amountOmr) || amountOmr <= 0) {
      setNotice({
        tone: 'error',
        text: ar ? 'أدخل وصفاً ومبلغاً صحيحاً.' : 'Enter a description and a valid amount.',
      });
      return;
    }
    setBusy(true);
    try {
      await browserNextMutation('/api/site-admin/accounting', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          category: category.trim() || (ar ? 'عام' : 'General'),
          description: description.trim(),
          amountOmr,
          occurredOn,
          reference: reference.trim() || null,
        }),
      });
      setDescription('');
      setAmount('');
      setReference('');
      setNotice({
        tone: 'success',
        text: ar ? 'أُضيف القيد إلى دفتر الموقع.' : 'Ledger entry posted.',
      });
      load();
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر حفظ القيد.', 'Could not save the entry.'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function voidEntry(entryId: string) {
    if (
      !window.confirm(
        ar ? 'إلغاء هذا القيد؟' : 'Void this ledger entry?',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await browserNextMutation('/api/site-admin/accounting', {
        method: 'POST',
        body: JSON.stringify({ entryId, void: true }),
      });
      setNotice({
        tone: 'success',
        text: ar ? 'أُلغي القيد.' : 'Entry voided.',
      });
      load();
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الإلغاء.', 'Could not void.'),
      });
    } finally {
      setBusy(false);
    }
  }

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
      title={ar ? 'محاسبة المنصة' : 'Platform accounting'}
      lead={
        ar
          ? 'دخل وصرف حسابات العملاء، تحصيلات الاشتراك ومصروفات الموقع، ونبض المنصة للتسويق — مع تحليل وفرز بالذكاء الاصطناعي.'
          : 'Client account income and spend, site subscription collections and expenses, and a marketing pulse — with AI analysis and ranking.'
      }
      actions={
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
          <SiteAdminSurface title={ar ? 'نبض المنصة' : 'Platform pulse'}>
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
                <span>{ar ? 'تحصيلات الموقع' : 'Site collections'}</span>
                <strong>{omr(view.pulse.siteIncomeMinor, ar)}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'مصروفات الموقع' : 'Site expenses'}</span>
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
                ? `آخر تحديث: ${adminDate(view.generatedAt, ar)} · دخل العملاء من إيجارات وإقامات ناجحة؛ الصرف من مصروفات المنشآت المسجّلة.`
                : `Updated: ${adminDate(view.generatedAt, ar)} · Client income from succeeded rent/stay payments; spend from recorded org expenses.`}
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

          <SiteAdminSurface title={ar ? 'دفتر الموقع' : 'Site ledger'}>
            {!view.ledgerReady ? (
              <p className="muted" style={{ margin: 0 }}>
                {ar
                  ? 'جدول الدفتر قيد التجهيز بعد الترحيل. ستظهر القيود هنا تلقائياً.'
                  : 'Ledger table is provisioning after migration. Entries will appear here automatically.'}
              </p>
            ) : (
              <>
                <form className="sa-ledger-form" onSubmit={(event) => void addEntry(event)}>
                  <label>
                    <span>{ar ? 'النوع' : 'Kind'}</span>
                    <select
                      className="sa-input"
                      value={kind}
                      onChange={(event) => setKind(event.target.value as PlatformLedgerKind)}
                    >
                      {PLATFORM_LEDGER_KINDS.map((item) => (
                        <option key={item} value={item}>
                          {ar
                            ? PLATFORM_LEDGER_KIND_LABELS[item].ar
                            : PLATFORM_LEDGER_KIND_LABELS[item].en}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{ar ? 'التصنيف' : 'Category'}</span>
                    <input
                      className="sa-input"
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                    />
                  </label>
                  <label className="sa-ledger-form__wide">
                    <span>{ar ? 'الوصف' : 'Description'}</span>
                    <input
                      className="sa-input"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    <span>{ar ? 'المبلغ (ر.ع.)' : 'Amount (OMR)'}</span>
                    <input
                      className="sa-input"
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    <span>{ar ? 'التاريخ' : 'Date'}</span>
                    <input
                      className="sa-input"
                      type="date"
                      value={occurredOn}
                      onChange={(event) => setOccurredOn(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    <span>{ar ? 'مرجع' : 'Reference'}</span>
                    <input
                      className="sa-input"
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="button button--primary" disabled={busy}>
                    {ar ? 'إضافة قيد' : 'Post entry'}
                  </button>
                </form>

                {view.ledger.length ? (
                  <div className="sa-table-wrap" style={{ marginTop: '1rem' }}>
                    <table className="sa-table">
                      <thead>
                        <tr>
                          <th>{ar ? 'التاريخ' : 'Date'}</th>
                          <th>{ar ? 'النوع' : 'Kind'}</th>
                          <th>{ar ? 'الوصف' : 'Description'}</th>
                          <th>{ar ? 'المبلغ' : 'Amount'}</th>
                          <th>{ar ? 'الحالة' : 'Status'}</th>
                          <th aria-label={ar ? 'إجراء' : 'Action'} />
                        </tr>
                      </thead>
                      <tbody>
                        {view.ledger.map((entry) => {
                          const label = PLATFORM_LEDGER_KIND_LABELS[entry.kind];
                          return (
                            <tr
                              key={entry.id}
                              className={entry.status === 'void' ? 'is-off' : undefined}
                            >
                              <td>{adminDate(entry.occurredOn, ar)}</td>
                              <td>
                                <span className={`pmh-badge pmh-badge--${label.tone}`}>
                                  {ar ? label.ar : label.en}
                                </span>
                                <small>{entry.category}</small>
                              </td>
                              <td>
                                {entry.description}
                                {entry.organizationNameAr ? (
                                  <small>{entry.organizationNameAr}</small>
                                ) : null}
                                {entry.reference ? (
                                  <small>
                                    <bdi dir="ltr">{entry.reference}</bdi>
                                  </small>
                                ) : null}
                              </td>
                              <td>{omr(entry.amountMinor, ar)}</td>
                              <td>{entry.status}</td>
                              <td>
                                {entry.status !== 'void' ? (
                                  <button
                                    type="button"
                                    className="button button--quiet button--small"
                                    disabled={busy}
                                    onClick={() => void voidEntry(entry.id)}
                                  >
                                    {ar ? 'إلغاء' : 'Void'}
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted" style={{ marginTop: '0.85rem' }}>
                    {ar
                      ? 'لا قيود بعد. سجّل تحصيلات الاشتراك ومصروفات الاستضافة والإعلان هنا.'
                      : 'No entries yet. Record subscription collections and hosting/ads expenses here.'}
                  </p>
                )}
              </>
            )}
          </SiteAdminSurface>
        </>
      )}
    </SiteAdminPage>
  );
}
