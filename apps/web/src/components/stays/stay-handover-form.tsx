'use client';

import { useRef, useState, type ReactNode } from 'react';
import {
  HANDOVER_DOCUMENT_KINDS,
  HANDOVER_DOCUMENT_MAX,
  HANDOVER_NOTES,
  HANDOVER_PHOTOS_MAX,
  HANDOVER_PHOTO_MAX,
  validHandoverPhone,
  type HandoverKind,
  type HandoverPhotoSource,
} from '@/lib/stay-handover';
import { NoteTranslateBar } from '@/components/note-translate';
import { StampDateTimeField } from './stamp-date-time-field';

export type HandoverSubmit = {
  at: string;
  notes: string;
  noteKeys: string[];
  important: boolean;
  recipient?: { name?: string; phone: string; documentKind: string; document: string };
  photos: Array<{ data: string; source: HandoverPhotoSource; takenAt: string }>;
};

/** Reader's language first, the other underneath, so the form reads in Arabic and English. */
function Bi({ ar, en, primary }: { ar: string; en: string; primary: 'ar' | 'en' }) {
  const [first, second] = primary === 'ar' ? [ar, en] : [en, ar];
  return (
    <span className="handover-bi">
      <span>{first}</span>
      <small lang={primary === 'ar' ? 'en' : 'ar'} dir={primary === 'ar' ? 'ltr' : 'rtl'}>
        {second}
      </small>
    </span>
  );
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_unreadable'));
    };
    image.src = url;
  });
}

const DOCUMENT_STEPS = [
  [1800, 0.82],
  [1400, 0.72],
  [1100, 0.62],
] as const;
const PHOTO_STEPS = [
  [1600, 0.78],
  [1280, 0.7],
  [1024, 0.62],
  [800, 0.55],
] as const;

/** Phone photos are several MB; store a readable JPEG under the server limit. */
export function compressDocument(file: File): Promise<string> {
  return compressImage(file, HANDOVER_DOCUMENT_MAX, DOCUMENT_STEPS);
}

async function compressImage(
  file: File,
  max: number,
  steps: ReadonlyArray<readonly [number, number]>,
): Promise<string> {
  const image = await loadImage(file);
  for (const [edge, quality] of steps) {
    const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) break;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= max) return dataUrl;
  }
  throw new Error('image_too_large');
}

