'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ModalPortal } from '@/components/modal-portal';
import { NoteTranslateBar } from '@/components/note-translate';
import { fetchBrowserCsrfToken } from '@/lib/api';
import {
  HANDOVER_DOCUMENT_KINDS,
  HANDOVER_NOTES,
  HANDOVER_PHOTOS_MAX,
  HANDOVER_PHOTO_MAX,
  validHandoverPhone,
  type HandoverKind,
  type HandoverPhotoSource,
} from '@/lib/stay-handover';
import {
  compressDocument,
  compressPhoto,
  type HandoverSubmit,
} from '@/components/stays/stay-handover-form';
import { StampDateTimeField } from '@/components/stays/stamp-date-time-field';

type CheckInStep = 'verify' | 'time' | 'recipient' | 'extras' | 'confirm';
type CheckOutStep = 'time' | 'extras' | 'confirm';

type Preview = {
  reference: string;
  guestName: string;
  unitCode: string;
  propertyNameAr: string;
  checkInOn: string;
  checkOutOn: string;
};

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

const CHECK_IN_STEPS: Array<{ id: CheckInStep; ar: string; en: string }> = [
  { id: 'verify', ar: 'التحقق من الحجز', en: 'Verify booking' },
  { id: 'time', ar: 'الوقت', en: 'Time' },
  { id: 'recipient', ar: 'المستلم', en: 'Recipient' },
  { id: 'extras', ar: 'صور وملاحظات', en: 'Photos & notes' },
  { id: 'confirm', ar: 'التأكيد', en: 'Confirm' },
];

const CHECK_OUT_STEPS: Array<{ id: CheckOutStep; ar: string; en: string }> = [
  { id: 'time', ar: 'الوقت', en: 'Time' },
  { id: 'extras', ar: 'صور وملاحظات', en: 'Photos & notes' },
  { id: 'confirm', ar: 'التأكيد', en: 'Confirm' },
];

function tokenFromScan(value: string): string | null {
  try {
    const token = new URL(value).searchParams.get('t');
    return token && /^[A-Za-z0-9_-]{40,120}$/.test(token) ? token : null;
  } catch {
    return /^[A-Za-z0-9_-]{40,120}$/.test(value) ? value : null;
  }
}

