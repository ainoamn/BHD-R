'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { browserMediaPut, browserMutation } from '@/lib/api';

function formText(form: FormData, name: string): string {
  const entry = form.get(name);
  return typeof entry === 'string' ? entry.trim() : '';
}

interface Requirement {
  id: string;
  code: string;
  labelAr: string;
  labelEn: string;
  required: boolean;
  status: string;
  dueAt: string | null;
  notes: string | null;
}

interface ReservationDocument {
  id: string;
  requirementId: string | null;
  mediaAssetId: string;
  documentType: string;
  status: string;
  reviewNotes: string | null;
  reviewedAt: string | null;
  submittedAt: string;
  mimeType: string;
  processingStatus: string;
  scanStatus: string;
}

export interface ReservationCompliance {
  reservation: {
    id: string;
    unitId: string;
    tenantPartyId: string;
    status: string;
    startsAt: string;
    expiresAt: string;
    convertedLeaseId: string | null;
  };
  requirements: Requirement[];
  documents: ReservationDocument[];
}

interface UploadIntent {
  assetId: string;
  uploadUrl: string;
  uploadPath?: string;
  requiredHeaders?: Record<string, string>;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function ReservationComplianceManager({
  compliance,
  locale,
  portal,
}: {
  compliance: ReservationCompliance;
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer' | 'tenant';
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const staff = portal !== 'tenant';
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approved = compliance.requirements.filter(
    (item) => !item.required || ['approved', 'waived'].includes(item.status),
  ).length;

  function pickFile(requirementId: string, event: ChangeEvent<HTMLInputElement>) {
    setFiles((current) => ({ ...current, [requirementId]: event.target.files?.[0] }));
  }

  async function upload(requirement: Requirement) {
    const file = files[requirement.id];
    if (!file) return;
    if (
      !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 25 * 1024 * 1024
    ) {
      setError(ar ? 'نوع الملف أو حجمه غير مسموح.' : 'File type or size is not allowed.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const intent = await browserMutation<UploadIntent>('/v1/media/reservation-upload-intents', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: compliance.reservation.id,
          mimeType: file.type,
          byteSize: file.size,
        }),
      });
      await browserMediaPut(intent, file);
      await browserMutation(`/v1/media/${intent.assetId}/complete-reservation`, {
        method: 'POST',
        body: JSON.stringify({
          reservationId: compliance.reservation.id,
          sha256: await sha256(file),
        }),
      });
      await browserMutation(`/v1/leasing/reservations/${compliance.reservation.id}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          requirementId: requirement.id,
          mediaAssetId: intent.assetId,
          documentType: requirement.code,
        }),
      });
      setFiles((current) => ({ ...current, [requirement.id]: undefined }));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function review(document: ReservationDocument, decision: 'approved' | 'rejected') {
    setBusy(true);
    setError(null);
    try {
      await browserMutation(`/v1/leasing/reservation-documents/${document.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(document: ReservationDocument) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/v1/media/${document.mediaAssetId}/reservation-document`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error('document_not_ready');
      const payload = (await response.json()) as { url: string };
      window.open(payload.url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function addRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const dueAt = formText(form, 'dueAt');
    setBusy(true);
    setError(null);
    try {
      await browserMutation(`/v1/leasing/reservations/${compliance.reservation.id}/requirements`, {
        method: 'POST',
        body: JSON.stringify({
          code: formText(form, 'code'),
          labelAr: formText(form, 'labelAr'),
          labelEn: formText(form, 'labelEn'),
          required: form.get('required') === 'on',
          ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        }),
      });
      event.currentTarget.reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-shell compliance-manager">
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · BOOKING COMPLIANCE</span>
          <h1>{ar ? 'ملف الحجز والمستندات' : 'Reservation & documents'}</h1>
          <p>
            {ar
              ? 'التحقق من المتطلبات قبل تحويل الحجز إلى عقد إيجار.'
              : 'Verify every required item before converting the reservation to a lease.'}
          </p>
        </div>
        <a
          className="button button--quiet"
          href={`/${locale}/${portal}/${portal === 'tenant' ? 'reservations' : 'bookings'}`}
        >
          {ar ? 'العودة' : 'Back'}
        </a>
      </header>

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="ops-metrics" aria-label={ar ? 'ملخص الحجز' : 'Reservation summary'}>
        <article>
          <span>{ar ? 'حالة الحجز' : 'Reservation status'}</span>
          <strong>{compliance.reservation.status}</strong>
          <small>{compliance.reservation.id.slice(0, 8)}</small>
        </article>
        <article>
          <span>{ar ? 'المتطلبات المكتملة' : 'Completed requirements'}</span>
          <strong>
            {approved}/{compliance.requirements.length}
          </strong>
          <small>{ar ? 'يشمل البنود غير الإلزامية' : 'Includes optional items'}</small>
        </article>
        <article>
          <span>{ar ? 'المستندات' : 'Documents'}</span>
          <strong>{compliance.documents.length}</strong>
          <small>{ar ? 'تفحص ضد البرمجيات الخبيثة' : 'Malware scanned'}</small>
        </article>
        <article className="ops-metric--accent">
          <span>{ar ? 'جاهزية التحويل' : 'Conversion readiness'}</span>
          <strong>
            {approved === compliance.requirements.length
              ? ar
                ? 'جاهز'
                : 'Ready'
              : ar
                ? 'غير مكتمل'
                : 'Incomplete'}
          </strong>
          <small>{ar ? 'لا عقد قبل الاعتماد' : 'Contract blocked until approval'}</small>
        </article>
      </section>

      <section className="ops-panel">
        <header className="section-heading">
          <div>
            <span className="eyebrow">01</span>
            <h2>{ar ? 'قائمة المتطلبات' : 'Requirement checklist'}</h2>
          </div>
        </header>
        <div className="compliance-list">
          {compliance.requirements.map((requirement) => {
            const documents = compliance.documents.filter(
              (document) => document.requirementId === requirement.id,
            );
            return (
              <article className="compliance-item" key={requirement.id}>
                <header>
                  <div>
                    <strong>{ar ? requirement.labelAr : requirement.labelEn}</strong>
                    <small>
                      {requirement.code} ·{' '}
                      {requirement.required
                        ? ar
                          ? 'إلزامي'
                          : 'Required'
                        : ar
                          ? 'اختياري'
                          : 'Optional'}
                    </small>
                  </div>
                  <span className="status-pill">{requirement.status}</span>
                </header>
                <div className="compliance-documents">
                  {documents.map((document) => (
                    <div className="compliance-document" key={document.id}>
                      <div>
                        <strong>{document.documentType}</strong>
                        <small>
                          {document.processingStatus} · {document.scanStatus} · {document.status}
                        </small>
                      </div>
                      <span className="ops-inline-actions">
                        {document.processingStatus === 'ready' &&
                        document.scanStatus === 'clean' ? (
                          <button
                            className="ops-action"
                            type="button"
                            disabled={busy}
                            onClick={() => void openDocument(document)}
                          >
                            {ar ? 'عرض آمن' : 'Secure view'}
                          </button>
                        ) : null}
                        {staff && document.status === 'submitted' ? (
                          <>
                            <button
                              className="ops-action"
                              type="button"
                              disabled={busy || document.scanStatus !== 'clean'}
                              onClick={() => void review(document, 'approved')}
                            >
                              {ar ? 'اعتماد' : 'Approve'}
                            </button>
                            <button
                              className="ops-action ops-action--danger"
                              type="button"
                              disabled={busy}
                              onClick={() => void review(document, 'rejected')}
                            >
                              {ar ? 'رفض' : 'Reject'}
                            </button>
                          </>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
                {!['approved', 'waived'].includes(requirement.status) &&
                ['pending', 'confirmed'].includes(compliance.reservation.status) ? (
                  <div className="compliance-upload">
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(event) => pickFile(requirement.id, event)}
                    />
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={busy || !files[requirement.id]}
                      onClick={() => void upload(requirement)}
                    >
                      {busy
                        ? ar
                          ? 'جارٍ الرفع…'
                          : 'Uploading…'
                        : ar
                          ? 'رفع المستند'
                          : 'Upload document'}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {staff ? (
        <section className="ops-panel">
          <header className="section-heading">
            <div>
              <span className="eyebrow">02</span>
              <h2>{ar ? 'إضافة متطلب' : 'Add requirement'}</h2>
            </div>
          </header>
          <form className="form-grid" onSubmit={(event) => void addRequirement(event)}>
            <label className="field">
              <span>{ar ? 'الرمز' : 'Code'}</span>
              <input className="input" name="code" pattern="[a-z0-9_-]+" required />
            </label>
            <label className="field">
              <span>{ar ? 'المسمى العربي' : 'Arabic label'}</span>
              <input className="input" name="labelAr" required />
            </label>
            <label className="field">
              <span>{ar ? 'المسمى الإنجليزي' : 'English label'}</span>
              <input className="input" name="labelEn" required />
            </label>
            <label className="field">
              <span>{ar ? 'الموعد النهائي' : 'Due date'}</span>
              <input className="input" name="dueAt" type="datetime-local" />
            </label>
            <label className="checkbox-row">
              <input name="required" type="checkbox" defaultChecked />
              {ar ? 'متطلب إلزامي' : 'Required item'}
            </label>
            <div className="form-actions span-2">
              <span />
              <button className="button button--primary" type="submit" disabled={busy}>
                {ar ? 'إضافة' : 'Add'}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