export function StayHandoverForm({
  kind,
  reference,
  locale,
  busy,
  guestPhone,
  onSubmit,
  onCancel,
}: {
  kind: HandoverKind;
  reference: string;
  locale: 'ar' | 'en';
  busy: boolean;
  guestPhone: string | null;
  onSubmit: (value: HandoverSubmit) => void;
  onCancel: () => void;
}) {
  const ar = locale === 'ar';
  const checkIn = kind === 'check_in';
  const id = `handover-${kind}-${reference}`;
  const [at, setAt] = useState<string | null>(null);
  const [noteKeys, setNoteKeys] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [important, setImportant] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [documentKind, setDocumentKind] = useState('civil_id');
  const [document, setDocument] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<HandoverSubmit['photos']>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoCameraRef = useRef<HTMLInputElement>(null);
  const photoDeviceRef = useRef<HTMLInputElement>(null);
  const photosFull = photos.length >= HANDOVER_PHOTOS_MAX;

  async function addPhotos(files: FileList | null, source: HandoverPhotoSource) {
    const picked = [...(files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!picked.length) return;
    setPhotoError(null);
    const room = HANDOVER_PHOTOS_MAX - photos.length;
    if (picked.length > room) {
      setPhotoError(
        ar
          ? `الحد الأقصى ${HANDOVER_PHOTOS_MAX} صور؛ أُضيفت أول ${room}. / Up to ${HANDOVER_PHOTOS_MAX} photos.`
          : `Up to ${HANDOVER_PHOTOS_MAX} photos; the first ${room} were added. / الحد الأقصى ${HANDOVER_PHOTOS_MAX} صور.`,
      );
    }
    setPhotoBusy(true);
    try {
      const added: HandoverSubmit['photos'] = [];
      for (const file of picked.slice(0, Math.max(room, 0))) {
        added.push({
          data: await compressImage(file, HANDOVER_PHOTO_MAX, PHOTO_STEPS),
          source,
          takenAt: new Date(source === 'camera' ? Date.now() : file.lastModified).toISOString(),
        });
      }
      setPhotos((current) => [...current, ...added].slice(0, HANDOVER_PHOTOS_MAX));
    } catch {
      setPhotoError(
        ar
          ? 'تعذّرت قراءة إحدى الصور، أعد المحاولة. / A photo could not be read; try again.'
          : 'A photo could not be read; try again. / تعذّرت قراءة إحدى الصور، أعد المحاولة.',
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  const bi = (arText: string, enText: string): ReactNode => (
    <Bi ar={arText} en={enText} primary={locale} />
  );
  const phoneOk = validHandoverPhone(phone);
  const missingDocument = checkIn && !document;
  const missingPhone = checkIn && !phoneOk;
  const ready = Boolean(at) && !missingDocument && !missingPhone && !reading && !photoBusy;

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    if (!file.type.startsWith('image/')) {
      setImageError(
        ar
          ? 'اختر صورة للوثيقة (JPG أو PNG). / Choose an image (JPG or PNG).'
          : 'Choose an image (JPG or PNG). / اختر صورة للوثيقة.',
      );
      return;
    }
    setReading(true);
    try {
      setDocument(await compressDocument(file));
    } catch {
      setImageError(
        ar
          ? 'تعذّرت قراءة الصورة، أعد التصوير. / The photo could not be read; retake it.'
          : 'The photo could not be read; retake it. / تعذّرت قراءة الصورة، أعد التصوير.',
      );
    } finally {
      setReading(false);
    }
  }

  function toggleNote(key: string) {
    setNoteKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  return (
    <form
      className="psr-form psr-stamp-form handover-form"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!ready || !at) return;
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
      }}
    >
      <h3>
        {checkIn
          ? bi(`تسجيل دخول الضيف — ${reference}`, `Guest check-in — ${reference}`)
          : bi(`تسجيل مغادرة الضيف — ${reference}`, `Guest check-out — ${reference}`)}
      </h3>
      <div className="form-grid">
        <StampDateTimeField
          id={`${id}-at`}
          locale={locale}
          onChange={setAt}
          label={
            checkIn
              ? ar
                ? 'تاريخ ووقت الاستلام والدخول · Check-in date and time'
                : 'Check-in date and time · تاريخ ووقت الاستلام والدخول'
              : ar
                ? 'تاريخ ووقت المغادرة · Check-out date and time'
                : 'Check-out date and time · تاريخ ووقت المغادرة'
          }
        />

        {checkIn ? (
          <fieldset className="field span-2 handover-recipient">
            <legend>{bi('المستلم ووثيقته', 'Recipient and ID document')}</legend>
            <div className="handover-recipient__grid">
              <div className="field">
                <label htmlFor={`${id}-phone`}>
                  {bi('رقم هاتف المستلم *', 'Recipient phone *')}
                </label>
                <input
                  id={`${id}-phone`}
                  className="input"
                  type="tel"
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="+968 9X XXX XXX"
                  maxLength={32}
                  value={phone}
                  aria-invalid={tried && missingPhone}
                  onChange={(event) => setPhone(event.target.value)}
                />
                {guestPhone && phone.trim() !== guestPhone ? (
                  <button
                    type="button"
                    className="stamp-dt__chip handover-chip-inline"
                    onClick={() => setPhone(guestPhone)}
                  >
                    {ar ? 'رقم الضيف · Guest phone' : 'Guest phone · رقم الضيف'}:{' '}
                    <bdi dir="ltr">{guestPhone}</bdi>
                  </button>
                ) : null}
                {tried && missingPhone ? (
                  <small className="stamp-dt__error" role="alert">
                    {ar
                      ? 'أدخل رقم هاتف صحيحاً. / Enter a valid phone number.'
                      : 'Enter a valid phone number. / أدخل رقم هاتف صحيحاً.'}
                  </small>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor={`${id}-name`}>
                  {bi('اسم المستلم (اختياري)', 'Recipient name (optional)')}
                </label>
                <input
                  id={`${id}-name`}
                  className="input"
                  autoComplete="off"
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`${id}-doc-kind`}>{bi('نوع الوثيقة', 'Document type')}</label>
                <select
                  id={`${id}-doc-kind`}
                  className="input"
                  value={documentKind}
                  onChange={(event) => setDocumentKind(event.target.value)}
                >
                  {HANDOVER_DOCUMENT_KINDS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {ar ? `${item.ar} · ${item.en}` : `${item.en} · ${item.ar}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              className={`handover-doc${tried && missingDocument ? ' handover-doc--missing' : ''}`}
            >
              <span className="handover-doc__label">
                {bi('صورة وثيقة المستلم *', 'Photo of the recipient’s ID *')}
              </span>
              {document ? (
                <figure className="handover-doc__preview">
                  <img src={document} alt={ar ? 'وثيقة المستلم' : 'Recipient ID'} />
                </figure>
              ) : null}
              <div className="handover-doc__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={reading}
                  onClick={() => cameraRef.current?.click()}
                >
                  📷{' '}
                  {document
                    ? ar
                      ? 'إعادة التصوير · Retake'
                      : 'Retake · إعادة التصوير'
                    : ar
                      ? 'تصوير الوثيقة · Take photo'
                      : 'Take photo · تصوير الوثيقة'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={reading}
                  onClick={() => uploadRef.current?.click()}
                >
                  ⬆ {ar ? 'رفع صورة · Upload' : 'Upload · رفع صورة'}
                </button>
                {document ? (
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => setDocument(null)}
                  >
                    {ar ? 'إزالة · Remove' : 'Remove · إزالة'}
                  </button>
                ) : null}
              </div>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(event) => {
                  void pickFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <input
                ref={uploadRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                hidden
                onChange={(event) => {
                  void pickFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {reading ? (
                <small className="muted">
                  {ar
                    ? 'جارٍ تجهيز الصورة… · Preparing photo…'
                    : 'Preparing photo… · جارٍ تجهيز الصورة…'}
                </small>
              ) : null}
              {imageError ? (
                <small className="stamp-dt__error" role="alert">
                  {imageError}
                </small>
              ) : tried && missingDocument ? (
                <small className="stamp-dt__error" role="alert">
                  {ar
                    ? 'صورة الوثيقة مطلوبة لإتمام الاستلام. / The ID photo is required.'
                    : 'The ID photo is required. / صورة الوثيقة مطلوبة لإتمام الاستلام.'}
                </small>
              ) : (
                <small className="muted">
                  {ar
                    ? 'تُحفظ الصورة بشكل خاص ولا يراها إلا مديرو الحجوزات. · Stored privately; visible to booking managers only.'
                    : 'Stored privately; visible to booking managers only. · تُحفظ الصورة بشكل خاص ولا يراها إلا مديرو الحجوزات.'}
                </small>
              )}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="field span-2 handover-photos">
          <legend>
            {bi(
              `صور حالة الوحدة (اختياري، حتى ${HANDOVER_PHOTOS_MAX})`,
              `Unit condition photos (optional, up to ${HANDOVER_PHOTOS_MAX})`,
            )}
          </legend>
          {photos.length ? (
            <ol className="handover-photos__grid">
              {photos.map((photo, index) => (
                <li key={`${photo.takenAt}-${index}`}>
                  <img src={photo.data} alt={ar ? `صورة ${index + 1}` : `Photo ${index + 1}`} />
                  <span className="handover-photos__tag">
                    {index + 1} ·{' '}
                    {photo.source === 'camera'
                      ? ar
                        ? 'تصوير فوري'
                        : 'Live photo'
                      : ar
                        ? 'من الجهاز'
                        : 'From device'}
                  </span>
                  <button
                    type="button"
                    className="handover-photos__remove"
                    aria-label={ar ? `حذف الصورة ${index + 1}` : `Remove photo ${index + 1}`}
                    onClick={() =>
                      setPhotos((current) => current.filter((_, position) => position !== index))
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
              📷 {ar ? 'تصوير فوري · Take photo' : 'Take photo · تصوير فوري'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={photoBusy || photosFull}
              onClick={() => photoDeviceRef.current?.click()}
            >
              🖼 {ar ? 'من الجهاز · From device' : 'From device · من الجهاز'}
            </button>
            <span className="muted handover-photos__count" dir="ltr">
              {photos.length} / {HANDOVER_PHOTOS_MAX}
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
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            hidden
            onChange={(event) => {
              void addPhotos(event.target.files, 'device');
              event.target.value = '';
            }}
          />
          {photoBusy ? (
            <small className="muted">
              {ar
                ? 'جارٍ تجهيز الصور… · Preparing photos…'
                : 'Preparing photos… · جارٍ تجهيز الصور…'}
            </small>
          ) : photoError ? (
            <small className="stamp-dt__error" role="alert">
              {photoError}
            </small>
          ) : (
            <small className="muted">
              {ar
                ? 'تُرفق الصور بمحضر الاستلام أو التسليم ببصمة لكل صورة، ويوقَّع عليها مع المحضر. · Photos join the handover record, each with a fingerprint, and are signed with it.'
                : 'Photos join the handover record, each with a fingerprint, and are signed with it. · تُرفق الصور بالمحضر ويوقَّع عليها معه.'}
            </small>
          )}
        </fieldset>

        <fieldset className="field span-2 handover-notes">
          <legend>{bi('ملاحظات جاهزة (اختر ما ينطبق)', 'Quick notes (pick any)')}</legend>
          <div className="handover-notes__chips">
            {HANDOVER_NOTES[kind].map((item) => {
              const on = noteKeys.includes(item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`handover-note${on ? ' handover-note--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleNote(item.key)}
                >
                  <span>{ar ? item.ar : item.en}</span>
                  <small>{ar ? item.en : item.ar}</small>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="field span-2">
          <label htmlFor={`${id}-notes`}>{bi('ملاحظة خاصة', 'Custom note')}</label>
          <textarea
            id={`${id}-notes`}
            className="textarea"
            rows={2}
            maxLength={1000}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder={
              checkIn
                ? ar
                  ? 'اكتب أي ملاحظة إضافية… · Any other note…'
                  : 'Any other note… · اكتب أي ملاحظة إضافية…'
                : ar
                  ? 'مثال: أضرار، مستلزمات ناقصة… · e.g. damage, missing items…'
                  : 'e.g. damage, missing items… · مثال: أضرار، مستلزمات ناقصة…'
            }
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
            {bi('ملاحظة مهمة — تظهر بتمييز', 'Important — highlight this note')}
          </label>
        </div>
      </div>
      <p className="muted">
        {ar
          ? 'يظهر الوقت والملاحظات للضيف في صفحة إقامته. رقم الهاتف وصورة الوثيقة لا تظهر له. · The guest sees the time and notes; the phone and ID photo stay private.'
          : 'The guest sees the time and notes; the phone and ID photo stay private. · يظهر الوقت والملاحظات للضيف، ورقم الهاتف وصورة الوثيقة لا تظهر له.'}
      </p>
      <div className="form-actions">
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || reading || photoBusy || !at}
        >
          {busy
            ? ar
              ? 'جارٍ الحفظ…'
              : 'Saving…'
            : checkIn
              ? ar
                ? 'تأكيد الدخول · Confirm check-in'
                : 'Confirm check-in · تأكيد الدخول'
              : ar
                ? 'تأكيد المغادرة · Confirm check-out'
                : 'Confirm check-out · تأكيد المغادرة'}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel} disabled={busy}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}
