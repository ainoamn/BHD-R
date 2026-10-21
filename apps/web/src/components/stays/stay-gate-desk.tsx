'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBrowserCsrfToken } from '@/lib/api';

type CheckInResult = {
  ok: true;
  alreadyArrived: boolean;
  arrivedAt: string | null;
  reference: string;
  guestName: string;
  unitCode: string;
  propertyNameAr: string;
  checkInOn: string;
  checkOutOn: string;
};

type PreviewResult = CheckInResult & { preview: true };

type Pending =
  | { kind: 'token'; token: string }
  | { kind: 'code'; reference: string; code: string };

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

function tokenFromScan(value: string): string | null {
  try {
    const token = new URL(value).searchParams.get('t');
    return token && /^[A-Za-z0-9_-]{40,120}$/.test(token) ? token : null;
  } catch {
    return /^[A-Za-z0-9_-]{40,120}$/.test(value) ? value : null;
  }
}

function stamp(iso: string | null, ar: boolean): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
      timeZone: 'Asia/Muscat',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function humanGateError(code: string, ar: boolean): string {
  switch (code) {
    case 'stay_checkin_too_early':
      return ar
        ? 'لا يمكن تسجيل الدخول قبل موعد الوصول بأكثر من 4 ساعات.'
        : 'Check-in opens at most 4 hours before arrival.';
    case 'stay_checkin_window_closed':
      return ar
        ? 'انتهت مدة الحجز دون وصول — أُلغي الحجز تلقائياً.'
        : 'Stay ended without arrival — booking cancelled automatically.';
    case 'wrong_property':
      return ar ? 'هذا الحجز لا يخص هذا العقار.' : 'This booking is not for this property.';
    case 'pass_invalid':
      return ar ? 'الرمز غير صالح أو منتهٍ.' : 'Code is invalid or expired.';
    default:
      return ar ? 'تعذّر تسجيل الوصول.' : 'Could not check in.';
  }
}

