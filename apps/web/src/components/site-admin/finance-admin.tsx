'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import {
  PLATFORM_LEDGER_KINDS,
  PLATFORM_LEDGER_KIND_LABELS,
  type PlatformAccountingView,
  type PlatformLedgerEntry,
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

type KindFilter = PlatformLedgerKind | 'all' | 'income';

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

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function defaultCategory(kind: PlatformLedgerKind, ar: boolean): string {
  if (kind === 'subscription_in') return ar ? 'اشتراك' : 'Subscription';
  if (kind === 'other_in') return ar ? 'دخل آخر' : 'Other income';
  if (kind === 'expense') return ar ? 'مصروف تشغيل' : 'Operating expense';
  return ar ? 'تسوية' : 'Adjustment';
}

function sumByKind(entries: PlatformLedgerEntry[]) {
  let subscriptionIn = 0;
  let otherIn = 0;
  let expense = 0;
  let adjustment = 0;
  for (const entry of entries) {
    if (entry.status !== 'posted') continue;
    if (entry.kind === 'subscription_in') subscriptionIn += entry.amountMinor;
    else if (entry.kind === 'other_in') otherIn += entry.amountMinor;
    else if (entry.kind === 'expense') expense += entry.amountMinor;
    else if (entry.kind === 'adjustment') adjustment += entry.amountMinor;
  }
  return {
    subscriptionIn,
    otherIn,
    expense,
    adjustment,
    income: subscriptionIn + otherIn,
    net: subscriptionIn + otherIn - expense + adjustment,
  };
}

