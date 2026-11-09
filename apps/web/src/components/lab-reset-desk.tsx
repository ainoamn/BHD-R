'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, browserNextMutation, fetchBrowserCsrfToken } from '@/lib/api';
import {
  LAB_RESET_CATEGORIES,
  LAB_RESET_CONFIRM,
  labResetLabel,
  type LabResetCategory,
  type LabResetCounts,
  type LabResetResult,
} from '@/lib/lab-reset-shared';
import { adminGet } from '@/components/site-admin/admin-fetch';
import {
  SiteAdminBanner,
  SiteAdminPage,
  SiteAdminSurface,
} from '@/components/site-admin/site-admin-page';

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
  notifications: 0,
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
      const body = await adminGet<{ counts: LabResetCounts }>('/api/site-admin/lab-reset');
      setCounts(body.counts ?? EMPTY);
      setFailed(false);
    } catch {
      setFailed(true);
      setCounts(EMPTY);
    }
  }, []);

  useEffect(() => {
    void load();
    // Warm Vercel CSRF so the purge POST does not pay a cold-start on /api/auth/csrf.
    void fetchBrowserCsrfToken(true).catch(() => undefined);
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
    const selectedList = [...selected];
    const selectableTotal = selectedList.reduce((sum, key) => sum + (counts?.[key] ?? 0), 0);
    if (counts && selectableTotal === 0) {
      setMessage(
        ar ? 'لا صفوف للحذف في الفئات المختارة.' : 'Nothing to delete in the selected categories.',
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      // Stay under the route maxDuration (60s) so a killed function is not reported as network_error.
      const result = await browserNextMutation<LabResetResult>('/api/site-admin/lab-reset', {
        method: 'POST',
        body: JSON.stringify({
          categories: selectedList,
          confirm: confirm.trim(),
        }),
        signal: AbortSignal.timeout(55_000),
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
      const detail = error instanceof ApiError ? error.message : '';
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
              : code === 'csrf_timeout' || code === 'csrf_unavailable' || code === 'csrf_rejected'
                ? detail ||
                  (ar
                    ? 'رمز الحماية غير جاهز — حدّث الصفحة وأعد المحاولة.'
                    : 'Security token not ready — refresh and retry.')
                : code === 'network_error' || code === 'api_unreachable'
                  ? detail ||
                    (ar
                      ? 'تعذر الاتصال أثناء الحذف. حدّث الصفحة وأعد المحاولة.'
                      : 'Could not reach the server. Refresh and retry.')
                  : ar
                    ? `تعذر الحذف${code ? ` (${code})` : ''}. أعد المحاولة.`
                    : `Could not reset${code ? ` (${code})` : ''}. Try again.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SiteAdminPage
      locale={locale}
      title={ar ? 'إعادة ضبط بيانات التجارب' : 'Reset experimental data'}
      lead={
        ar
          ? 'احذف المعاملات التجريبية التي اخترتها. عند مسح الإيجارات أو الحجوزات يُفرَّغ أيضاً طابور الإيميل/الواتساب حتى تتوقف تذكيرات التجديد والمتأخرات. العقارات والوحدات والصور وإعداد الإقامة اليومية والفريق ودليل الحسابات تبقى كما هي.'
          : 'Delete the experimental transactions you select. Wiping leases or bookings also clears the email/WhatsApp queue so renewal and arrears reminders stop. Properties, units, photos, stay property setup, team, and the chart of accounts stay.'
      }
      actions={
        <Link className="button button--quiet" href="/admin" prefetch={false}>
          {ar ? 'العودة للنظرة العامة' : 'Back to overview'}
        </Link>
      }
    >
      <SiteAdminBanner
        notice={
          failed
            ? {
                tone: 'error',
                text: ar
                  ? 'تعذر تحميل العدادات. تأكد أن لديك صلاحية كتابة المنظمة.'
                  : 'Could not load counts. You need organization write access.',
              }
            : message
              ? { tone: message.startsWith('تم') || message.startsWith('Deleted') || message.startsWith('لا') || message.startsWith('Nothing') ? 'success' : 'error', text: message }
              : null
        }
      />
      <SiteAdminSurface title={ar ? 'الفئات' : 'Categories'}>
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
      </SiteAdminSurface>
    </SiteAdminPage>
  );
}
