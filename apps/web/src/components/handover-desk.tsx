'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fileFromDataUrl } from '@/components/handover-selfie';
import { NoteTranslateBar } from '@/components/note-translate';
import { EsignCameraCapture } from '@/components/stays/esign/esign-camera-capture';
import { compressPhoto } from '@/components/stays/stay-handover-form';
import { ApiError, browserNextMutation } from '@/lib/api';
import { HANDOVER_PHOTOS_MAX, HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';

type Key = { token: string } | { reference: string; code: string };
type Photo = { data: string; takenAt: string; source: 'camera' | 'device' };
type Preview = {
  reservationId: string;
  referenceCode: string;
  phase: string;
  ready: boolean;
  awaitingTenant: boolean;
  tenantName: string;
  unit: { code: string; nameAr: string; nameEn: string };
  property: { nameAr: string; nameEn: string };
  contractReference: string | null;
  tenantSignedAt: string | null;
  hasSelfie: boolean;
  selfieRequestedAt: string | null;
  liveSelfieAt: string | null;
  handlerSelfieAt: string | null;
  handlerSelfieBy: string | null;
};

/** How often the desk checks whether the tenant's selfie has arrived. */
const SELFIE_POLL_MS = 5000;

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

function errorMessage(error: unknown, ar: boolean): string {
  if (error instanceof ApiError && error.message && error.code !== 'api_error')
    return error.message;
  return ar ? 'تعذّر إتمام الطلب، أعد المحاولة.' : 'The request failed; try again.';
}

function tokenFromScan(value: string): string | null {
  try {
    const token = new URL(value).searchParams.get('t');
    return token && /^[A-Za-z0-9_-]{40,120}$/.test(token) ? token : null;
  } catch {
    return /^[A-Za-z0-9_-]{40,120}$/.test(value) ? value : null;
  }
}

function selfieHref(key: Key): string {
  const query =
    'token' in key
      ? new URLSearchParams({ t: key.token })
      : new URLSearchParams({ ref: key.reference, code: key.code });
  return `/api/handover/selfie?${query.toString()}`;
}

/** Scan or type the tenant's pass, check the face, then record keys, meters and photos. */
export function HandoverDesk({
  locale,
  initialToken,
}: {
  locale: 'ar' | 'en';
  initialToken: string | null;
}) {
  const ar = locale === 'ar';
  const [key, setKey] = useState<Key | null>(initialToken ? { token: initialToken } : null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (next: Key) => {
      setLoading(true);
      setError(null);
      try {
        const result = await browserNextMutation<Preview>('/api/handover', {
          method: 'POST',
          body: JSON.stringify({ action: 'preview', key: next }),
        });
        setKey(next);
        setPreview(result);
      } catch (caught) {
        setPreview(null);
        setError(errorMessage(caught, ar));
      } finally {
        setLoading(false);
      }
    },
    [ar],
  );

  useEffect(() => {
    if (initialToken) void load({ token: initialToken });
  }, [initialToken, load]);

  const waitingForSelfie = Boolean(
    key && preview?.ready && !preview.awaitingTenant && !preview.liveSelfieAt,
  );
  useEffect(() => {
    if (!waitingForSelfie || !key) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      browserNextMutation<Preview>('/api/handover', {
        method: 'POST',
        body: JSON.stringify({ action: 'preview', key, poll: true }),
      })
        .then((next) => {
          if (!stopped) setPreview(next);
        })
        .catch(() => undefined);
    }, SELFIE_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [waitingForSelfie, key]);

  if (done) {
    return (
      <section className="handover-desk handover-desk--done" role="status">
        <h2>{ar ? 'تم إرسال محضر التسليم ✅' : 'Handover record sent ✅'}</h2>
        <p>
          {ar
            ? `وصل إشعار للمستأجر في حجز ${done} ليوافق على استلام العقار. بمجرد موافقته يُعدّ العقار مسلَّماً بالطريقة القانونية والنظامية، ويُنبَّه بأن عليه رفع صور للعقار خلال 3 ساعات، وإلا يُعتبر أنه استلمه بدون عيوب وفي حالة جيدة.`
            : `The tenant of booking ${done} was notified to accept the premises. Once they accept, the handover is legal and formal, and they are told to upload photos of the premises within 3 hours or the premises count as received in good condition without defects.`}
        </p>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setDone(null);
            setPreview(null);
            setKey(null);
          }}
        >
          {ar ? 'تسليم عقار آخر' : 'Hand over another'}
        </button>
      </section>
    );
  }

  return (
    <div className="handover-desk">
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {preview && key ? (
        <HandoverForm
          ar={ar}
          locale={locale}
          handoverKey={key}
          preview={preview}
          onHandlerSelfie={(takenAt) =>
            setPreview((current) => (current ? { ...current, handlerSelfieAt: takenAt } : current))
          }
          onDone={() => setDone(preview.referenceCode)}
          onBack={() => {
            setPreview(null);
            setKey(null);
          }}
        />
      ) : (
        <PassEntry ar={ar} loading={loading} onKey={(next) => void load(next)} />
      )}
    </div>
  );
}