/** Dedicated desk for platform cash: subscriptions, receipts, other income, expenses. */
export function FinanceAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [view, setView] = useState<PlatformAccountingView | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState(false);

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [query, setQuery] = useState('');
  const [hideVoid, setHideVoid] = useState(true);

  const [kind, setKind] = useState<PlatformLedgerKind>('subscription_in');
  const [category, setCategory] = useState(defaultCategory('subscription_in', ar));
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [organizationId, setOrganizationId] = useState('');

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

  const filtered = useMemo(() => {
    if (!view) return [] as PlatformLedgerEntry[];
    const q = query.trim().toLowerCase();
    return view.ledger.filter((entry) => {
      if (hideVoid && entry.status === 'void') return false;
      if (fromDate && entry.occurredOn < fromDate) return false;
      if (toDate && entry.occurredOn > toDate) return false;
      if (kindFilter === 'income') {
        if (entry.kind !== 'subscription_in' && entry.kind !== 'other_in') return false;
      } else if (kindFilter !== 'all' && entry.kind !== kindFilter) {
        return false;
      }
      if (!q) return true;
      return (
        entry.description.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q) ||
        (entry.reference ?? '').toLowerCase().includes(q) ||
        (entry.organizationNameAr ?? '').toLowerCase().includes(q)
      );
    });
  }, [view, hideVoid, fromDate, toDate, kindFilter, query]);

  const books = useMemo(() => sumByKind(filtered), [filtered]);

  const months = useMemo(() => {
    const map = new Map<
      string,
      { subscriptionIn: number; otherIn: number; expense: number; net: number; count: number }
    >();
    for (const entry of filtered) {
      if (entry.status !== 'posted') continue;
      const key = monthKey(entry.occurredOn);
      const row = map.get(key) ?? {
        subscriptionIn: 0,
        otherIn: 0,
        expense: 0,
        net: 0,
        count: 0,
      };
      row.count += 1;
      if (entry.kind === 'subscription_in') {
        row.subscriptionIn += entry.amountMinor;
        row.net += entry.amountMinor;
      } else if (entry.kind === 'other_in') {
        row.otherIn += entry.amountMinor;
        row.net += entry.amountMinor;
      } else if (entry.kind === 'expense') {
        row.expense += entry.amountMinor;
        row.net -= entry.amountMinor;
      } else if (entry.kind === 'adjustment') {
        row.net += entry.amountMinor;
      }
      map.set(key, row);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 12);
  }, [filtered]);

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
          category: category.trim() || defaultCategory(kind, ar),
          description: description.trim(),
          amountOmr,
          occurredOn,
          reference: reference.trim() || null,
          organizationId: organizationId || null,
        }),
      });
      setDescription('');
      setAmount('');
      setReference('');
      setNotice({
        tone: 'success',
        text: ar ? 'أُضيف القيد إلى دفتر المنصة.' : 'Entry posted to the platform ledger.',
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
        ar ? 'إلغاء هذا القيد؟ لن يُحسب في الإجماليات.' : 'Void this entry? It will leave the totals.',
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

  return (
    <SiteAdminPage
      locale={locale}
      title={ar ? 'أموال المنصة' : 'Platform finance'}
      lead={
        ar
          ? 'دفتر مستقل لاشتراكات المنصة والإيصالات والدخل الآخر والمصروفات — بالتاريخ والمراجع وربط المنشأة.'
          : 'A dedicated ledger for platform subscriptions, receipts, other income, and expenses — by date, receipt, and organization.'
      }
      actions={
        <Link className="button button--quiet" href={`/${locale}/admin/accounting`}>
          {ar ? 'حسابات العملاء ←' : '← Client accounts'}
        </Link>
      }
    >
      <SiteAdminBanner notice={notice} />

      {failed ? (
        <SiteAdminFailed
          locale={locale}
          messageAr="تعذّر تحميل أموال المنصة."
          messageEn="Could not load platform finance."
        />
      ) : view === null ? (
        <SiteAdminLoading locale={locale} />
      ) : (
        <>
          <SiteAdminSurface title={ar ? 'ملخص الصندوق' : 'Cash summary'}>
            <div className="sa-pulse-grid">
              <div className="sa-pulse-card sa-pulse-card--in">
                <span>{ar ? 'تحصيلات الاشتراك' : 'Subscriptions collected'}</span>
                <strong>{omr(books.subscriptionIn, ar)}</strong>
              </div>
              <div className="sa-pulse-card sa-pulse-card--in">
                <span>{ar ? 'دخل آخر' : 'Other income'}</span>
                <strong>{omr(books.otherIn, ar)}</strong>
              </div>
              <div className="sa-pulse-card sa-pulse-card--out">
                <span>{ar ? 'مصروفات المنصة' : 'Platform expenses'}</span>
                <strong>{omr(books.expense, ar)}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'تسويات' : 'Adjustments'}</span>
                <strong>{omr(books.adjustment, ar)}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'صافي المنصة' : 'Platform net'}</span>
                <strong>{omr(books.net, ar)}</strong>
              </div>
              <div className="sa-pulse-card">
                <span>{ar ? 'قيود ظاهرة' : 'Visible entries'}</span>
                <strong>{filtered.length}</strong>
              </div>
            </div>
            <p className="muted sa-footnote">
              {ar
                ? `الإجماليات تتبع الفلاتر أدناه · تقدير اشتراكات الباقات: ${omr(view.pulse.estimatedSubscriptionMonthlyMinor, ar)} / شهر`
                : `Totals follow the filters below · Catalog subscription estimate: ${omr(view.pulse.estimatedSubscriptionMonthlyMinor, ar)} / mo`}
            </p>
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'تسجيل قيد' : 'Post entry'}>
            {!view.ledgerReady ? (
              <p className="muted" style={{ margin: 0 }}>
                {ar
                  ? 'جدول الدفتر قيد التجهيز بعد الترحيل.'
                  : 'Ledger table is still provisioning after migration.'}
              </p>
            ) : (
              <form className="sa-ledger-form" onSubmit={(event) => void addEntry(event)}>
                <label>
                  <span>{ar ? 'النوع' : 'Kind'}</span>
                  <select
                    className="sa-input"
                    value={kind}
                    onChange={(event) => {
                      const next = event.target.value as PlatformLedgerKind;
                      setKind(next);
                      setCategory(defaultCategory(next, ar));
                    }}
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
                    required
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
                  <span>{ar ? 'رقم الإيصال / المرجع' : 'Receipt / reference'}</span>
                  <input
                    className="sa-input"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder={ar ? 'مثال: INV-2026-014' : 'e.g. INV-2026-014'}
                  />
                </label>
                <label className="sa-ledger-form__wide">
                  <span>{ar ? 'المنشأة (اختياري)' : 'Organization (optional)'}</span>
                  <select
                    className="sa-input"
                    value={organizationId}
                    onChange={(event) => setOrganizationId(event.target.value)}
                  >
                    <option value="">{ar ? '— بدون ربط —' : '— Unlinked —'}</option>
                    {view.accounts.map((org) => (
                      <option key={org.organizationId} value={org.organizationId}>
                        {ar ? org.nameAr : org.nameEn || org.nameAr} · {org.planKey}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="button button--primary" disabled={busy}>
                  {ar ? 'حفظ القيد' : 'Save entry'}
                </button>
              </form>
            )}
          </SiteAdminSurface>

          <SiteAdminSurface title={ar ? 'دفتر الأموال' : 'Money ledger'}>
            <div className="sa-toolbar sa-toolbar--wrap">
              <select
                className="sa-input sa-input--compact"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as KindFilter)}
              >
                <option value="all">{ar ? 'كل الأنواع' : 'All kinds'}</option>
                <option value="income">{ar ? 'كل الدخل' : 'All income'}</option>
                {PLATFORM_LEDGER_KINDS.map((item) => (
                  <option key={item} value={item}>
                    {ar
                      ? PLATFORM_LEDGER_KIND_LABELS[item].ar
                      : PLATFORM_LEDGER_KIND_LABELS[item].en}
                  </option>
                ))}
              </select>
              <label className="sa-limit">
                <span>{ar ? 'من' : 'From'}</span>
                <input
                  className="sa-input sa-input--compact"
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </label>
              <label className="sa-limit">
                <span>{ar ? 'إلى' : 'To'}</span>
                <input
                  className="sa-input sa-input--compact"
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </label>
              <input
                className="sa-input"
                type="search"
                value={query}
                placeholder={ar ? 'بحث: وصف / إيصال / منشأة' : 'Search: note / receipt / org'}
                onChange={(event) => setQuery(event.target.value)}
              />
              <label className="sa-check">
                <input
                  type="checkbox"
                  checked={hideVoid}
                  onChange={(event) => setHideVoid(event.target.checked)}
                />
                <span>{ar ? 'إخفاء الملغى' : 'Hide voided'}</span>
              </label>
            </div>

            {filtered.length ? (
              <div className="sa-table-wrap sa-table-wrap--scroll">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'التاريخ' : 'Date'}</th>
                      <th>{ar ? 'النوع' : 'Kind'}</th>
                      <th>{ar ? 'الوصف' : 'Description'}</th>
                      <th>{ar ? 'الإيصال' : 'Receipt'}</th>
                      <th>{ar ? 'المنشأة' : 'Organization'}</th>
                      <th>{ar ? 'المبلغ' : 'Amount'}</th>
                      <th>{ar ? 'الحالة' : 'Status'}</th>
                      <th aria-label={ar ? 'إجراء' : 'Action'} />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry) => {
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
                          <td>{entry.description}</td>
                          <td>
                            {entry.reference ? (
                              <bdi dir="ltr">{entry.reference}</bdi>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>{entry.organizationNameAr || '—'}</td>
                          <td>{omr(entry.amountMinor, ar)}</td>
                          <td>
                            {entry.status === 'void'
                              ? ar
                                ? 'ملغى'
                                : 'Void'
                              : ar
                                ? 'مرحّل'
                                : 'Posted'}
                          </td>
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
              <p className="muted" style={{ margin: 0 }}>
                {ar
                  ? 'لا قيود مطابقة. سجّل تحصيل اشتراك أو مصروف منصة أعلاه.'
                  : 'No matching entries. Post a subscription collection or platform expense above.'}
              </p>
            )}
          </SiteAdminSurface>

          {months.length ? (
            <SiteAdminSurface title={ar ? 'ملخص شهري' : 'Monthly rollup'}>
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>{ar ? 'الشهر' : 'Month'}</th>
                      <th>{ar ? 'اشتراكات' : 'Subscriptions'}</th>
                      <th>{ar ? 'دخل آخر' : 'Other'}</th>
                      <th>{ar ? 'مصروفات' : 'Expenses'}</th>
                      <th>{ar ? 'الصافي' : 'Net'}</th>
                      <th>{ar ? 'قيود' : 'Rows'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map(([month, row]) => (
                      <tr key={month}>
                        <td>
                          <bdi dir="ltr">{month}</bdi>
                        </td>
                        <td>{omr(row.subscriptionIn, ar)}</td>
                        <td>{omr(row.otherIn, ar)}</td>
                        <td>{omr(row.expense, ar)}</td>
                        <td>{omr(row.net, ar)}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SiteAdminSurface>
          ) : null}
        </>
      )}
    </SiteAdminPage>
  );
}
