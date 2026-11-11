'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { FilePreviewDialog, type PreviewFile } from '@/components/file-preview';
import { HandoverSelfieCard } from '@/components/handover-selfie';
import { compressPhoto } from '@/components/stays/stay-handover-form';
import { ApiError, browserNextMutation } from '@/lib/api';
import { claimProductSessionForActiveAu, ensureAuInUrl } from '@/lib/identity/client';
import { boundWindowToken, readActiveAu } from '@/lib/identity/window-session';
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
 * a mandatory recipient selfie once staff files the record, then the report + objection window.
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
  const router = useRouter();
  if (!handover) return <HandoverPass ar={ar} locale={locale} referenceCode={referenceCode} />;
  // Staff filed — recipient selfie is mandatory before the handed-over report appears.
  if (handover.status === 'awaiting_tenant' && !handover.hasRecipientPhoto) {
    return (
      <HandoverSelfieCard
        locale={locale}
        referenceCode={referenceCode}
        scannedBy={handover.byName}
        owed
        onSent={() => router.refresh()}
      />
    );
  }
  if (handover.status === 'awaiting_tenant' || handover.scanned || handover.status === 'accepted') {
    return <HandoverAfter ar={ar} referenceCode={referenceCode} handover={handover} />;
  }
  return null;
}

