'use client';

import { useState } from 'react';
import type { LeasingReportSnapshot } from '@/lib/leasing-report-neon';

type LeasingPdfOrientation = 'portrait' | 'landscape';

function stamp(iso: string, ar: boolean): string {
  return new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Formal leasing list report: letterhead, sealed QR, real PDF (portrait/landscape), Excel.
 */
export function LeasingOpsReportView({
  locale,
  snapshot,
  verifyUrl,
  qrSvg,
  mode,
}: {
  locale: 'ar' | 'en';
  snapshot: LeasingReportSnapshot;
  verifyUrl: string;
  qrSvg: string;
  mode: 'owner' | 'verify';
}) {
  const ar = locale === 'ar';
  const [busy, setBusy] = useState<'xlsx' | LeasingPdfOrientation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: 'xlsx' | 'pdf', orientation?: LeasingPdfOrientation) {
    setBusy(format === 'pdf' ? (orientation ?? 'portrait') : 'xlsx');
    setError(null);
    try {
      const params = new URLSearchParams({
        token: snapshot.token,
        format,
      });
      if (format === 'pdf') params.set('orientation', orientation ?? 'portrait');
      const response = await fetch(`/api/owner/leasing/report?${params}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('download_failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stampDay = snapshot.issuedAt.slice(0, 10);
      anchor.href = url;
      anchor.download =
        format === 'pdf'
          ? `bhd-r-leasing-${stampDay}-${orientation ?? 'portrait'}.pdf`
          : `bhd-r-leasing-${stampDay}.xlsx`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } catch {
      setError(
        format === 'pdf'
          ? ar
            ? 'تعذّر تنزيل ملف PDF.'
            : 'Could not download the PDF file.'
          : ar
            ? 'تعذّر تنزيل ملف Excel.'
            : 'Could not download the Excel file.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="leasing-report" dir={ar ? 'rtl' : 'ltr'}>
      {mode === 'owner' ? (
        <div className="leasing-report__toolbar no-print">
          <div
            className="leasing-report__pdf-group"
            role="group"
            aria-label={ar ? 'تنزيل PDF' : 'Download PDF'}
          >
            <span className="leasing-report__pdf-label">
              {ar ? 'تنزيل PDF رسمي' : 'Official PDF download'}
            </span>
            <button
              type="button"
              className="button button--primary"
              disabled={busy !== null}
              onClick={() => void download('pdf', 'portrait')}
            >
              {busy === 'portrait'
                ? ar
                  ? 'جارٍ التجهيز…'
                  : 'Preparing…'
                : ar
                  ? 'طولي (Portrait)'
                  : 'Portrait'}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy !== null}
              onClick={() => void download('pdf', 'landscape')}
            >
              {busy === 'landscape'
                ? ar
                  ? 'جارٍ التجهيز…'
                  : 'Preparing…'
                : ar
                  ? 'عرضي (Landscape)'
                  : 'Landscape'}
            </button>
          </div>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy !== null}
            onClick={() => void download('xlsx')}
          >
            {busy === 'xlsx'
              ? ar
                ? 'جارٍ التنزيل…'
                : 'Downloading…'
              : ar
                ? 'تنزيل Excel'
                : 'Download Excel'}
          </button>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="leasing-report__hint muted">
            {ar
              ? 'الملف يُنزَّل كـ PDF حقيقي بحجم A4 متناسق — اختر طولي للجداول القصيرة أو عرضي لأعمدة أوضح.'
              : 'Downloads a real A4 PDF — choose portrait for short lists or landscape for clearer columns.'}
          </p>
        </div>
      ) : null}

      <article className="leasing-report__sheet">
        <header className="leasing-report__head">
          <div className="leasing-report__brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bhd-email-logo.png" alt="BHD R" width={160} height={48} />
            <div>
              <p className="ops-kicker">BHD R · {ar ? 'تقرير رسمي' : 'Official report'}</p>
              <h1>{snapshot.title}</h1>
              <p>
                {ar ? 'تاريخ الإصدار' : 'Issued'} · {stamp(snapshot.issuedAt, ar)}
                {snapshot.byName ? ` · ${snapshot.byName}` : ''}
              </p>
              <p>
                {snapshot.rowCount} {ar ? 'سجل' : 'rows'} · <span dir="ltr">{snapshot.token}</span>
              </p>
            </div>
          </div>
          <figure className="leasing-report__qr">
            <span
              role="img"
              aria-label={ar ? 'باركود التحقق' : 'Verification barcode'}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <figcaption>
              {ar ? 'امسح للتحقق من صحة التقرير' : 'Scan to verify this report'}
            </figcaption>
          </figure>
        </header>

        {mode === 'verify' ? (
          <p className="notice notice--success" role="status">
            {ar
              ? 'تم التحقق: هذا التقرير صادر من منصة BHD R ولم يُعدَّل منذ إصداره.'
              : 'Verified: this report was issued by BHD R and has not been altered since issue.'}
          </p>
        ) : null}

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {(ar
                  ? [
                      'العقد',
                      'المبنى',
                      'الوحدة',
                      'المالك',
                      'المستأجر',
                      'الحالة',
                      'البداية',
                      'النهاية',
                      'الإيجار',
                    ]
                  : [
                      'Contract',
                      'Building',
                      'Unit',
                      'Owner',
                      'Tenant',
                      'Status',
                      'Starts',
                      'Ends',
                      'Rent',
                    ]
                ).map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row, index) => (
                <tr key={`${row.reference}-${index}`}>
                  <td dir="ltr">{row.reference || '—'}</td>
                  <td>{row.property || '—'}</td>
                  <td dir="ltr">{row.unit || '—'}</td>
                  <td>{row.owner || '—'}</td>
                  <td>{row.tenant || '—'}</td>
                  <td>{row.state || '—'}</td>
                  <td dir="ltr">{row.startsOn || '—'}</td>
                  <td dir="ltr">{row.endsOn || '—'}</td>
                  <td dir="ltr">{row.rent || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="leasing-report__foot">
          <p>
            {ar
              ? 'التحقق العام عبر مسح الباركود أو فتح الرابط:'
              : 'Public verification via the barcode or this link:'}{' '}
            <a href={verifyUrl} dir="ltr">
              {verifyUrl}
            </a>
          </p>
          <p className="muted">
            {ar
              ? 'صدر إلكترونياً من منصة BHD R — بن حمود للتطوير. أي تعديل على البيانات يُبطل رمز التحقق.'
              : 'Issued electronically by BHD R — Bin Hamood Development. Any change to the data voids the verification code.'}
          </p>
        </footer>
      </article>
    </div>
  );
}