function PassEntry({
  ar,
  loading,
  onKey,
}: {
  ar: boolean;
  loading: boolean;
  onKey: (key: Key) => void;
}) {
  const [reference, setReference] = useState('');
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setSupported(
      'BarcodeDetector' in window && typeof navigator.mediaDevices?.getUserMedia === 'function',
    );
  }, []);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | undefined;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorConstructor }).BarcodeDetector;
    const detector = new Ctor({ formats: ['qr_code'] });
    const tick = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      try {
        const codes = video.readyState >= 2 ? await detector.detect(video) : [];
        const token = codes.map((item) => tokenFromScan(item.rawValue)).find(Boolean);
        if (token) {
          setScanning(false);
          onKey({ token });
          return;
        }
      } catch {
        // A frame that fails to decode is skipped.
      }
      timer = window.setTimeout(() => void tick(), 250);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((media) => {
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          void videoRef.current.play();
        }
        void tick();
      })
      .catch(() => {
        setScanError(
          ar
            ? 'تعذّر تشغيل الكاميرا؛ اسمح بالوصول إليها أو امسح الرمز بكاميرا الهاتف أو أدخل الرمز يدوياً.'
            : 'The camera could not start; allow access, scan with the phone camera, or type the code.',
        );
        setScanning(false);
      });
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scanning, ar, onKey]);

  return (
    <section className="handover-desk__entry">
      <div className="handover-desk__scan">
        <h2>{ar ? 'امسح رمز المستأجر' : 'Scan the tenant’s code'}</h2>
        {scanning ? (
          <>
            <video ref={videoRef} className="handover-desk__video" muted playsInline />
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setScanning(false)}
            >
              {ar ? 'إيقاف الكاميرا' : 'Stop camera'}
            </button>
          </>
        ) : supported ? (
          <button
            type="button"
            className="button button--primary"
            disabled={loading}
            onClick={() => {
              setScanError(null);
              setScanning(true);
            }}
          >
            {ar ? 'تشغيل الكاميرا للمسح' : 'Open the camera to scan'}
          </button>
        ) : (
          <p className="muted">
            {ar
              ? 'افتح كاميرا هاتفك ووجّهها إلى الرمز في حساب المستأجر؛ سيفتح هذه الصفحة تلقائياً.'
              : 'Point your phone camera at the code in the tenant’s account; it opens this page.'}
          </p>
        )}
        {scanError ? <p className="notice notice--error">{scanError}</p> : null}
      </div>
      <form
        className="handover-desk__manual"
        onSubmit={(event) => {
          event.preventDefault();
          if (!reference.trim() || !/^\d{6}$/.test(code.replace(/\s/g, ''))) return;
          onKey({ reference: reference.trim(), code: code.replace(/\s/g, '') });
        }}
      >
        <h2>{ar ? 'أو أدخل الرمز يدوياً' : 'Or type the code'}</h2>
        <label>
          <span>{ar ? 'رقم الحجز' : 'Booking reference'}</span>
          <input
            className="input"
            dir="ltr"
            placeholder="RSV-XXXXXXXX"
            value={reference}
            maxLength={40}
            onChange={(event) => setReference(event.target.value.toUpperCase())}
          />
        </label>
        <label>
          <span>{ar ? 'الرمز المكوّن من 6 أرقام' : '6-digit code'}</span>
          <input
            className="input"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            maxLength={7}
            onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, ''))}
          />
        </label>
        <button type="submit" className="button button--primary" disabled={loading}>
          {loading ? (ar ? 'جارٍ التحقق…' : 'Checking…') : ar ? 'تحقق من المستأجر' : 'Check tenant'}
        </button>
      </form>
    </section>
  );
}

