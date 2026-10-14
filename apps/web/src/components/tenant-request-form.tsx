'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { compressPhoto } from '@/components/stays/stay-handover-form';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';
import { arrearsLabel, type ArrearsCategory } from '@/lib/tenant-ledger';
import {
  EMERGENCY_SCOPES,
  TENANT_REQUEST_PHOTOS_MAX,
  TENANT_REQUEST_TYPES,
  emergencyScopeLabel,
  isTenantReport,
  requestNeedsCheque,
  requestNeedsDate,
  requestTakesPhotos,
  tenantRequestErrorText,
  tenantRequestTypeHint,
  tenantRequestTypeLabel,
  type EmergencyScope,
  type TenantRequestType,
} from '@/lib/tenant-requests-shared';

export type RequestCheque = {
  id: string;
  number: string;
  dueOn: string;
  amountMinor: string;
};

export type RequestLease = {
  id: string;
  label: string;
  currency: string;
  cheques: RequestCheque[];
  /** Ordinary maintenance waits until these arrears are settled (the landlord's rule). */
  maintenanceBlocked: boolean;
  arrearsMinor: string;
  arrears: Array<{ category: ArrearsCategory; amountMinor: string }>;
};

type Photo = { data: string; takenAt: string; source: 'camera' | 'device' };

function RequestPhotos({
  ar,
  photos,
  onChange,
}: {
  ar: boolean;
  photos: Photo[];
  onChange: (photos: Photo[]) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = photos.length >= TENANT_REQUEST_PHOTOS_MAX;

  async function add(files: FileList | null, source: Photo['source']) {
    const picked = [...(files ?? [])].filter((file) => file.type.startsWith('image/'));
    const room = TENANT_REQUEST_PHOTOS_MAX - photos.length;
    if (!picked.length || room <= 0) return;
    setReading(true);
    setError(null);
    try {
      const added: Photo[] = [];
      for (const file of picked.slice(0, room)) {
        added.push({
          data: await compressPhoto(file, HANDOVER_PHOTO_MAX),
          takenAt: new Date(source === 'camera' ? Date.now() : file.lastModified).toISOString(),
          source,
        });
      }
      onChange([...photos, ...added].slice(0, TENANT_REQUEST_PHOTOS_MAX));
    } catch {
      setError(ar ? 'تعذّرت قراءة إحدى الصور.' : 'A photo could not be read.');
    } finally {
      setReading(false);
    }
  }

  return (
    <fieldset className="tenant-request-form__photos">
      <legend>
        {ar
          ? `صور توضّح المشكلة (حتى ${TENANT_REQUEST_PHOTOS_MAX})`
          : `Photos of the problem (up to ${TENANT_REQUEST_PHOTOS_MAX})`}
      </legend>
      <div className="tenant-request-form__actions">
        <button
          type="button"
          className="button button--quiet button--tiny"
          disabled={reading || full}
          onClick={() => cameraRef.current?.click()}
        >
          {ar ? 'تصوير' : 'Take photo'}
        </button>
        <button
          type="button"
          className="button button--quiet button--tiny"
          disabled={reading || full}
          onClick={() => deviceRef.current?.click()}
        >
          {ar ? 'من الجهاز' : 'From device'}
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            void add(event.target.files, 'camera');
            event.target.value = '';
          }}
        />
        <input
          ref={deviceRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void add(event.target.files, 'device');
            event.target.value = '';
          }}
        />
      </div>
      {photos.length ? (
        <div className="handover-shots">
          {photos.map((photo, index) => (
            <figure key={photo.takenAt + index} className="handover-shots__item">
              <img src={photo.data} alt="" />
              <button
                type="button"
                className="file-link-button"
                onClick={() => onChange(photos.filter((_, at) => at !== index))}
              >
                {ar ? 'إزالة' : 'Remove'}
              </button>
            </figure>
          ))}
        </div>
      ) : null}
      {reading ? <small className="muted">{ar ? 'جارٍ تجهيز الصور…' : 'Preparing…'}</small> : null}
      {error ? <p className="notice notice--error">{error}</p> : null}
    </fieldset>
  );
}

