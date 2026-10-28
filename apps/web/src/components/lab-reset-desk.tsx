'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  LAB_RESET_CATEGORIES,
  LAB_RESET_CONFIRM,
  labResetLabel,
  type LabResetCategory,
  type LabResetCounts,
  type LabResetResult,
} from '@/lib/lab-reset-shared';

const EMPTY: LabResetCounts = {
  tasks: 0,
  accounting: 0,
  leasing: 0,
  bookings: 0,
  stays: 0,
  maintenance: 0,
  legal: 0,
  sales: 0,
  approvals: 0,
};

/** Temporary testing desk: wipe selected transactional data, keep properties/units. */
export function LabResetDesk({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [counts, setCounts] = useState<LabResetCounts | null>(null);
  const [selected, setSelected] = useState<Set<LabResetCategory>>(new Set());
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/site-admin/lab-reset', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { counts: LabResetCounts };
      setCounts(body.counts);
      setFailed(false);
    } catch {
      setFailed(true);
      setCounts(EMPTY);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (category: LabResetCategory) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const selectAllWithData = () => {
    if (!counts) return;
    setSelected(new Set(LAB_RESET_CATEGORIES.filter((category) => (counts[category] ?? 0) > 0)));
  };

  const runPurge = async () => {
    if (!selected.size) {
      setMessage(ar ? 'اختر فئة واحدةً واحدةً على الأقل.' : 'Select at least one category.');
      return;
    }
    if (confirm.trim().toUpperCase() !== LAB_RESET_CONFIRM) {
      setMessage(
        ar ? `اكتب ${LAB_RESET_CONFIRM} للتأكيد.` : `Type ${LAB_RESET_CONFIRM} to confirm.`,
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await browserNextMutation<LabResetResult>('/api/site-admin/lab-reset', {
        method: 'POST',
        body: JSON.stringify({
          categories: [...selected],
          confirm: confirm.trim(),
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const parts = Object.entries(result.deleted ?? {})
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([key, n]) => `${labResetLabel(key as LabResetCategory, locale)}: ${n}`);
      setMessage(
        parts.length
          ? ar
            ? `تم الحذف — ${parts.join(' · ')}`
            : `Deleted — ${parts.join(' · ')}`
          : ar
            ? 'لا صفوف للحذف في الفئات المختارة.'
            : 'Nothing to delete in the selected categories.',
      );
      setConfirm('');
      setSelected(new Set());
      await load();
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      setMessage(
        code === 'forbidden'
          ? ar
            ? 'هذه الأداة لإدارة الموقع فقط.'
            : 'Only site administrators can use this tool.'
          : code === 'invalid_body'
            ? ar
              ? `اكتب ${LAB_RESET_CONFIRM} واختر فئة.`
              : `Type ${LAB_RESET_CONFIRM} and pick a category.`
            : code === 'rate_limited'
              ? ar
                ? 'محاولات كثيرة — انتظر دقيقة ثم أعد المحاولة.'
                : 'Too many attempts — wait a minute and retry.'
              : ar
                ? `تعذر الحذف${code ? ` (${code})` : ''}. أعد المحاولة.`
                : `Could not reset${code ? ` (${code})` : ''}. Try again.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lab-reset" dir={ar ? 'rtl' : 'ltr'}>
      <header className="lab-reset__head">
        <p className="lab-reset__eyebrow">{ar ? 'تجريب مؤقت' : 'Temporary testing'}</p>
        <h1>{ar ? 'إعادة ضبط بيانات التجارب' : 'Reset experimental data'}</h1>
        <p className="lab-reset__lead">
          {ar
            ? 'احذف المعاملات التجريبية التي اخترتها. العقارات والوحدات والصور وإعداد الإقامة اليومية والفريق ودليل الحسابات تبقى كما هي.'
            : 'Delete the experimental transactions you select. Properties, units, photos, stay property setup, team, and the chart of accounts stay.'}
        </p>
        <Link className="button button--quiet" href="/admin" prefetch={false}>
          {ar ? 'العودة لتحكم الموقع' : 'Back to site console'}
        </Link>
      </header>

      {failed ? (
        <p className="lab-reset__warn" role="alert">
          {ar
            ? 'تعذر تحميل العدادات. تأكد أن لديك صلاحية كتابة المنظمة.'
            : 'Could not load counts. You need organization write access.'}
        </p>
      ) : null}

      <div className="lab-reset__list">
        {LAB_RESET_CATEGORIES.map((category) => {
          const n = counts?.[category] ?? 0;
          const on = selected.has(category);
          return (
            <label key={category} className={on ? 'lab-reset__row is-on' : 'lab-reset__row'}>
              <input
                type="checkbox"
                checked={on}
                disabled={busy || !counts}
                onChange={() => toggle(category)}
              />
              <span>
                <strong>{labResetLabel(category, locale)}</strong>
                <em>{counts ? (ar ? `${n} سجل` : `${n} rows`) : ar ? '…' : '…'}</em>
              </span>
            </label>
          );
        })}
      </div>

      <div className="lab-reset__actions">
        <button
          type="button"
          className="button button--quiet"
          disabled={busy || !counts}
          onClick={selectAllWithData}
        >
          {ar ? 'تحديد كل ما فيه بيانات' : 'Select all with data'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={busy || !selected.size}
          onClick={() => setSelected(new Set())}
        >
          {ar ? 'إلغاء التحديد' : 'Clear selection'}
        </button>
      </div>

      <label className="lab-reset__confirm">
        <span>
          {ar
            ? `للتأكيد اكتب ${LAB_RESET_CONFIRM} ثم نفّذ الحذف`
            : `Type ${LAB_RESET_CONFIRM} then run the delete`}
        </span>
        <input
          value={confirm}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          placeholder={LAB_RESET_CONFIRM}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="button button--primary lab-reset__danger"
        disabled={busy || !selected.size || confirm.trim().toUpperCase() !== LAB_RESET_CONFIRM}
        onClick={() => void runPurge()}
      >
        {busy
          ? ar
            ? 'جارٍ الحذف…'
            : 'Deleting…'
          : ar
            ? 'حذف الفئات المحددة نهائياً'
            : 'Permanently delete selected categories'}
      </button>

      {message ? (
        <p className="lab-reset__msg" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