export function StayGateDesk({
  locale,
  initialToken,
  propertyId,
  autoConfirm = false,
  onCheckedIn,
}: {
  locale: 'ar' | 'en';
  initialToken: string | null;
  /** When set, only bookings for this property are accepted. */
  propertyId?: string;
  /** Scan/enter → record check-in immediately (no confirm step). */
  autoConfirm?: boolean;
  onCheckedIn?: () => void;
}) {
  const ar = locale === 'ar';
  const [reference, setReference] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [pending, setPending] = useState<Pending | null>(
    initialToken && !autoConfirm ? { kind: 'token', token: initialToken } : null,
  );
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [guardNote, setGuardNote] = useState('');

  const postGate = useCallback(
    async (action: 'preview' | 'checkin', next: Pending, note?: string) => {
      const key =
        next.kind === 'token'
          ? { token: next.token }
          : { reference: next.reference, code: next.code };
      const response = await fetch('/api/stay-gate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': await fetchBrowserCsrfToken(),
        },
        body: JSON.stringify({
          action,
          key,
          ...(propertyId ? { propertyId } : {}),
          ...(action === 'checkin' && note?.trim() ? { note: note.trim() } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | CheckInResult
        | PreviewResult
        | { error?: { code?: string; messageAr?: string; message?: string } }
        | null;
      if (!response.ok) {
        const errCode =
          (payload && 'error' in payload && payload.error?.code) || 'checkin_failed';
        throw new Error(errCode);
      }
      return payload;
    },
    [propertyId],
  );

  const loadPreview = useCallback(
    async (next: Pending) => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        if (autoConfirm) {
          const payload = await postGate('checkin', next);
          if (!payload || !('ok' in payload) || !payload.ok) {
            throw new Error('checkin_failed');
          }
          setResult(payload as CheckInResult);
          setPending(null);
          setPreview(null);
          onCheckedIn?.();
          return;
        }
        const payload = await postGate('preview', next);
        if (!payload || !('preview' in payload) || !payload.preview) {
          throw new Error('checkin_failed');
        }
        setPending(next);
        setPreview(payload);
        if (payload.alreadyArrived && payload.arrivedAt) {
          setResult(payload);
          setPending(null);
          setPreview(null);
        }
      } catch (caught) {
        setPending(null);
        setPreview(null);
        const code = caught instanceof Error ? caught.message : 'checkin_failed';
        setError(humanGateError(code, ar));
      } finally {
        setBusy(false);
      }
    },
    [postGate, autoConfirm, onCheckedIn, ar],
  );

  const confirmCheckIn = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await postGate('checkin', pending, guardNote);
      if (!payload || !('ok' in payload) || !payload.ok || 'preview' in payload) {
        throw new Error('checkin_failed');
      }
      setResult(payload as CheckInResult);
      setPending(null);
      setPreview(null);
      setGuardNote('');
      onCheckedIn?.();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : 'checkin_failed';
      setError(humanGateError(code, ar));
    } finally {
      setBusy(false);
    }
  }, [pending, postGate, guardNote, ar, onCheckedIn]);

  useEffect(() => {
    if (initialToken) void loadPreview({ kind: 'token', token: initialToken });
  }, [initialToken, loadPreview]);

  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let timer: number | undefined;
    const start = async () => {
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
        setError(ar ? 'الكاميرا أو ماسح الباركود غير متاحين.' : 'Camera or barcode scanner unavailable.');
        setScanning(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        const Ctor = (window as unknown as { BarcodeDetector: DetectorConstructor }).BarcodeDetector;
        const detector = new Ctor({ formats: ['qr_code'] });
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const token = codes.map((c) => tokenFromScan(c.rawValue)).find(Boolean);
            if (token) {
              setScanning(false);
              void loadPreview({ kind: 'token', token });
              return;
            }
          } catch {
            /* keep scanning */
          }
          timer = window.setTimeout(() => void tick(), 400);
        };
        void tick();
      } catch {
        setError(ar ? 'تعذّر فتح الكاميرا.' : 'Could not open the camera.');
        setScanning(false);
      }
    };
    void start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [scanning, ar, loadPreview]);

  if (result) {
    return (
      <section className="viewing-gate viewing-gate--ok" aria-live="polite">
        <div className="viewing-gate__check" aria-hidden>
          ✓
        </div>
        <h2>
          {result.alreadyArrived
            ? ar
              ? 'تم تسجيل الوصول مسبقاً'
              : 'Already checked in'
            : ar
              ? 'تم تسجيل الدخول'
              : 'Checked in'}
        </h2>
        <dl className="viewing-gate__facts">
          <div>
            <dt>{ar ? 'الضيف' : 'Guest'}</dt>
            <dd>{result.guestName}</dd>
          </div>
          <div>
            <dt>{ar ? 'المرجع' : 'Reference'}</dt>
            <dd dir="ltr">{result.reference}</dd>
          </div>
          <div>
            <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
            <dd>
              {result.propertyNameAr} · {result.unitCode}
            </dd>
          </div>
          <div>
            <dt>{ar ? 'تاريخ ووقت الدخول' : 'Check-in date & time'}</dt>
            <dd dir="ltr">{stamp(result.arrivedAt, ar)}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setResult(null);
            setReference('');
            setCode('');
            setPending(null);
            setPreview(null);
          }}
        >
          {ar ? 'مسح ضيف آخر' : 'Scan another guest'}
        </button>
      </section>
    );
  }

  if (preview && pending) {
    return (
      <section className="viewing-gate viewing-gate--preview" aria-live="polite">
        <h2>{ar ? 'تأكيد وصول الضيف' : 'Confirm guest arrival'}</h2>
        <p className="muted">
          {ar
            ? 'راجع البيانات ثم اضغط تأكيد لتسجيل الدخول.'
            : 'Review the details, then confirm to record check-in.'}
        </p>
        <dl className="viewing-gate__facts">
          <div>
            <dt>{ar ? 'الضيف' : 'Guest'}</dt>
            <dd>{preview.guestName}</dd>
          </div>
          <div>
            <dt>{ar ? 'المرجع' : 'Reference'}</dt>
            <dd dir="ltr">{preview.reference}</dd>
          </div>
          <div>
            <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
            <dd>
              {preview.propertyNameAr} · {preview.unitCode}
            </dd>
          </div>
          <div>
            <dt>{ar ? 'الإقامة' : 'Stay'}</dt>
            <dd dir="ltr">
              {preview.checkInOn} → {preview.checkOutOn}
            </dd>
          </div>
        </dl>
        <label className="field">
          <span>{ar ? 'ملاحظة (اختياري)' : 'Note (optional)'}</span>
          <textarea
            rows={2}
            value={guardNote}
            maxLength={500}
            disabled={busy}
            onChange={(event) => setGuardNote(event.target.value)}
          />
        </label>
        <div className="viewing-pass__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void confirmCheckIn()}
          >
            {busy
              ? ar
                ? 'جارٍ التسجيل…'
                : 'Recording…'
              : ar
                ? 'تأكيد الوصول وتسجيل الدخول'
                : 'Confirm arrival & check in'}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => {
              setPending(null);
              setPreview(null);
            }}
          >
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
        </div>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="viewing-gate">
      <div className="viewing-gate__scan">
        {scanning ? (
          <video ref={videoRef} className="viewing-gate__video" playsInline muted />
        ) : (
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => setScanning(true)}
          >
            {ar ? 'مسح باركود الوصول بالكاميرا' : 'Scan arrival barcode with camera'}
          </button>
        )}
        {scanning ? (
          <button type="button" className="button button--quiet" onClick={() => setScanning(false)}>
            {ar ? 'إيقاف المسح' : 'Stop scanning'}
          </button>
        ) : null}
      </div>

      <form
        className="viewing-gate__manual"
        onSubmit={(event) => {
          event.preventDefault();
          void loadPreview({
            kind: 'code',
            reference: reference.trim(),
            code: code.trim(),
          });
        }}
      >
        <h2>{ar ? 'أو أدخل رقم الحجز والرمز' : 'Or enter booking ref and code'}</h2>
        <label className="field">
          <span>{ar ? 'رقم الحجز' : 'Booking reference'}</span>
          <input
            className="input"
            dir="ltr"
            value={reference}
            onChange={(e) => setReference(e.target.value.toUpperCase())}
            placeholder="ST-…"
            required
          />
        </label>
        <label className="field">
          <span>{ar ? 'الرمز اليدوي (6 أرقام)' : 'Manual code (6 digits)'}</span>
          <input
            className="input"
            dir="ltr"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
          />
        </label>
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || code.length !== 6}
        >
          {autoConfirm
            ? busy
              ? ar
                ? 'جارٍ التسجيل…'
                : 'Recording…'
              : ar
                ? 'تسجيل الدخول الآن'
                : 'Check in now'
            : ar
              ? 'عرض بيانات الضيف'
              : 'Show guest details'}
        </button>
      </form>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