/** What the tenant owes on the lease, shown before ordinary maintenance can be requested. */
function ArrearsGate({
  ar,
  locale,
  lease,
}: {
  ar: boolean;
  locale: 'ar' | 'en';
  lease: RequestLease;
}) {
  const money = (minor: string) => formatMoney(minor, lease.currency, locale);
  return (
    <div className="tenant-request-form__arrears" role="note">
      <strong>
        {ar
          ? `عليك مبالغ متأخرة بقيمة ${money(lease.arrearsMinor)} — يجب تسويتها أولاً`
          : `You owe ${money(lease.arrearsMinor)} in arrears — settle them first`}
      </strong>
      <ul>
        {lease.arrears.map((item) => (
          <li key={item.category}>
            <span>{arrearsLabel(item.category, ar)}</span>
            <b>{money(item.amountMinor)}</b>
          </li>
        ))}
      </ul>
      <p>
        {ar
          ? 'حسب سياسة إدارة العقار تُفتح لك طلبات الصيانة العادية بعد تسوية هذه المبالغ. إن كانت المشكلة تخص سلامة المبنى أو القاطنين فاختر «طلب مستعجل» أدناه، وستتحقق الإدارة من صحته.'
          : 'Under the property management’s rule, ordinary maintenance opens once these are settled. If the problem concerns the building’s or occupants’ safety, choose “urgent request” below; management will verify it.'}
      </p>
      <Link className="button button--quiet button--tiny" href="/tenant/invoices">
        {ar ? 'عرض كشف الحساب والمتأخرات' : 'View statement and arrears'}
      </Link>
    </div>
  );
}

/**
 * Opens the request form for one lease (or lets the tenant pick one) with the type preset, e.g.
 * "postpone this cheque" from a statement row. The request goes straight to the landlord.
 */
