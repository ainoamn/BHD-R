'use client';

import { useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, fetchBrowserCsrfToken, humanizeBrowserError } from '@/lib/api';
import {
  BOOKING_TERMS_MAX_BODY,
  BOOKING_TERMS_MAX_LINES,
  BOOKING_TERMS_MODES,
  bookingTermsModeLabel,
  parseTermsBody,
  platformTerms,
  suggestedOwnerTerms,
  type BookingTermsMode,
  type OwnerBookingTerms,
} from '@/lib/booking-terms';

type Draft = { bodyAr: string; bodyEn: string; saved: OwnerBookingTerms | null };

async function putBookingTerms(
  propertyId: string,
  body: { mode: BookingTermsMode; bodyAr: string; bodyEn: string },
): Promise<{ ok: true; terms: OwnerBookingTerms | null }> {
  const send = async (csrf: string) =>
    fetch(`/api/owner/properties/${encodeURIComponent(propertyId)}/booking-terms`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  let response = await send(await fetchBrowserCsrfToken());
  if (response.status === 403) response = await send(await fetchBrowserCsrfToken(true));
  const payload = (await response.json().catch(() => null)) as
    | { ok?: true; terms?: OwnerBookingTerms | null; error?: { code?: string } }
    | null;
  if (!response.ok || !payload?.ok) {
    const code = payload?.error?.code ?? 'update_failed';
    throw new ApiError(response.status, code, code);
  }
  return { ok: true, terms: payload.terms ?? null };
}

function saveErrorMessage(error: unknown, ar: boolean): string {
  if (error instanceof ApiError) {
    if (error.code === 'forbidden') {
      return ar ? 'ليست لديك صلاحية تعديل شروط هذا العقار.' : 'You cannot edit terms for this property.';
    }
    if (error.code === 'property_archived') {
      return ar ? 'العقار مؤرشف — لا يمكن تعديل الشروط.' : 'This property is archived.';
    }
    if (error.code === 'invalid_body') {
      return ar ? 'النص طويل جداً — اختصر الشروط.' : 'The text is too long — shorten the terms.';
    }
  }
  return humanizeBrowserError(error, ar);
}

export function BookingTermsEditor({
  locale,
  portal,
  property,
  initialTerms,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  property: { id: string; nameAr: string; nameEn: string };
  initialTerms: Record<BookingTermsMode, OwnerBookingTerms | null>;
}) {
  const ar = locale === 'ar';
  const [mode, setMode] = useState<BookingTermsMode>('rent');
  const [drafts, setDrafts] = useState<Record<BookingTermsMode, Draft>>(() => {
    const entries = BOOKING_TERMS_MODES.map((key) => {
      const saved = initialTerms[key];
      return [key, { bodyAr: saved?.bodyAr ?? '', bodyEn: saved?.bodyEn ?? '', saved }] as const;
    });
    return Object.fromEntries(entries) as Record<BookingTermsMode, Draft>;
  });
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const draft = drafts[mode];
  const dirty =
    draft.bodyAr.trim() !== (draft.saved?.bodyAr ?? '').trim() ||
    draft.bodyEn.trim() !== (draft.saved?.bodyEn ?? '').trim();
  const ownerLines = parseTermsBody(ar ? draft.bodyAr : draft.bodyEn);
  const fallbackLines = parseTermsBody(ar ? draft.bodyEn : draft.bodyAr);
  const previewOwner = ownerLines.length
    ? ownerLines
    : fallbackLines.length
      ? fallbackLines
      : suggestedOwnerTerms(mode, ar);
  const previewPlatform = platformTerms({ mode, ar });
  const usingDefaults = !parseTermsBody(draft.bodyAr).length && !parseTermsBody(draft.bodyEn).length;
  const manageHref = `/${portal}/properties/${property.id}`;

  function updateDraft(patch: Partial<Draft>) {
    setMessage(null);
    setDrafts((current) => ({ ...current, [mode]: { ...current[mode], ...patch } }));
  }

  function fillSuggested() {
    updateDraft({
      bodyAr: suggestedOwnerTerms(mode, true).join('\n'),
      bodyEn: suggestedOwnerTerms(mode, false).join('\n'),
    });
  }

  function save(body: { bodyAr: string; bodyEn: string }) {
    const targetMode = mode;
    startTransition(async () => {
      setMessage(null);
      try {
        const result = await putBookingTerms(property.id, { mode: targetMode, ...body });
        setDrafts((current) => ({
          ...current,
          [targetMode]: {
            bodyAr: result.terms?.bodyAr ?? '',
            bodyEn: result.terms?.bodyEn ?? '',
            saved: result.terms,
          },
        }));
        setMessage({
          kind: 'success',
          text: result.terms
            ? ar
              ? `تم حفظ الشروط (الإصدار ${result.terms.version}) — ستظهر للعملاء في صفحة الحجز فوراً.`
              : `Terms saved (version ${result.terms.version}) — customers see them on the booking page now.`
            : ar
              ? 'تمت استعادة الشروط الافتراضية للمنصة.'
              : 'Platform default terms restored.',
        });
      } catch (caught) {
        setMessage({ kind: 'error', text: saveErrorMessage(caught, ar) });
      }
    });
  }

  return (
    <div className="form-shell booking-terms-editor">
      <header className="property-manage-hub__header">
        <div>
          <span className="ops-kicker">BHD R · {ar ? 'الشروط والأحكام' : 'TERMS & CONDITIONS'}</span>
          <h1>{ar ? property.nameAr : property.nameEn}</h1>
          <p className="muted">
            {ar
              ? 'اكتب شروط العقد التي يجب على المستأجر أو المشتري قراءتها والموافقة عليها قبل دفع مبلغ الضمان وتوقيع العقد.'
              : 'Write the contract terms the tenant or buyer must read and accept before paying the deposit and signing.'}
          </p>
        </div>
        <Link className="button button--quiet" href={manageHref} prefetch scroll={false}>
          {ar ? 'العودة لإدارة العقار' : 'Back to property'}
        </Link>
      </header>

      <div
        className="lease-checkout__modes booking-terms-editor__modes"
        role="tablist"
        aria-label={ar ? 'نوع العقد' : 'Contract type'}
      >
        {BOOKING_TERMS_MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            className={`button ${mode === option ? 'button--primary' : 'button--quiet'}`}
            onClick={() => {
              setMode(option);
              setMessage(null);
            }}
          >
            {bookingTermsModeLabel(option, ar)}
            {drafts[option].saved ? (
              <span className="booking-terms-editor__badge">{ar ? 'مخصّصة' : 'Custom'}</span>
            ) : null}
          </button>
        ))}
      </div>

      <p className="muted booking-terms-editor__status">
        {draft.saved
          ? ar
            ? `الإصدار الحالي: ${draft.saved.version} · آخر تحديث ${new Intl.DateTimeFormat('ar-OM', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(draft.saved.updatedAt))}`
            : `Current version: ${draft.saved.version} · updated ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(draft.saved.updatedAt))}`
          : ar
            ? 'لا توجد شروط مخصّصة — يرى العميل حالياً الشروط الافتراضية المقترحة.'
            : 'No custom terms — customers currently see the suggested defaults.'}
      </p>

      <div className="booking-terms-editor__grid">
        <div className="field">
          <label htmlFor="booking-terms-ar">
            {ar ? 'الشروط بالعربية (كل بند في سطر)' : 'Arabic terms (one clause per line)'}
          </label>
          <textarea
            id="booking-terms-ar"
            className="textarea booking-terms-editor__textarea"
            dir="rtl"
            maxLength={BOOKING_TERMS_MAX_BODY}
            value={draft.bodyAr}
            onChange={(event) => updateDraft({ bodyAr: event.target.value })}
            placeholder={suggestedOwnerTerms(mode, true).join('\n')}
          />
        </div>
        <div className="field">
          <label htmlFor="booking-terms-en">
            {ar ? 'الشروط بالإنجليزية (اختياري)' : 'English terms (optional)'}
          </label>
          <textarea
            id="booking-terms-en"
            className="textarea booking-terms-editor__textarea"
            dir="ltr"
            maxLength={BOOKING_TERMS_MAX_BODY}
            value={draft.bodyEn}
            onChange={(event) => updateDraft({ bodyEn: event.target.value })}
            placeholder={suggestedOwnerTerms(mode, false).join('\n')}
          />
        </div>
      </div>
      <p className="muted booking-terms-editor__hint">
        {ar
          ? `اكتب كل بند في سطر مستقل (حتى ${BOOKING_TERMS_MAX_LINES} بنداً). إذا تركت الإنجليزية فارغة تُعرض العربية للجميع.`
          : `One clause per line (up to ${BOOKING_TERMS_MAX_LINES}). If English is empty, the Arabic text is shown to everyone.`}
      </p>

      <div className="stays-checkout__nav booking-terms-editor__actions">
        <button type="button" className="button button--quiet" onClick={fillSuggested} disabled={pending}>
          {ar ? 'استخدم النموذج المقترح' : 'Use suggested template'}
        </button>
        {draft.saved ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={pending}
            onClick={() => save({ bodyAr: '', bodyEn: '' })}
          >
            {ar ? 'استعادة الشروط الافتراضية' : 'Restore defaults'}
          </button>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          disabled={pending || !dirty}
          onClick={() => save({ bodyAr: draft.bodyAr, bodyEn: draft.bodyEn })}
        >
          {pending ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ الشروط' : 'Save terms'}
        </button>
      </div>

      {message ? (
        <p
          className={`notice ${message.kind === 'success' ? 'notice--success' : 'notice--error'}`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}

      <section className="booking-terms-editor__preview" aria-labelledby="booking-terms-preview">
        <h2 id="booking-terms-preview">
          {ar ? 'معاينة ما يراه العميل' : 'Customer preview'}
          {usingDefaults ? (
            <span className="booking-terms-editor__badge">{ar ? 'افتراضية' : 'Default'}</span>
          ) : null}
        </h2>
        <ol className="lease-checkout__terms">
          {previewOwner.map((line, index) => (
            <li key={`o-${index}`}>{line}</li>
          ))}
          {previewPlatform.map((line, index) => (
            <li key={`p-${index}`} className="booking-terms-editor__platform">
              {line}
            </li>
          ))}
        </ol>
        <p className="muted booking-terms-editor__hint">
          {ar
            ? 'البنود المظللة تضيفها المنصة دائماً (مبلغ الضمان والتوقيع الإلكتروني) ولا يمكن حذفها. يجب على العميل التمرير حتى آخر الشروط قبل ظهور زر الموافقة.'
            : 'Shaded clauses are always added by the platform (deposit and e-signature). Customers must scroll to the end before the accept checkbox appears.'}
        </p>
      </section>
    </div>
  );
}
