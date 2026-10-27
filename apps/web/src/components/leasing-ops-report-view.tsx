'use client';

import { useState } from 'react';
import type { LeasingReportSnapshot } from '@/lib/leasing-report-neon';

function stamp(iso: string, ar: boolean): string {
  return new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Formal leasing list report: letterhead, sealed QR for public verify, Excel download,
 * and browser print (Save as PDF).
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadExcel() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/owner/leasing/report?token=${encodeURIComponent(snapshot.token)}&format=xlsx`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!response.ok) throw new Error('download_failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bhd-r-leasing-${snapshot.issuedAt.slice(0, 10)}.xlsx`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } catch {
      setError(ar ? 'تعذّر تنزيل ملف Excel.' : 'Could not download the Excel file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="leasing-report" dir={ar ? 'rtl' : 'ltr'}>
      <style>{`
        @media print {
          .leasing-report__toolbar, .site-header, .site-footer, .portal-nav { display: none !important; }
          .leasing-report { box-shadow: none; border: 0; }
          body { background: white; }
        }
      `}</style>
      {mode === 'owner' ? (
        <div className="leasing-report__toolbar no-print">
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.print()}
          >
            {ar ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => void downloadExcel()}
          >
            {busy ? (ar ? 'جارٍ التنزيل…' : 'Downloading…') : ar ? 'تنزيل Excel' : 'Download Excel'}
          </button>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
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
                {snapshot.rowCount} {ar ? 'سجل' : 'rows'} ·{' '}
                <span dir="ltr">{snapshot.token}</span>
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