function PhotoPicker({
  ar,
  label,
  max,
  photos,
  onChange,
}: {
  ar: boolean;
  label: string;
  max: number;
  photos: Photo[];
  onChange: (photos: Photo[]) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null, source: Photo['source']) {
    const picked = [...(files ?? [])].filter((file) => file.type.startsWith('image/'));
    const room = max - photos.length;
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
      onChange([...photos, ...added].slice(0, max));
    } catch {
      setError(ar ? 'تعذّرت قراءة إحدى الصور.' : 'A photo could not be read.');
    } finally {
      setReading(false);
    }
  }

  return (
    <fieldset className="handover-desk__photos">
      <legend>{label}</legend>
      <div className="handover-after__pick">
        <button
          type="button"
          className="button button--quiet"
          disabled={reading || photos.length >= max}
          onClick={() => cameraRef.current?.click()}
        >
          {ar ? 'تصوير' : 'Take photo'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={reading || photos.length >= max}
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
          multiple={max > 1}
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
      {error ? <p className="notice notice--error">{error}</p> : null}
    </fieldset>
  );
}

/** The staff member's own selfie from the front camera of their device, at the same moment as the tenant's. */
function HandlerSelfieCard({
  ar,
  locale,
  handoverKey,
  onSent,
}: {
  ar: boolean;
  locale: 'ar' | 'en';
  handoverKey: Key;
  onSent: (takenAt: string) => void;
}) {
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!shot) return;
    setBusy(true);
    setError(null);
    try {
      const data = await compressPhoto(fileFromDataUrl(shot), HANDOVER_PHOTO_MAX);
      const result = await browserNextMutation<{ takenAt: string }>('/api/handover', {
        method: 'POST',
        body: JSON.stringify({
          action: 'handler_selfie',
          key: handoverKey,
          photo: { data, takenAt: new Date().toISOString(), source: 'camera' },
        }),
      });
      onSent(result.takenAt);
    } catch (caught) {
      setError(errorMessage(caught, ar));
      setBusy(false);
    }
  }

  return (
    <section className="handover-desk__handler" aria-labelledby="handover-handler-title">
      <h3 id="handover-handler-title">
        {ar ? 'التقط صورة سيلفي لنفسك الآن' : 'Take a selfie of yourself now'}
      </h3>
      <p className="muted">
        {ar
          ? 'يُطلب من المستلم والمسلِّم التصوير في الوقت نفسه: المستأجر من هاتفه، وأنت من جهازك. تُرفق الصورتان بمحضر التسليم ويراهما المستأجر.'
          : 'The recipient and the handler are asked at the same time: the tenant on their phone, you on your device. Both photos join the handover record and the tenant sees them.'}
      </p>
      {shot ? (
        <div className="handover-selfie__review">
          <img src={shot} alt={ar ? 'صورتك' : 'Your selfie'} />
          <div className="handover-selfie__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void send()}
            >
              {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'اعتماد صورتي' : 'Use my photo'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => setShot(null)}
            >
              {ar ? 'إعادة الالتقاط' : 'Retake'}
            </button>
          </div>
        </div>
      ) : (
        <EsignCameraCapture
          locale={locale}
          facingMode="user"
          frame="selfie"
          onCaptured={setShot}
          onError={() =>
            setError(
              ar
                ? 'تعذّر تشغيل الكاميرا؛ اسمح بالوصول إليها أو التقط الصورة من زر الرفع.'
                : 'The camera could not start; allow access or use the upload button.',
            )
          }
        />
      )}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function HandoverForm({
  ar,
  locale,
  handoverKey,
  preview,
  onHandlerSelfie,
  onDone,
  onBack,
}: {
  ar: boolean;
  locale: 'ar' | 'en';
  handoverKey: Key;
  preview: Preview;
  onHandlerSelfie: (takenAt: string) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const [recipientName, setRecipientName] = useState(preview.tenantName);
  const [keys, setKeys] = useState('');
  const [electricity, setElectricity] = useState('');
  const [water, setWater] = useState('');
  const [elecPhoto, setElecPhoto] = useState<Photo[]>([]);
  const [waterPhoto, setWaterPhoto] = useState<Photo[]>([]);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metersReady =
    electricity.trim().length > 0 &&
    water.trim().length > 0 &&
    elecPhoto.length > 0 &&
    waterPhoto.length > 0;
  const unitName =
    locale === 'ar' ? preview.unit.nameAr : preview.unit.nameEn || preview.unit.nameAr;
  const propertyName =
    locale === 'ar' ? preview.property.nameAr : preview.property.nameEn || preview.property.nameAr;

  async function submit() {
    if (recipientName.trim().length < 2) return;
    if (!metersReady) {
      setError(
        ar
          ? 'أدخل قراءة الكهرباء والماء وأرفق صورة لكل عداد.'
          : 'Enter electricity and water readings and attach a photo of each meter.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation('/api/handover', {
        method: 'POST',
        body: JSON.stringify({
          action: 'offer',
          key: handoverKey,
          recipientName: recipientName.trim(),
          keys: keys.trim() || undefined,
          electricityReading: electricity.trim() || undefined,
          waterReading: water.trim() || undefined,
          notes: notes.trim() || undefined,
          photos: [...elecPhoto, ...waterPhoto, ...photos],
        }),
      });
      onDone();
    } catch (caught) {
      setError(errorMessage(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="handover-desk__form">
      <div className="handover-desk__tenant">
        <div className="handover-desk__faces">
          {preview.hasSelfie ? (
            <figure>
              <img
                className="handover-desk__selfie"
                src={selfieHref(handoverKey)}
                alt={ar ? 'صورة المستأجر عند التوقيع' : 'Tenant at signing'}
              />
              <figcaption>{ar ? 'عند التوقيع' : 'At signing'}</figcaption>
            </figure>
          ) : null}
          {preview.liveSelfieAt ? (
            <figure>
              <img
                className="handover-desk__selfie"
                src={`${selfieHref(handoverKey)}&live=1&v=${encodeURIComponent(preview.liveSelfieAt)}`}
                alt={ar ? 'سيلفي المستأجر الآن' : 'Tenant’s selfie now'}
              />
              <figcaption>{ar ? 'سيلفي الآن' : 'Selfie now'}</figcaption>
            </figure>
          ) : null}
          {preview.handlerSelfieAt ? (
            <figure>
              <img
                className="handover-desk__selfie"
                src={`${selfieHref(handoverKey)}&live=handler&v=${encodeURIComponent(preview.handlerSelfieAt)}`}
                alt={ar ? 'سيلفي المسلِّم' : 'Handler’s selfie'}
              />
              <figcaption>{ar ? 'أنت (المسلِّم)' : 'You (handler)'}</figcaption>
            </figure>
          ) : null}
        </div>
        <div>
          <span className="ops-kicker">
            {ar ? 'تعرّف النظام على المستأجر' : 'Tenant recognised'}
          </span>
          <h2>{preview.tenantName}</h2>
          <p>
            {propertyName} · {unitName}
          </p>
          <p className="muted" dir="ltr">
            {preview.referenceCode}
            {preview.contractReference ? ` · ${preview.contractReference}` : ''}
          </p>
          {preview.ready && !preview.awaitingTenant ? (
            preview.liveSelfieAt ? (
              <p className="notice notice--success" role="status">
                {ar
                  ? 'وصلت صورة السيلفي التي التقطها المستأجر بهاتفه الآن. طابقها مع الحاضر ومع صورة التوقيع، ثم أكمل المحضر.'
                  : 'The tenant’s selfie from their own phone has arrived. Match it with the person and the signing photo, then complete the record.'}
              </p>
            ) : (
              <p className="notice notice--info handover-desk__waiting" role="status">
                {ar
                  ? 'أرسلنا للمستأجر طلباً على هاتفه ليلتقط صورة سيلفي لنفسه الآن. ستظهر هنا تلقائياً فور التقاطها.'
                  : 'We asked the tenant’s phone for a selfie now. It appears here as soon as they take it.'}
              </p>
            )
          ) : null}
        </div>
      </div>

      {preview.ready && !preview.handlerSelfieAt ? (
        <HandlerSelfieCard
          ar={ar}
          locale={locale}
          handoverKey={handoverKey}
          onSent={onHandlerSelfie}
        />
      ) : null}

      {!preview.ready ? (
        <p className="notice notice--error">
          {preview.phase === 'handed_over'
            ? ar
              ? 'سُلّم هذا العقار من قبل واستلمه المستأجر.'
              : 'These premises were already handed over and accepted.'
            : ar
              ? 'لا يمكن التسليم الآن: لم يوقّع المستأجر العقد بعد أو الحجز غير نافذ.'
              : 'Handover is not open: the contract is not signed yet or the booking is not active.'}
        </p>
      ) : (
        <>
          {preview.awaitingTenant ? (
            <p className="notice notice--info">
              {ar
                ? 'سُجّل تسليم سابق وينتظر موافقة المستأجر؛ إرسال هذا المحضر يستبدله.'
                : 'A handover is already awaiting the tenant; sending this record replaces it.'}
            </p>
          ) : null}
          <div className="handover-desk__fields">
            <label>
              <span>{ar ? 'اسم المستلم' : 'Recipient name'}</span>
              <input
                className="input"
                value={recipientName}
                maxLength={120}
                onChange={(event) => setRecipientName(event.target.value)}
              />
            </label>
            <label>
              <span>{ar ? 'المفاتيح المسلّمة' : 'Keys handed over'}</span>
              <input
                className="input"
                value={keys}
                maxLength={200}
                placeholder={ar ? 'مثال: مفتاحان للباب وريموت' : 'e.g. two door keys and a remote'}
                onChange={(event) => setKeys(event.target.value)}
              />
            </label>
            <label>
              <span>
                {ar ? 'قراءة عداد الكهرباء' : 'Electricity reading'}
                <span aria-hidden="true"> *</span>
              </span>
              <input
                className="input"
                dir="ltr"
                required
                value={electricity}
                maxLength={40}
                onChange={(event) => setElectricity(event.target.value)}
              />
            </label>
            <div className="handover-desk__wide">
              <PhotoPicker
                ar={ar}
                label={ar ? 'صورة عداد الكهرباء *' : 'Electricity meter photo *'}
                max={1}
                photos={elecPhoto}
                onChange={setElecPhoto}
              />
            </div>
            <label>
              <span>
                {ar ? 'قراءة عداد الماء' : 'Water reading'}
                <span aria-hidden="true"> *</span>
              </span>
              <input
                className="input"
                dir="ltr"
                required
                value={water}
                maxLength={40}
                onChange={(event) => setWater(event.target.value)}
              />
            </label>
            <div className="handover-desk__wide">
              <PhotoPicker
                ar={ar}
                label={ar ? 'صورة عداد الماء *' : 'Water meter photo *'}
                max={1}
                photos={waterPhoto}
                onChange={setWaterPhoto}
              />
            </div>
            <label className="handover-desk__wide">
              <span>
                {ar
                  ? 'ملاحظات ممثل المالك قبل التسليم (تُرفق بالعقد ويُعتد بها)'
                  : 'Owner’s notes before handover (attached to the contract)'}
              </span>
              <textarea
                className="input"
                rows={3}
                maxLength={1000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <div className="handover-desk__wide">
              <NoteTranslateBar value={notes} onChange={setNotes} locale={locale} max={1000} />
            </div>
          </div>
          <PhotoPicker
            ar={ar}
            label={
              ar
                ? `صور العقار لتوثيق حالته (اختياري، حتى ${HANDOVER_PHOTOS_MAX})`
                : `Photos of the premises (optional, up to ${HANDOVER_PHOTOS_MAX})`
            }
            max={HANDOVER_PHOTOS_MAX}
            photos={photos}
            onChange={setPhotos}
          />
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="handover-desk__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={
                busy ||
                recipientName.trim().length < 2 ||
                !preview.handlerSelfieAt ||
                !metersReady
              }
              onClick={() => void submit()}
            >
              {busy
                ? ar
                  ? 'جارٍ الإرسال…'
                  : 'Sending…'
                : ar
                  ? 'إرسال المحضر لموافقة المستأجر'
                  : 'Send for the tenant’s acceptance'}
            </button>
            {!preview.handlerSelfieAt ? (
              <small className="muted">
                {ar
                  ? 'التقط صورتك السيلفي أعلاه أولاً؛ لا يُرسل المحضر بدون وجه المسلِّم.'
                  : 'Take your selfie above first; the record is not sent without the handler’s face.'}
              </small>
            ) : !preview.liveSelfieAt ? (
              <small className="muted">
                {ar
                  ? 'يمكنك الإرسال الآن؛ لن يستطيع المستأجر الموافقة على الاستلام قبل أن يلتقط صورته.'
                  : 'You can send now; the tenant cannot accept before taking their selfie.'}
              </small>
            ) : null}
          </div>
        </>
      )}
      <button type="button" className="button button--quiet" onClick={onBack}>
        {ar ? 'مسح رمز آخر' : 'Scan another code'}
      </button>
    </section>
  );
}