function refsMatch(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

export function StayHandoverWizard({
  kind,
  reference,
  locale,
  busy,
  guestPhone,
  guestName,
  propertyId,
  skipVerify = false,
  onSubmit,
  onClose,
}: {
  kind: HandoverKind;
  reference: string;
  locale: 'ar' | 'en';
  busy: boolean;
  guestPhone: string | null;
  guestName?: string | null;
  propertyId?: string | null;
  /** Owner already verified the booking row (e.g. after waiving deposit). */
  skipVerify?: boolean;
  onSubmit: (value: HandoverSubmit) => void;
  onClose: () => void;
}) {
  const ar = locale === 'ar';
  const checkIn = kind === 'check_in';
  const steps = checkIn && !skipVerify ? CHECK_IN_STEPS : checkIn ? CHECK_IN_STEPS.filter((s) => s.id !== 'verify') : CHECK_OUT_STEPS;
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex]!.id;

  const [at, setAt] = useState<string | null>(null);
  const [noteKeys, setNoteKeys] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [important, setImportant] = useState(false);
  const [name, setName] = useState(guestName?.trim() ?? '');
  const [phone, setPhone] = useState('');
  const [documentKind, setDocumentKind] = useState('civil_id');
  const [document, setDocument] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<HandoverSubmit['photos']>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const [verified, setVerified] = useState(!checkIn || skipVerify);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const photoCameraRef = useRef<HTMLInputElement>(null);
  const photoDeviceRef = useRef<HTMLInputElement>(null);

  const phoneOk = validHandoverPhone(phone);
  const photosFull = photos.length >= HANDOVER_PHOTOS_MAX;

  const loadPreview = useCallback(
    async (key: { token: string } | { reference: string; code: string }) => {
      setVerifyBusy(true);
      setVerifyError(null);
      try {
        const response = await fetch('/api/stay-gate', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-csrf-token': await fetchBrowserCsrfToken(),
          },
          body: JSON.stringify({
            action: 'preview',
            key,
            ...(propertyId ? { propertyId } : {}),
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | (Preview & { error?: { code?: string; messageAr?: string; message?: string } })
          | null;
        if (!response.ok || !payload?.reference) {
          setVerifyError(
            ar
              ? payload?.error?.messageAr || 'تعذّر التحقق من رمز الوصول.'
              : payload?.error?.message || 'Could not verify the arrival code.',
          );
          return;
        }
        if (!refsMatch(payload.reference, reference)) {
          setVerifyError(
            ar
              ? `الباركود لحجز آخر (${payload.reference}) وليس ${reference}.`
              : `That barcode is for ${payload.reference}, not ${reference}.`,
          );
          return;
        }
        setPreview(payload);
        setVerified(true);
        setScanning(false);
        setStepIndex(1);
      } catch {
        setVerifyError(ar ? 'تعذّر التحقق من رمز الوصول.' : 'Could not verify the arrival code.');
      } finally {
        setVerifyBusy(false);
      }
    },
    [ar, propertyId, reference],
  );

  useEffect(() => {
    if (!scanning) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      return;
    }
    let stopped = false;
    let timer = 0;
    const Detector = (
      globalThis as unknown as { BarcodeDetector?: DetectorConstructor }
    ).BarcodeDetector;
    if (!Detector) {
      setVerifyError(
        ar ? 'الكاميرا أو ماسح الباركود غير متاحين.' : 'Camera or barcode scanner unavailable.',
      );
      setScanning(false);
      return;
    }
    const detector = new Detector({ formats: ['qr_code', 'aztec', 'data_matrix'] });
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const token = codes.map((item) => tokenFromScan(item.rawValue)).find(Boolean);
            if (token) {
              await loadPreview({ token });
              return;
            }
          } catch {
            /* keep scanning */
          }
          timer = window.setTimeout(() => void tick(), 350);
        };
        void tick();
      } catch {
        if (!stopped) {
          setVerifyError(ar ? 'تعذّر فتح الكاميرا.' : 'Could not open the camera.');
          setScanning(false);
        }
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [scanning, ar, loadPreview]);

  async function pickDocument(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    if (!file.type.startsWith('image/')) {
      setImageError(ar ? 'اختر صورة للوثيقة.' : 'Choose an ID image.');
      return;
    }
    setReading(true);
    try {
      setDocument(await compressDocument(file));
    } catch {
      setImageError(ar ? 'تعذّرت قراءة الصورة.' : 'Could not read the photo.');
    } finally {
      setReading(false);
    }
  }

  async function addPhotos(files: FileList | null, source: HandoverPhotoSource) {
    const picked = [...(files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!picked.length) return;
    setPhotoError(null);
    const room = HANDOVER_PHOTOS_MAX - photos.length;
    setPhotoBusy(true);
    try {
      const added: HandoverSubmit['photos'] = [];
      for (const file of picked.slice(0, Math.max(room, 0))) {
        added.push({
          data: await compressPhoto(file, HANDOVER_PHOTO_MAX),
          source,
          takenAt: new Date(source === 'camera' ? Date.now() : file.lastModified).toISOString(),
        });
      }
      setPhotos((current) => [...current, ...added].slice(0, HANDOVER_PHOTOS_MAX));
    } catch {
      setPhotoError(ar ? 'تعذّرت قراءة إحدى الصور.' : 'Could not read one of the photos.');
    } finally {
      setPhotoBusy(false);
    }
  }

  function canLeaveStep(): boolean {
    if (step === 'verify') return verified;
    if (step === 'time') return Boolean(at);
    if (step === 'recipient') return phoneOk && Boolean(document) && !reading;
    return !photoBusy && !reading;
  }

  function goNext() {
    setTried(true);
    if (!canLeaveStep()) return;
    setTried(false);
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }

  function goBack() {
    setTried(false);
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  function submit() {
    setTried(true);
    if (!at) return;
    if (checkIn && (!phoneOk || !document)) {
      setStepIndex(CHECK_IN_STEPS.findIndex((item) => item.id === 'recipient'));
      return;
    }
    onSubmit({
      at,
      notes: custom,
      noteKeys,
      important,
      photos,
      ...(checkIn && document
        ? {
            recipient: {
              ...(name.trim() ? { name: name.trim() } : {}),
              phone: phone.trim(),
              documentKind,
              document,
            },
          }
        : {}),
    });
  }

  const title = checkIn
    ? ar
      ? `تسجيل الدخول · ${reference}`
      : `Check-in · ${reference}`
    : ar
      ? `تسجيل المغادرة · ${reference}`
      : `Check-out · ${reference}`;

  return (
    <ModalPortal {...(busy ? {} : { onClose })}>
      <div
        className="ops-modal ops-modal--create handover-wizard"
        role="presentation"
        onMouseDown={(event) => {
          if (!busy && event.target === event.currentTarget) onClose();
        }}
      >
        <section
          className="ops-modal__card ops-modal__card--wide handover-wizard__card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="handover-wizard-title"
          dir={ar ? 'rtl' : 'ltr'}
        >
          <header>
            <div>
              <span className="ops-kicker">
                {ar ? `الخطوة ${stepIndex + 1} من ${steps.length}` : `Step ${stepIndex + 1} of ${steps.length}`}
              </span>
              <h2 id="handover-wizard-title">{title}</h2>
              {guestName ? <p className="muted">{guestName}</p> : null}
            </div>
            <button type="button" aria-label={ar ? 'إغلاق' : 'Close'} disabled={busy} onClick={onClose}>
              ×
            </button>
          </header>

          <ol className="handover-wizard__steps" aria-label={ar ? 'خطوات التسجيل' : 'Handover steps'}>
            {steps.map((item, index) => (
              <li
                key={item.id}
                className={
                  index === stepIndex
                    ? 'is-current'
                    : index < stepIndex
                      ? 'is-done'
                      : undefined
                }
              >
                <span aria-hidden="true">{index < stepIndex ? '✓' : index + 1}</span>
                <b>{ar ? item.ar : item.en}</b>
              </li>
            ))}
          </ol>

          <div className="handover-wizard__body">
            {step === 'verify' ? (
              <div className="handover-wizard__pane">
                <p className="handover-wizard__lead">
                  {ar
                    ? 'امسح باركود الوصول من صفحة الضيف، أو أدخل الرمز اليدوي (6 أرقام)، أو تابع مباشرة لهذا الحجز.'
                    : 'Scan the arrival barcode from the guest page, enter the 6-digit code, or continue with this booking.'}
                </p>
                <div className="handover-wizard__scan">
                  {scanning ? (
                    <video ref={videoRef} className="handover-wizard__video" playsInline muted />
                  ) : (
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={verifyBusy}
                      onClick={() => {
                        setVerifyError(null);
                        setScanning(true);
                      }}
                    >
                      {ar ? 'مسح الباركود بالكاميرا' : 'Scan barcode with camera'}
                    </button>
                  )}
                  {scanning ? (
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => setScanning(false)}
                    >
                      {ar ? 'إيقاف المسح' : 'Stop scanning'}
                    </button>
                  ) : null}
                </div>

                <form
                  className="handover-wizard__manual"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void loadPreview({
                      reference,
                      code: manualCode.trim(),
                    });
                  }}
                >
                  <h3>{ar ? 'أو أدخل رمز الوصول' : 'Or enter the arrival code'}</h3>
                  <label className="field">
                    <span>{ar ? 'رقم الحجز' : 'Booking reference'}</span>
                    <input className="input" dir="ltr" value={reference} readOnly />
                  </label>
                  <label className="field">
                    <span>{ar ? 'الرمز اليدوي (6 أرقام)' : 'Manual code (6 digits)'}</span>
                    <input
                      className="input"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={6}
                      value={manualCode}
                      onChange={(event) =>
                        setManualCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    className="button button--primary"
                    disabled={verifyBusy || manualCode.length !== 6}
                  >
                    {verifyBusy
                      ? ar
                        ? 'جارٍ التحقق…'
                        : 'Verifying…'
                      : ar
                        ? 'تحقق والمتابعة'
                        : 'Verify & continue'}
                  </button>
                </form>

                <button
                  type="button"
                  className="button button--quiet handover-wizard__skip"
                  disabled={verifyBusy}
                  onClick={() => {
                    setVerified(true);
                    setStepIndex(1);
                  }}
                >
                  {ar ? 'متابعة بدون مسح لهذا الحجز' : 'Continue without scanning for this booking'}
                </button>

                {preview ? (
                  <p className="notice notice--success" role="status">
                    {ar
                      ? `تم التحقق: ${preview.guestName} · ${preview.reference}`
                      : `Verified: ${preview.guestName} · ${preview.reference}`}
                  </p>
                ) : null}
                {verifyError ? (
                  <p className="notice notice--error" role="alert">
                    {verifyError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {step === 'time' ? (
              <div className="handover-wizard__pane">
                <StampDateTimeField
                  id={`wizard-${kind}-at`}
                  locale={locale}
                  onChange={setAt}
                  label={
                    checkIn
                      ? ar
                        ? 'تاريخ ووقت الدخول'
                        : 'Check-in date and time'
                      : ar
                        ? 'تاريخ ووقت المغادرة'
                        : 'Check-out date and time'
                  }
                />
                {tried && !at ? (
                  <p className="stamp-dt__error" role="alert">
                    {ar ? 'حدّد التاريخ والوقت.' : 'Set the date and time.'}
                  </p>
                ) : null}
              </div>
            ) : null}

            {step === 'recipient' ? (
              <div className="handover-wizard__pane">
                <div className="handover-recipient__grid">
                  <div className="field">
                    <label htmlFor="wizard-phone">{ar ? 'رقم هاتف المستلم *' : 'Recipient phone *'}</label>
                    <input
                      id="wizard-phone"
                      className="input"
                      type="tel"
                      dir="ltr"
                      value={phone}
                      aria-invalid={tried && !phoneOk}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="+968 9X XXX XXX"
                    />
                    {guestPhone ? (
                      <button
                        type="button"
                        className="stamp-dt__chip handover-chip-inline"
                        onClick={() => setPhone(guestPhone)}
                      >
                        {ar ? 'رقم الضيف' : 'Guest phone'}: <bdi dir="ltr">{guestPhone}</bdi>
                      </button>
                    ) : null}
                    {tried && !phoneOk ? (
                      <small className="stamp-dt__error" role="alert">
                        {ar ? 'أدخل رقم هاتف صحيحاً.' : 'Enter a valid phone number.'}
                      </small>
                    ) : null}
                  </div>
                  <div className="field">
                    <label htmlFor="wizard-name">{ar ? 'اسم المستلم (اختياري)' : 'Recipient name (optional)'}</label>
                    <input
                      id="wizard-name"
                      className="input"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={120}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="wizard-doc-kind">{ar ? 'نوع الوثيقة' : 'Document type'}</label>
                    <select
                      id="wizard-doc-kind"
                      className="input"
                      value={documentKind}
                      onChange={(event) => setDocumentKind(event.target.value)}
                    >
                      {HANDOVER_DOCUMENT_KINDS.map((item) => (
                        <option key={item.key} value={item.key}>
                          {ar ? item.ar : item.en}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={`handover-doc${tried && !document ? ' handover-doc--missing' : ''}`}>
                  <span className="handover-doc__label">
                    {ar ? 'صورة وثيقة المستلم *' : 'Recipient ID photo *'}
                  </span>
                  {document ? (
                    <figure className="handover-doc__preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={document} alt="" />
                    </figure>
                  ) : null}
                  <div className="handover-doc__actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={reading}
                      onClick={() => cameraRef.current?.click()}
                    >
                      {ar ? 'تصوير الوثيقة' : 'Take photo'}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={reading}
                      onClick={() => uploadRef.current?.click()}
                    >
                      {ar ? 'رفع صورة' : 'Upload'}
                    </button>
                  </div>
                  <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(event) => {
                      void pickDocument(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                  <input
                    ref={uploadRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      void pickDocument(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                  {imageError || (tried && !document) ? (
                    <small className="stamp-dt__error" role="alert">
                      {imageError || (ar ? 'صورة الوثيقة مطلوبة.' : 'ID photo is required.')}
                    </small>
                  ) : (
                    <small className="muted">
                      {ar
                        ? 'تُحفظ بشكل خاص ولا يراها الضيف.'
                        : 'Stored privately; the guest does not see it.'}
                    </small>
                  )}
                </div>
              </div>
            ) : null}

            {step === 'extras' ? (
              <div className="handover-wizard__pane">
                <fieldset className="handover-photos">
                  <legend>
                    {ar
                      ? `صور حالة الوحدة (اختياري، حتى ${HANDOVER_PHOTOS_MAX})`
                      : `Unit photos (optional, up to ${HANDOVER_PHOTOS_MAX})`}
                  </legend>
                  {photos.length ? (
                    <ol className="handover-photos__grid">
                      {photos.map((photo, index) => (
                        <li key={`${photo.takenAt}-${index}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.data} alt="" />
                          <button
                            type="button"
                            className="handover-photos__remove"
                            onClick={() =>
                              setPhotos((current) =>
                                current.filter((_, position) => position !== index),
                              )
                            }
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  <div className="handover-doc__actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={photoBusy || photosFull}
                      onClick={() => photoCameraRef.current?.click()}
                    >
                      {ar ? 'تصوير' : 'Camera'}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={photoBusy || photosFull}
                      onClick={() => photoDeviceRef.current?.click()}
                    >
                      {ar ? 'من الجهاز' : 'From device'}
                    </button>
                    <span className="muted" dir="ltr">
                      {photos.length}/{HANDOVER_PHOTOS_MAX}
                    </span>
                  </div>
                  <input
                    ref={photoCameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(event) => {
                      void addPhotos(event.target.files, 'camera');
                      event.target.value = '';
                    }}
                  />
                  <input
                    ref={photoDeviceRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(event) => {
                      void addPhotos(event.target.files, 'device');
                      event.target.value = '';
                    }}
                  />
                  {photoError ? (
                    <small className="stamp-dt__error" role="alert">
                      {photoError}
                    </small>
                  ) : null}
                </fieldset>

                <fieldset className="handover-notes">
                  <legend>{ar ? 'ملاحظات جاهزة' : 'Quick notes'}</legend>
                  <div className="handover-notes__chips">
                    {HANDOVER_NOTES[kind].map((item) => {
                      const on = noteKeys.includes(item.key);
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`handover-note${on ? ' handover-note--on' : ''}`}
                          aria-pressed={on}
                          onClick={() =>
                            setNoteKeys((current) =>
                              current.includes(item.key)
                                ? current.filter((key) => key !== item.key)
                                : [...current, item.key],
                            )
                          }
                        >
                          {ar ? item.ar : item.en}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="field">
                  <label htmlFor="wizard-notes">{ar ? 'ملاحظة خاصة' : 'Custom note'}</label>
                  <textarea
                    id="wizard-notes"
                    className="textarea"
                    rows={3}
                    maxLength={1000}
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                  />
                  <NoteTranslateBar
                    value={custom}
                    onChange={setCustom}
                    locale={locale}
                    max={1000}
                    disabled={busy}
                  />
                  <label className="handover-important">
                    <input
                      type="checkbox"
                      checked={important}
                      onChange={(event) => setImportant(event.target.checked)}
                    />
                    {ar ? 'ملاحظة مهمة' : 'Important note'}
                  </label>
                </div>
              </div>
            ) : null}

            {step === 'confirm' ? (
              <div className="handover-wizard__pane">
                <dl className="handover-wizard__summary">
                  <div>
                    <dt>{ar ? 'المرجع' : 'Reference'}</dt>
                    <dd dir="ltr">{reference}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'الوقت' : 'Time'}</dt>
                    <dd dir="ltr">{at?.replace('T', ' ') || '—'}</dd>
                  </div>
                  {checkIn ? (
                    <>
                      <div>
                        <dt>{ar ? 'الهاتف' : 'Phone'}</dt>
                        <dd dir="ltr">{phone || '—'}</dd>
                      </div>
                      <div>
                        <dt>{ar ? 'الوثيقة' : 'ID'}</dt>
                        <dd>{document ? (ar ? 'مرفقة' : 'Attached') : '—'}</dd>
                      </div>
                    </>
                  ) : null}
                  <div>
                    <dt>{ar ? 'الصور' : 'Photos'}</dt>
                    <dd>{photos.length}</dd>
                  </div>
                  <div>
                    <dt>{ar ? 'ملاحظات' : 'Notes'}</dt>
                    <dd>{noteKeys.length + (custom.trim() ? 1 : 0)}</dd>
                  </div>
                </dl>
                <p className="muted">
                  {ar
                    ? 'يظهر الوقت والملاحظات للضيف. رقم الهاتف وصورة الوثيقة لا تظهر له.'
                    : 'The guest sees the time and notes; phone and ID stay private.'}
                </p>
              </div>
            ) : null}
          </div>

          <div className="form-actions handover-wizard__actions">
            <button type="button" className="button button--quiet" disabled={busy} onClick={onClose}>
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
            {stepIndex > 0 ? (
              <button type="button" className="button button--quiet" disabled={busy} onClick={goBack}>
                {ar ? 'السابق' : 'Back'}
              </button>
            ) : null}
            {step !== 'confirm' ? (
              <button
                type="button"
                className="button button--primary"
                disabled={busy || verifyBusy || reading || photoBusy}
                onClick={goNext}
              >
                {ar ? 'التالي' : 'Next'}
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                disabled={busy || reading || photoBusy || !at}
                onClick={submit}
              >
                {busy
                  ? ar
                    ? 'جارٍ الحفظ…'
                    : 'Saving…'
                  : checkIn
                    ? ar
                      ? 'تأكيد الدخول'
                      : 'Confirm check-in'
                    : ar
                      ? 'تأكيد المغادرة'
                      : 'Confirm check-out'}
              </button>
            )}
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