type PassStatus = 'loading' | 'ready' | 'retrying' | 'not_ready' | 'tenant_only' | 'forbidden';

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
  const [status, setStatus] = useState<PassStatus>('loading');
  const [selfie, setSelfie] = useState<SelfieState>(null);
  const [scannedBy, setScannedBy] = useState<string | null>(null);
  const passRef = useRef<Pass | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let inflight = false;

    type PassBody = {
      state?: string;
      selfie?: SelfieState;
      scannedBy?: string | null;
      error?: { code?: string };
    } & Partial<Pass>;

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), ms);
    };

    const readBody = async (response: Response): Promise<PassBody | null> =>
      (await response.json().catch(() => null)) as PassBody | null;

    const passHeaders = (): HeadersInit => {
      const headers: Record<string, string> = { accept: 'application/json' };
      const identityToken = boundWindowToken();
      if (identityToken) headers['x-bhd-identity-bearer'] = identityToken;
      return headers;
    };

    const fetchPass = async () => {
      ensureAuInUrl(readActiveAu() || undefined);
      // Best-effort cookie reclaim — ownership is proven by the tab Bearer below.
      await claimProductSessionForActiveAu().catch(() => ({ ok: false }));
      return fetch(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/handover?locale=${locale}`,
        { credentials: 'same-origin', cache: 'no-store', headers: passHeaders() },
      );
    };

    const keepPassThroughCookieRace = () => {
      // Owner tab stole the shared cookie — do not wipe a pass we already showed.
      if (passRef.current) setStatus('ready');
      else setStatus('tenant_only');
      schedule(8_000);
    };

    const load = async () => {
      if (stopped || inflight) return;
      inflight = true;
      try {
        let response = await fetchPass();
        let body = await readBody(response);
        if (stopped) return;

        if (response.status === 401) {
          if (passRef.current) {
            setStatus('ready');
            schedule(8_000);
            return;
          }
          setStatus('forbidden');
          return;
        }

        // Cookie still staff while this tab is the tenant: reclaim once, Bearer still sent.
        if (body?.state === 'tenant_only' || response.status === 403) {
          const claimed = await claimProductSessionForActiveAu().catch(() => ({ ok: false }));
          if (claimed.ok && !stopped) {
            response = await fetch(
              `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/handover?locale=${locale}`,
              { credentials: 'same-origin', cache: 'no-store', headers: passHeaders() },
            );
            body = await readBody(response);
          }
          if (stopped) return;
          if (body?.state === 'tenant_only' || response.status === 403) {
            keepPassThroughCookieRace();
            return;
          }
        }

        if (!response.ok || !body) {
          if (!passRef.current) setStatus('retrying');
          schedule(5_000);
          return;
        }
        if (body.state === 'tenant_only') {
          keepPassThroughCookieRace();
          return;
        }
        if (body.state === 'not_ready') {
          setStatus('not_ready');
          schedule(15_000);
          return;
        }
        if (body.state === 'pass' && body.qrSvg && body.code && body.refreshAt) {
          const next = body as Pass;
          passRef.current = next;
          setStatus('ready');
          setSelfie(body.selfie ?? null);
          setScannedBy(body.scannedBy ?? null);
          setPass((current) => (current?.refreshAt === next.refreshAt ? current : next));
          schedule(5_000);
          return;
        }
        if (body.state === 'awaiting_acceptance' || body.state === 'handed_over') {
          router.refresh();
          return;
        }
        if (!passRef.current) setStatus('retrying');
        schedule(5_000);
      } catch {
        if (!stopped) {
          if (!passRef.current) setStatus('retrying');
          schedule(5_000);
        }
      } finally {
        inflight = false;
      }
    };

    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [referenceCode, locale, router]);

  const statusCopy =
    status === 'tenant_only'
      ? ar
        ? 'رمز الاستلام خاص بحساب المستأجر الذي أنشأ الحجز. سجّل الدخول بذلك الحساب لعرض الرمز، أو امسح الرمز من جهاز المستأجر عند التسليم.'
        : 'The handover code is only for the tenant account that created this booking. Sign in as that tenant to view it, or scan it from their device at handover.'
      : status === 'forbidden'
        ? ar
          ? 'يجب تسجيل الدخول بحساب المستأجر لعرض رمز الاستلام.'
          : 'Sign in with the tenant account to view the handover code.'
        : status === 'not_ready'
          ? ar
            ? 'التسليم غير جاهز بعد — بعد اعتماد كل المستندات والشيكات يظهر الرمز هنا تلقائياً.'
            : 'Handover is not ready yet — the code appears here once every document and cheque is approved.'
          : status === 'retrying'
            ? ar
              ? 'تعذّر تحميل الرمز، نعيد المحاولة…'
              : 'Could not load the code; retrying…'
            : ar
              ? 'جارٍ إنشاء رمزك المشفّر…'
              : 'Creating your sealed code…';

  // Keep the QR/code visible until the handover record is filed — a staff refresh must
  // not hide the pass after the selfie was taken.
  return (
    <>
      {selfie === 'requested' ? (
        <HandoverSelfieCard
          locale={locale}
          referenceCode={referenceCode}
          scannedBy={scannedBy}
          onSent={() => setSelfie('sent')}
        />
      ) : null}
      <section
        className="guest-stay-detail__card handover-pass"
        aria-labelledby="handover-pass-title"
      >
        <h2 id="handover-pass-title">{ar ? 'رمز استلام العقار' : 'Your handover pass'}</h2>
        {selfie === 'sent' ? (
          <p className="notice notice--success" role="status">
            {ar
              ? `وصلت صورتك إلى ${scannedBy ?? 'ممثل المالك'}. أبقِ الرمز ظاهراً إن احتاج إعادة التحقق؛ المحضر يظهر هنا بعد أن يضغط على زر تسجيل التسليم.`
              : `Your photo reached ${scannedBy ?? 'the representative'}. Keep this code visible if they need to verify again; the record appears here only after they press file handover.`}
          </p>
        ) : (
          <p>
            {ar
              ? 'عند وصولك لاستلام المفاتيح اعرض هذا الرمز على المالك أو ممثله أو حارس المبنى ليمسحه. بمجرد تسجيل المحضر يظهر هنا للاطلاع، ويحق لك الاعتراض خلال المهلة.'
              : 'When you arrive for the keys, show this code to the owner, their representative or the building guard to scan. Once they file the record it appears here to view, and you may object within the window.'}
          </p>
        )}
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
            <p
              className={
                status === 'tenant_only' || status === 'forbidden' || status === 'not_ready'
                  ? 'notice notice--warning'
                  : 'muted'
              }
              role="status"
            >
              {statusCopy}
            </p>
          )}
        </div>
        <p className="handover-pass__note">
          {ar
            ? 'الرمز يبقى ظاهراً حتى يُسجَّل محضر التسليم؛ مشفّر وخاص بك ويتجدّد كل خمس دقائق.'
            : 'The code stays visible until the handover record is filed; it is sealed, yours alone and renews every five minutes.'}
        </p>
        {selfie === 'sent' ? <HandoverPhotoDuty ar={ar} /> : null}
      </section>
    </>
  );
}

/** The right to object after the record is filed: photos within three hours, or no defects. */
function HandoverPhotoDuty({ ar }: { ar: boolean }) {
  return (
    <p className="notice handover-duty" role="note">
      <strong>{ar ? 'تنبيه مهم: ' : 'Important: '}</strong>
      {ar
        ? 'بعد تسجيل محضر التسليم يحق لك رفع اعتراض مع صور خلال 3 ساعات، وإلا يُعتبر أنك استلمت العقار بدون عيوب وأنه في وضع جيد.'
        : 'After the handover record is filed you may object with photos within 3 hours; otherwise you are taken to have received the premises free of defects and in good condition.'}
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
    ...(handover.hasHandlerPhoto
      ? [
          {
            file: 'handover-handler',
            label: ar
              ? `من سلّمك المفتاح${handover.byName ? ` — ${handover.byName}` : ''}`
              : `Who handed you the key${handover.byName ? ` — ${handover.byName}` : ''}`,
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
  const until = handover.defectsUntil
    ? new Date(handover.defectsUntil).getTime()
    : new Date(handover.at).getTime() + 3 * 60 * 60 * 1000;
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
      <h2 id="handover-after-title">{ar ? 'محضر تسليم العقار' : 'Handover record'}</h2>
      <p>
        {ar
          ? `سُجّل محضر التسليم${handover.acceptedAt || handover.at ? ` في ${stamp(handover.acceptedAt ?? handover.at, ar)}` : ''} وأصبح نافذاً. اطّلع عليه أدناه؛ يحق لك رفع اعتراض خلال المهلة.`
          : `The handover record was filed${handover.acceptedAt || handover.at ? ` on ${stamp(handover.acceptedAt ?? handover.at, ar)}` : ''} and is in effect. Review it below; you may object within the window.`}
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
              ? `اعتراض على المحضر · متبقٍ ${minutesLeft} دقيقة`
              : `Object to the record · ${minutesLeft} minutes left`}
          </h3>
          <p className="muted">
            {ar
              ? 'صوّر أي عيوب أو مشاكل أو أشياء تحتاج إلى إصلاح، مع وصف مختصر. تُرفق بالمحضر ويُعتد بها. إن لم ترفع اعتراضاً قبل انتهاء المهلة يُعتبر أنك استلمت العقار بدون عيوب وفي وضع جيد.'
              : 'Photograph any defects or repairs needed, with a short note. They join the record. If you do not object before the window ends, you are taken to have received the premises free of defects and in good condition.'}
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
            {busy
              ? ar
                ? 'جارٍ الإرسال…'
                : 'Sending…'
              : ar
                ? 'إرسال الاعتراض'
                : 'Submit objection'}
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