export function TenantRequestLauncher({
  locale,
  leases,
  leaseId,
  type,
  chequeId,
  label,
  className = 'button button--quiet button--tiny',
}: {
  locale: 'ar' | 'en';
  leases: RequestLease[];
  leaseId?: string;
  type?: TenantRequestType;
  chequeId?: string;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!leases.length) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <TenantRequestDialog
          locale={locale}
          leases={leases}
          leaseId={leaseId}
          type={type}
          chequeId={chequeId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function TenantRequestDialog({
  locale,
  leases,
  leaseId: initialLease,
  type: initialType,
  chequeId: initialCheque,
  onClose,
}: {
  locale: 'ar' | 'en';
  leases: RequestLease[];
  leaseId?: string | undefined;
  type?: TenantRequestType | undefined;
  chequeId?: string | undefined;
  onClose: () => void;
}) {
  const ar = locale === 'ar';
  const titleId = useId();
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [leaseId, setLeaseId] = useState(initialLease ?? leases[0]?.id ?? '');
  const [type, setType] = useState<TenantRequestType>(initialType ?? 'maintenance');
  const [chequeId, setChequeId] = useState(initialCheque ?? '');
  const [proposedDate, setProposedDate] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [emergency, setEmergency] = useState<EmergencyScope | ''>('');
  const [staffName, setStaffName] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const lease = leases.find((item) => item.id === leaseId) ?? leases[0];
  const cheques = lease?.cheques ?? [];
  const cheque = cheques.find((item) => item.id === chequeId) ?? null;
  const gated = type === 'maintenance' && Boolean(lease?.maintenanceBlocked) && !emergency;
  const report = isTenantReport(type);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!lease || gated) return;
    setBusy(true);
    setError(null);
    try {
      const result = await browserNextMutation<{ reference: string }>('/api/tenant/requests', {
        method: 'POST',
        body: JSON.stringify({
          leaseId: lease.id,
          type,
          subject: subject.trim() || undefined,
          description: description.trim() || undefined,
          ...(type === 'maintenance' ? (emergency ? { emergency } : { priority }) : {}),
          ...(requestNeedsCheque(type) ? { chequeId: chequeId || undefined } : {}),
          ...(requestNeedsDate(type) ? { proposedDate: proposedDate || undefined } : {}),
          ...(type === 'report_staff' && staffName.trim() ? { staffName: staffName.trim() } : {}),
          ...(requestTakesPhotos(type) && photos.length ? { photos } : {}),
        }),
      });
      setSent(result.reference);
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(false);
    }
  }

  const types = TENANT_REQUEST_TYPES.filter(
    (item) => !requestNeedsCheque(item) || cheques.length > 0,
  );

  return (
    <div className="tenant-request-modal" role="presentation" onClick={onClose}>
      <div
        className="tenant-request-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tenant-request-modal__head">
          <h2 id={titleId}>
            {report
              ? ar
                ? 'بلاغ جديد إلى إدارة العقار'
                : 'New report to property management'
              : ar
                ? 'طلب جديد إلى المالك'
                : 'New request to the landlord'}
          </h2>
          <button
            type="button"
            className="tenant-request-modal__close"
            aria-label={ar ? 'إغلاق' : 'Close'}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {sent ? (
          <div className="tenant-request-modal__done">
            <p className="notice notice--success" role="status">
              {report
                ? ar
                  ? `أُرسل بلاغك برقم ${sent} إلى المسؤولين عن إدارة العقار مباشرة بحسب صلاحياتهم، وسيصلك ردهم هنا وعلى بريدك.`
                  : `Your report ${sent} went straight to the people who manage the property; their answer arrives here and by email.`
                : ar
                  ? `أُرسل طلبك برقم ${sent} إلى المالك مباشرة، وسيصلك رده هنا وعلى بريدك.`
                  : `Your request ${sent} went straight to the landlord; their answer arrives here and by email.`}
            </p>
            <button type="button" className="button button--primary" onClick={onClose}>
              {ar ? 'تم' : 'Done'}
            </button>
          </div>
        ) : (
          <form className="tenant-request-form" onSubmit={(event) => void submit(event)}>
            {leases.length > 1 ? (
              <label>
                <span>{ar ? 'العقد' : 'Lease'}</span>
                <select
                  className="input"
                  value={leaseId}
                  onChange={(event) => {
                    setLeaseId(event.target.value);
                    setChequeId('');
                  }}
                >
                  {leases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="tenant-request-form__lease">{lease?.label}</p>
            )}
            <label>
              <span>{ar ? 'نوع الطلب' : 'Request type'}</span>
              <select
                className="input"
                value={type}
                onChange={(event) => setType(event.target.value as TenantRequestType)}
              >
                {types.map((item) => (
                  <option key={item} value={item}>
                    {tenantRequestTypeLabel(item, ar)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted tenant-request-form__hint">{tenantRequestTypeHint(type, ar)}</p>
            {requestNeedsCheque(type) ? (
              <label>
                <span>{ar ? 'الشيك' : 'Cheque'}</span>
                <select
                  className="input"
                  required
                  value={chequeId}
                  onChange={(event) => setChequeId(event.target.value)}
                >
                  <option value="">{ar ? 'اختر الشيك' : 'Pick the cheque'}</option>
                  {cheques.map((item) => (
                    <option key={item.id} value={item.id}>
                      {`${item.number} · ${item.dueOn} · ${formatMoney(item.amountMinor, lease?.currency ?? 'OMR', locale)}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {requestNeedsDate(type) ? (
              <label>
                <span>
                  {type === 'cheque_postpone'
                    ? ar
                      ? 'التاريخ الجديد المقترح للشيك'
                      : 'Proposed new cheque date'
                    : ar
                      ? 'تاريخ الإخلاء المقترح'
                      : 'Proposed move-out date'}
                </span>
                <input
                  className="input"
                  type="date"
                  required
                  dir="ltr"
                  min={cheque && type === 'cheque_postpone' ? cheque.dueOn : undefined}
                  value={proposedDate}
                  onChange={(event) => setProposedDate(event.target.value)}
                />
              </label>
            ) : null}
            {type === 'maintenance' && lease?.maintenanceBlocked ? (
              <ArrearsGate ar={ar} locale={locale} lease={lease} />
            ) : null}
            {type === 'maintenance' ? (
              <fieldset className="tenant-request-form__urgent">
                <label className="tenant-request-form__check">
                  <input
                    type="checkbox"
                    checked={Boolean(emergency)}
                    onChange={(event) => setEmergency(event.target.checked ? 'building' : '')}
                  />
                  <span>
                    {ar
                      ? 'طلب صيانة مستعجل يخص المبنى أو سلامته أو سلامة القاطنين فيه'
                      : 'Urgent maintenance about the building, its safety or the occupants’ safety'}
                  </span>
                </label>
                {emergency ? (
                  <>
                    <select
                      className="input"
                      value={emergency}
                      onChange={(event) => setEmergency(event.target.value as EmergencyScope)}
                    >
                      {EMERGENCY_SCOPES.map((scope) => (
                        <option key={scope} value={scope}>
                          {emergencyScopeLabel(scope, ar)}
                        </option>
                      ))}
                    </select>
                    <small className="muted">
                      {ar
                        ? 'ستتحقق الإدارة من صحة الحالة المستعجلة؛ إن لم تكن كذلك يُعامل الطلب كصيانة عادية.'
                        : 'Management verifies the urgency; if it is not urgent the request is handled as ordinary maintenance.'}
                    </small>
                  </>
                ) : (
                  <label>
                    <span>{ar ? 'الأولوية' : 'Priority'}</span>
                    <select
                      className="input"
                      value={priority}
                      onChange={(event) => setPriority(event.target.value as typeof priority)}
                    >
                      <option value="low">{ar ? 'منخفضة' : 'Low'}</option>
                      <option value="normal">{ar ? 'عادية' : 'Normal'}</option>
                      <option value="high">{ar ? 'عالية' : 'High'}</option>
                    </select>
                  </label>
                )}
              </fieldset>
            ) : null}
            {type === 'report_staff' ? (
              <label>
                <span>{ar ? 'اسم الموظف أو وصفه' : 'Staff member’s name or description'}</span>
                <input
                  className="input"
                  maxLength={120}
                  value={staffName}
                  onChange={(event) => setStaffName(event.target.value)}
                />
              </label>
            ) : null}
            <label>
              <span>{ar ? 'العنوان (اختياري)' : 'Subject (optional)'}</span>
              <input
                className="input"
                maxLength={200}
                value={subject}
                placeholder={tenantRequestTypeLabel(type, ar)}
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>
            <label>
              <span>{ar ? 'التفاصيل' : 'Details'}</span>
              <textarea
                className="input"
                rows={4}
                maxLength={2000}
                required={
                  type === 'maintenance' || type === 'other' || type === 'contract_amend' || report
                }
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {requestTakesPhotos(type) && !gated ? (
              <RequestPhotos ar={ar} photos={photos} onChange={setPhotos} />
            ) : null}
            {error ? (
              <p className="notice notice--error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="tenant-request-form__actions">
              <button type="submit" className="button button--primary" disabled={busy || gated}>
                {busy
                  ? ar
                    ? 'جارٍ الإرسال…'
                    : 'Sending…'
                  : report
                    ? ar
                      ? 'إرسال البلاغ'
                      : 'Send report'
                    : ar
                      ? 'إرسال إلى المالك'
                      : 'Send'}
              </button>
              <button type="button" className="button button--quiet" onClick={onClose}>
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
