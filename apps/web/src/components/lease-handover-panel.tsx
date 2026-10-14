'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { FilePreviewDialog, type PreviewFile } from '@/components/file-preview';
import { HandoverSelfieCard } from '@/components/handover-selfie';
import { compressPhoto } from '@/components/stays/stay-handover-form';
import { ApiError, browserNextMutation } from '@/lib/api';
import type { LeaseLifecycleView } from '@/lib/public-lease-booking-neon';
import { HANDOVER_PHOTOS_MAX, HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';

type HandoverView = NonNullable<LeaseLifecycleView['handover']>;
type Pass = { qrSvg: string; code: string; expiresAt: string; refreshAt: string };
type Photo = { data: string; takenAt: string; source: 'camera' | 'device' };
type SelfieState = 'requested' | 'sent' | null;

const stamp = (iso: string, ar: boolean) =>
  new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

function errorMessage(error: unknown, ar: boolean): string {
  if (error instanceof ApiError && error.message && error.code !== 'api_error')
    return error.message;
  return ar ? 'تعذّر إتمام الطلب، أعد المحاولة.' : 'The request failed; try again.';
}

/**
 * The tenant's side of the handover on their booking page: the sealed pass to show at the door,
 * then the record the staff member made to accept, then three hours to report defects.
 */
export function LeaseHandoverPanel({
  locale,
  referenceCode,
  handover,
}: {
  locale: 'ar' | 'en';
  referenceCode: string;
  handover: HandoverView | null;
}) {
  const ar = locale === 'ar';
  if (!handover) return <HandoverPass ar={ar} locale={locale} referenceCode={referenceCode} />;
  if (handover.status === 'awaiting_tenant') {
    return (
      <HandoverAcceptance
        ar={ar}
        locale={locale}
        referenceCode={referenceCode}
        handover={handover}
      />
    );
  }
  if (!handover.scanned) return null;
  return <HandoverAfter ar={ar} referenceCode={referenceCode} handover={handover} />;
}

function HandoverPass({
  ar,
  locale,
  referenceCode,
}: {
  ar: boolean;
  locale: 'ar' | 'en';
  referenceCode: string;
}) {
  const router = useRouter();
  const [pass, setPass] = useState<Pass | null>(null);
  const [failed, setFailed] = useState(false);
  const [selfie, setSelfie] = useState<SelfieState>(null);
  const [scannedBy, setScannedBy] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/handover?locale=${locale}`,
          { credentials: 'same-origin', cache: 'no-store' },
        );
        const body = (await response.json().catch(() => null)) as
          | ({ state?: string; selfie?: SelfieState; scannedBy?: string | null } & Partial<Pass>)
          | null;
        if (stopped) return;
        if (!response.ok || !body) {
          setFailed(true);
        } else if (body.state === 'pass' && body.qrSvg && body.code && body.refreshAt) {
          setFailed(false);
          setSelfie(body.selfie ?? null);
          setScannedBy(body.scannedBy ?? null);
          setPass((current) => (current?.refreshAt === body.refreshAt ? current : (body as Pass)));
        } else if (body.state === 'awaiting_acceptance' || body.state === 'handed_over') {
          router.refresh();
          return;
        }
      } catch {
        if (!stopped) setFailed(true);
      }
      if (!stopped) timer = window.setTimeout(() => void load(), 5000);
    };
    void load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [referenceCode, locale, router]);

  if (selfie === 'requested') {
    return (
      <HandoverSelfieCard
        locale={locale}
        referenceCode={referenceCode}
        scannedBy={scannedBy}
        onSent={() => setSelfie('sent')}
      />
    );
  }
  if (selfie === 'sent') {
    return (
      <section
        className="guest-stay-detail__card handover-pass"
        aria-labelledby="handover-pass-title"
      >
        <h2 id="handover-pass-title">{ar ? 'وصلت صورتك' : 'Your selfie arrived'}</h2>
        <p className="notice notice--success" role="status">
          {ar
            ? `ظهرت صورتك الآن لدى ${scannedBy ?? 'ممثل المالك'}. انتظر قليلاً؛ سيصلك محضر التسليم هنا لتراجعه وتوافق عليه.`
            : `Your photo is now on ${scannedBy ?? 'the representative'}’s screen. Wait a moment; the handover record will arrive here for you to review and accept.`}
        </p>
        <HandoverPhotoDuty ar={ar} />
      </section>
    );
  }

  return (
    <section
      className="guest-stay-detail__card handover-pass"
      aria-labelledby="handover-pass-title"
    >
      <h2 id="handover-pass-title">{ar ? 'رمز استلام العقار' : 'Your handover pass'}</h2>
      <p>
        {ar
          ? 'عند وصولك لاستلام المفاتيح اعرض هذا الرمز على المالك أو ممثله أو حارس المبنى ليمسحه. بمجرد مسحه يتعرّف النظام عليك، ويصلك هنا محضر التسليم لتوافق عليه.'
          : 'When you arrive for the keys, show this code to the owner, their representative or the building guard to scan. The system recognises you and the handover record arrives here for you to accept.'}
      </p>
      <div className="handover-pass__body">
        {pass ? (
          <>
            <span
              className="handover-pass__qr"
              role="img"
              aria-label={ar ? 'رمز التسليم' : 'Handover code'}
              dangerouslySetInnerHTML={{ __html: pass.qrSvg }}
            />
            <div className="handover-pass__facts">
              <span>{ar ? 'رقم الحجز' : 'Booking'}</span>
              <strong dir="ltr">{referenceCode}</strong>
              <span>{ar ? 'الرمز اليدوي' : 'Manual code'}</span>
              <strong dir="ltr" className="handover-pass__code">
                {pass.code.slice(0, 3)} {pass.code.slice(3)}
              </strong>
              <small className="muted">
                {ar
                  ? `يتجدد تلقائياً · صالح حتى ${stamp(pass.expiresAt, ar)}`
                  : `Renews automatically · valid until ${stamp(pass.expiresAt, ar)}`}
              </small>
            </div>
          </>
        ) : (
          <p className="muted" role="status">
            {failed
              ? ar
                ? 'تعذّر تحميل الرمز، نعيد المحاولة…'
                : 'Could not load the code; retrying…'
              : ar
                ? 'جارٍ إنشاء رمزك المشفّر…'
                : 'Creating your sealed code…'}
          </p>
        )}
      </div>
      <p className="handover-pass__note">
        {ar
          ? 'الرمز مشفّر وخاص بك وحدك، ويتغيّر كل خمس دقائق؛ لا ترسله لأحد ولا تعرضه قبل وصولك.'
          : 'The code is sealed, yours alone and changes every five minutes; do not send it or show it before you arrive.'}
      </p>
    </section>
  );
}

/** The duty that follows the keys: photos of the premises within three hours, or no defects. */
function HandoverPhotoDuty({ ar }: { ar: boolean }) {
  return (
    <p className="notice handover-duty" role="note">
      <strong>{ar ? 'تنبيه مهم: ' : 'Important: '}</strong>
      {ar
        ? 'بعد استلام العقار عليك رفع صور للعقار فوراً خلال 3 ساعات، وإلا يُعتبر أنك استلمت العقار بدون عيوب وأنه في وضع جيد.'
        : 'After receiving the premises you must upload photos of them within 3 hours; otherwise you are taken to have received them free of defects and in good condition.'}
    </p>
  );
}

function HandoverRecord({
  ar,
  referenceCode,
  handover,
  onPreview,
}: {
  ar: boolean;
  referenceCode: string;
  handover: HandoverView;
  onPreview: (file: PreviewFile) => void;
}) {
  const photoHref = (file: string) =>
    `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/handover/photos/${file}`;
  const shots: Array<{ file: string; label: string }> = [
    ...(handover.hasRecipientPhoto
      ? [
          {
            file: 'handover-recipient',
            label: ar ? 'صورتك عند استلام المفتاح' : 'You receiving the key',
          },
        ]
      : []),
    ...handover.photos.map((index) => ({
      file: `handover-${index}`,
      label: ar ? `صورة العقار ${index + 1}` : `Premises photo ${index + 1}`,
    })),
  ];
  return (
    <>
      <dl className="guest-stay-detail__facts">
        <div>
          <dt>{ar ? 'سلّمه' : 'Handed over by'}</dt>
          <dd>{handover.byName ?? '—'}</dd>
        </div>
        <div>
          <dt>{ar ? 'وقت التسليم' : 'Recorded at'}</dt>
          <dd>{stamp(handover.at, ar)}</dd>
        </div>
        <div>
          <dt>{ar ? 'المستلم' : 'Received by'}</dt>
          <dd>{handover.recipientName}</dd>
        </div>
        {handover.keys ? (
          <div>
            <dt>{ar ? 'المفاتيح' : 'Keys'}</dt>
            <dd>{handover.keys}</dd>
          </div>
        ) : null}
        {handover.electricityReading ? (
          <div>
            <dt>{ar ? 'عداد الكهرباء' : 'Electricity meter'}</dt>
            <dd dir="ltr">{handover.electricityReading}</dd>
          </div>
        ) : null}
        {handover.waterReading ? (
          <div>
            <dt>{ar ? 'عداد الماء' : 'Water meter'}</dt>
            <dd dir="ltr">{handover.waterReading}</dd>
          </div>
        ) : null}
        {handover.notes ? (
          <div>
            <dt>{ar ? 'ملاحظات ممثل المالك' : 'Owner’s notes'}</dt>
            <dd>{handover.notes}</dd>
          </div>
        ) : null}
      </dl>
      {shots.length ? (
        <div className="handover-shots">
          {shots.map((shot) => (
            <button
              key={shot.file}
              type="button"
              className="handover-shots__item"
              onClick={() => onPreview({ href: photoHref(shot.file), label: shot.label })}
            >
              <img src={photoHref(shot.file)} alt={shot.label} loading="lazy" />
              <span>{shot.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function HandoverAcceptance({
  ar,
  locale,
  referenceCode,
  handover,
}: {
  ar: boolean;
  locale: 'ar' | 'en';
  referenceCode: string;
  handover: HandoverView;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewFile | null>(null);

  if (!handover.hasRecipientPhoto) {
    return (
      <HandoverSelfieCard
        locale={locale}
        referenceCode={referenceCode}
        scannedBy={handover.byName}
        owed
        onSent={() => startRefresh(() => router.refresh())}
      />
    );
  }

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/handover`,
        { method: 'POST', body: JSON.stringify({ action: 'accept' }) },
      );
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(errorMessage(caught, ar));
      setBusy(false);
    }
  }

  return (
    <section
      className="guest-stay-detail__card handover-accept"
      aria-labelledby="handover-accept-title"
    >
      <h2 id="handover-accept-title">{ar ? 'محضر تسليم العقار' : 'Handover record'}</h2>
      <p>
        {ar
          ? 'تعرّف النظام عليك بمسح رمزك، وسجّل ممثل المالك تسليم العقار إليك كما يلي. راجع المحضر والصور ثم أكّد الاستلام.'
          : 'The system recognised you from your code, and the owner’s representative recorded the handover below. Review it and the photos, then confirm.'}
      </p>
      <HandoverRecord
        ar={ar}
        referenceCode={referenceCode}
        handover={handover}
        onPreview={setPreview}
      />
      <p className="notice notice--info">
        {ar
          ? 'بموافقتك يُعدّ العقار مسلَّماً إليك بالطريقة القانونية والنظامية.'
          : 'By confirming, the premises are legally and formally handed over to you.'}
      </p>
      <HandoverPhotoDuty ar={ar} />
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--primary"
        disabled={busy}
        onClick={() => void accept()}
      >
        {busy
          ? ar
            ? 'جارٍ التأكيد…'
            : 'Confirming…'
          : ar
            ? 'أوافق على استلام العقار'
            : 'I accept the premises'}
      </button>
      {preview ? (
        <FilePreviewDialog file={preview} ar={ar} onClose={() => setPreview(null)} />
      ) : null}
    </section>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function HandoverAfter({
  ar,
  referenceCode,
  handover,
}: {
  ar: boolean;
  referenceCode: string;
  handover: HandoverView;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const now = useNow(30_000);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);
  const until = handover.defectsUntil ? new Date(handover.defectsUntil).getTime() : 0;
  const open = !handover.defects && until > now;
  const minutesLeft = Math.max(0, Math.ceil((until - now) / 60_000));
  const photoHref = (file: string) =>
    `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/handover/photos/${file}`;

  async function addPhotos(files: FileList | null, source: Photo['source']) {
    const picked = [...(files ?? [])].filter((file) => file.type.startsWith('image/'));
    const room = HANDOVER_PHOTOS_MAX - photos.length;
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
      setPhotos((current) => [...current, ...added].slice(0, HANDOVER_PHOTOS_MAX));
    } catch {
      setError(ar ? 'تعذّرت قراءة إحدى الصور.' : 'A photo could not be read.');
    } finally {
      setReading(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/handover`,
        {
          method: 'POST',
          body: JSON.stringify({ action: 'defects', note: note.trim() || undefined, photos }),
        },
      );
      setPhotos([]);
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(errorMessage(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="guest-stay-detail__card handover-after"
      aria-labelledby="handover-after-title"
    >
      <h2 id="handover-after-title">{ar ? 'استلام العقار' : 'Premises received'}</h2>
      <p>
        {ar
          ? `أكّدت استلام العقار${handover.acceptedAt ? ` في ${stamp(handover.acceptedAt, ar)}` : ''}، وأصبح التسليم رسمياً ومكمّلاً للعقد.`
          : `You accepted the premises${handover.acceptedAt ? ` on ${stamp(handover.acceptedAt, ar)}` : ''}; the handover is official and completes the contract.`}
      </p>
      <HandoverRecord
        ar={ar}
        referenceCode={referenceCode}
        handover={handover}
        onPreview={setPreview}
      />

      {handover.defects ? (
        <div className="handover-after__defects">
          <h3>{ar ? 'ملاحظات الاستلام التي أرسلتها' : 'Defects you reported'}</h3>
          <p className="muted">{stamp(handover.defects.at, ar)}</p>
          {handover.defects.note ? <p>{handover.defects.note}</p> : null}
          <div className="handover-shots">
            {handover.defects.photos.map((index) => {
              const label = ar ? `ملاحظة ${index + 1}` : `Defect ${index + 1}`;
              return (
                <button
                  key={index}
                  type="button"
                  className="handover-shots__item"
                  onClick={() => setPreview({ href: photoHref(`defect-${index}`), label })}
                >
                  <img src={photoHref(`defect-${index}`)} alt={label} loading="lazy" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : open ? (
        <div className="handover-after__defects">
          <HandoverPhotoDuty ar={ar} />
          <h3>
            {ar
              ? `ارفع صور العقار الآن · متبقٍ ${minutesLeft} دقيقة`
              : `Upload photos of the premises now · ${minutesLeft} minutes left`}
          </h3>
          <p className="muted">
            {ar
              ? 'صوّر العقار وأي عيوب أو مشاكل أو أشياء تحتاج إلى إصلاح، مع وصف مختصر. تُرفق بمحضر التسليم ويُعتد بها. إن لم ترفع صوراً قبل انتهاء المهلة يُعتبر أنك استلمت العقار بدون عيوب وفي وضع جيد.'
              : 'Photograph the premises and any defects or repairs needed, with a short note. They join the handover record. If none are sent before the window ends, you are taken to have received the premises free of defects and in good condition.'}
          </p>
          <div className="handover-after__pick">
            <button
              type="button"
              className="button button--quiet"
              disabled={reading || photos.length >= HANDOVER_PHOTOS_MAX}
              onClick={() => cameraRef.current?.click()}
            >
              {ar ? 'تصوير' : 'Take photo'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={reading || photos.length >= HANDOVER_PHOTOS_MAX}
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
                void addPhotos(event.target.files, 'camera');
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
                void addPhotos(event.target.files, 'device');
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
                    onClick={() => setPhotos((current) => current.filter((_, at) => at !== index))}
                  >
                    {ar ? 'إزالة' : 'Remove'}
                  </button>
                </figure>
              ))}
            </div>
          ) : null}
          <label className="handover-after__note">
            <span>{ar ? 'وصف الملاحظات' : 'Describe the issues'}</span>
            <textarea
              className="input"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="button button--primary"
            disabled={busy || reading || !photos.length}
            onClick={() => void submit()}
          >
            {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'إرسال صور العقار' : 'Send photos'}
          </button>
        </div>
      ) : (
        <p className="notice notice--info">
          {ar
            ? 'انتهت مهلة الساعات الثلاث دون صور، واعتُبر أنك استلمت العقار بدون عيوب وفي وضع جيد.'
            : 'The three-hour window ended without photos; you are taken to have received the premises free of defects and in good condition.'}
        </p>
      )}
      {preview ? (
        <FilePreviewDialog file={preview} ar={ar} onClose={() => setPreview(null)} />
      ) : null}
    </section>
  );
}
