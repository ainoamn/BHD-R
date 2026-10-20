'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBrowserCsrfToken } from '@/lib/api';

type CheckInResult = {
  ok: true;
  alreadyArrived: boolean;
  arrivedAt: string;
  reference: string;
  prospectName: string;
  unitCode: string;
  propertyNameAr: string;
  scheduledAt: string | null;
};

type PreviewResult = {
  ok: true;
  preview: true;
  reference: string;
  prospectName: string;
  unitCode: string;
  propertyNameAr: string;
  scheduledAt: string | null;
  alreadyArrived: boolean;
  arrivedAt: string | null;
};

type Pending =
  | { kind: 'token'; token: string }
  | { kind: 'credentials'; username: string; pin: string };

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
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export function ViewingGateDesk({
  locale,
  initialToken,
}: {
  locale: 'ar' | 'en';
  initialToken: string | null;
}) {
  const ar = locale === 'ar';
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [pending, setPending] = useState<Pending | null>(
    initialToken ? { kind: 'token', token: initialToken } : null,
  );
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);

  const postGate = useCallback(
    async (
      action: 'preview' | 'checkin',
      body: { token: string } | { username: string; pin: string },
    ) => {
      const response = await fetch('/api/viewing-gate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': await fetchBrowserCsrfToken(),
        },
        body: JSON.stringify({ action, ...body }),
      });
      const payload = (await response.json().catch(() => null)) as
        | CheckInResult
        | PreviewResult
        | { error?: { code?: string } }
        | null;
      if (!response.ok) {
        throw new Error(
          (payload && 'error' in payload && payload.error?.code) || 'checkin_failed',
        );
      }
      return payload;
    },
    [],
  );

  const loadPreview = useCallback(
    async (next: Pending) => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const body =
          next.kind === 'token'
            ? { token: next.token }
            : { username: next.username, pin: next.pin };
        const payload = await postGate('preview', body);
        if (!payload || !('preview' in payload) || !payload.preview) {
          throw new Error('checkin_failed');
        }
        setPending(next);
        setPreview(payload);
        if (payload.alreadyArrived && payload.arrivedAt) {
          setResult({
            ok: true,
            alreadyArrived: true,
            arrivedAt: payload.arrivedAt,
            reference: payload.reference,
            prospectName: payload.prospectName,
            unitCode: payload.unitCode,
            propertyNameAr: payload.propertyNameAr,
            scheduledAt: payload.scheduledAt,
          });
          setPending(null);
          setPreview(null);
        }
      } catch (caught) {
        setPending(null);
        setPreview(null);
        setError(caught instanceof Error ? caught.message : 'checkin_failed');
      } finally {
        setBusy(false);
      }
    },
    [postGate],
  );

  const confirmCheckIn = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const body =
        pending.kind === 'token'
          ? { token: pending.token }
          : { username: pending.username, pin: pending.pin };
      const payload = await postGate('checkin', body);
      if (!payload || !('ok' in payload) || !payload.ok || 'preview' in payload) {
        throw new Error('checkin_failed');
      }
      setResult(payload as CheckInResult);
      setPending(null);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'checkin_failed');
    } finally {
      setBusy(false);
    }
  }, [pending, postGate]);

  // Deep link / email with ?t= only previews — never auto check-in.
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
              ? 'تم التحقق — مرحباً بالزائر'
              : 'Verified — visitor welcome'}
        </h2>
        <dl className="viewing-gate__facts">
          <div>
            <dt>{ar ? 'الزائر' : 'Visitor'}</dt>
            <dd>{result.prospectName}</dd>
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
            <dt>{ar ? 'وقت الوصول' : 'Arrived at'}</dt>
            <dd dir="ltr">{stamp(result.arrivedAt, ar)}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setResult(null);
            setUsername('');
            setPin('');
            setPending(null);
            setPreview(null);
          }}
        >
          {ar ? 'مسح زائر آخر' : 'Scan another visitor'}
        </button>
      </section>
    );
  }

  if (preview && pending) {
    return (
      <section className="viewing-gate viewing-gate--preview" aria-live="polite">
        <h2>{ar ? 'تأكيد وصول الزائر' : 'Confirm visitor arrival'}</h2>
        <p className="muted">
          {ar
            ? 'راجع البيانات ثم اضغط تأكيد. لن يُسجَّل الوصول إلا بعد تأكيدك.'
            : 'Review the details, then confirm. Arrival is recorded only after you confirm.'}
        </p>
        <dl className="viewing-gate__facts">
          <div>
            <dt>{ar ? 'الزائر' : 'Visitor'}</dt>
            <dd>{preview.prospectName}</dd>
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
            <dt>{ar ? 'الموعد' : 'Scheduled'}</dt>
            <dd dir="ltr">{stamp(preview.scheduledAt, ar)}</dd>
          </div>
        </dl>
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
                ? 'تأكيد الوصول'
                : 'Confirm arrival'}
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
            {ar ? 'مسح الباركود بالكاميرا' : 'Scan barcode with camera'}
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
            kind: 'credentials',
            username: username.trim(),
            pin: pin.trim(),
          });
        }}
      >
        <h2>{ar ? 'أو أدخل البيانات يدوياً' : 'Or type the credentials'}</h2>
        <label className="field">
          <span>{ar ? 'اسم المستخدم' : 'Username'}</span>
          <input
            className="input"
            dir="ltr"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span>{ar ? 'الرقم السري' : 'PIN'}</span>
          <input
            className="input"
            dir="ltr"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="one-time-code"
            required
          />
        </label>
        <button type="submit" className="button button--primary" disabled={busy || pin.length !== 6}>
          {ar ? 'عرض بيانات الزائر' : 'Show visitor details'}
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
