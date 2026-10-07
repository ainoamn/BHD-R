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
type TermsMap = Record<BookingTermsMode, OwnerBookingTerms | null>;

export type BookingTermsEditorTarget =
  | { kind: 'organization' }
  | { kind: 'property'; property: { id: string; nameAr: string; nameEn: string } };

function hasText(terms: { bodyAr: string | null; bodyEn: string | null } | null | undefined) {
  return Boolean(
    terms && (parseTermsBody(terms.bodyAr).length || parseTermsBody(terms.bodyEn).length),
  );
}

function formatDate(value: string, ar: boolean) {
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function putBookingTerms(
  target: BookingTermsEditorTarget,
  body: { mode: BookingTermsMode; bodyAr: string; bodyEn: string },
): Promise<{ ok: true; terms: OwnerBookingTerms | null }> {
  const url =
    target.kind === 'organization'
      ? '/api/owner/booking-terms'
      : `/api/owner/properties/${encodeURIComponent(target.property.id)}/booking-terms`;
  const send = async (csrf: string) =>
    fetch(url, {
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
  const payload = (await response.json().catch(() => null)) as {
    ok?: true;
    terms?: OwnerBookingTerms | null;
    error?: { code?: string };
  } | null;
  if (!response.ok || !payload?.ok) {
    const code = payload?.error?.code ?? 'update_failed';
    throw new ApiError(response.status, code, code);
  }
  return { ok: true, terms: payload.terms ?? null };
}

function saveErrorMessage(error: unknown, ar: boolean): string {
  if (error instanceof ApiError) {
    if (error.code === 'forbidden') {
      return ar
        ? 'ليست لديك صلاحية تعديل الشروط والأحكام.'
        : 'You cannot edit terms and conditions.';
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
  target,
  initialTerms,
  organizationTerms,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  target: BookingTermsEditorTarget;
  initialTerms: TermsMap;
  /** Organization template the property inherits when it has no custom terms. */
  organizationTerms?: TermsMap;
}) {
  const ar = locale === 'ar';
  const isTemplate = target.kind === 'organization';
  const fieldPrefix = isTemplate ? 'org-terms' : 'property-terms';
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
  const inherited = isTemplate ? null : (organizationTerms?.[mode] ?? null);
  const dirty =
    draft.bodyAr.trim() !== (draft.saved?.bodyAr ?? '').trim() ||
    draft.bodyEn.trim() !== (draft.saved?.bodyEn ?? '').trim();
  const draftHasText = hasText(draft);

  const linesIn = (source: { bodyAr: string | null; bodyEn: string | null }) => {
    const primary = parseTermsBody(ar ? source.bodyAr : source.bodyEn);
    return primary.length ? primary : parseTermsBody(ar ? source.bodyEn : source.bodyAr);
  };
  const previewSource: 'custom' | 'template' | 'default' = draftHasText
    ? 'custom'
    : hasText(inherited)
      ? 'template'
      : 'default';
  const previewOwner =
    previewSource === 'custom'
      ? linesIn(draft)
      : previewSource === 'template' && inherited
        ? linesIn(inherited)
        : suggestedOwnerTerms(mode, ar);
  const previewPlatform = platformTerms({ mode, ar });

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

  function fillFromTemplate() {
    if (hasText(inherited)) {
      updateDraft({ bodyAr: inherited?.bodyAr ?? '', bodyEn: inherited?.bodyEn ?? '' });
    } else {
      fillSuggested();
    }
  }

  function savedMessage(terms: OwnerBookingTerms | null): string {
    if (terms) {
      if (isTemplate) {
        return ar
          ? `تم حفظ الصيغة الموحدة (الإصدار ${terms.version}) — تُطبّق فوراً على كل العقارات التي لا تملك شروطاً مخصّصة.`
          : `Standard terms saved (version ${terms.version}) — applied now to every property without custom terms.`;
      }
      return ar
        ? `تم حفظ الشروط المخصّصة لهذا العقار (الإصدار ${terms.version}) — ستظهر للعملاء في صفحة الحجز فوراً.`
        : `Custom terms saved for this property (version ${terms.version}) — customers see them now.`;
    }
    if (isTemplate) {
      return ar
        ? 'تم حذف الصيغة الموحدة — تعود العقارات غير المخصّصة إلى الشروط الافتراضية للمنصة.'
        : 'Standard terms cleared — properties without custom terms use the platform defaults.';
    }
    return ar
      ? 'عاد هذا العقار إلى الصيغة الموحدة للشروط والأحكام.'
      : 'This property now uses the standard terms again.';
  }

  function save(body: { bodyAr: string; bodyEn: string }) {
    const targetMode = mode;
    startTransition(async () => {
      setMessage(null);
      try {
        const result = await putBookingTerms(target, { mode: targetMode, ...body });
        setDrafts((current) => ({
          ...current,
          [targetMode]: {
            bodyAr: result.terms?.bodyAr ?? '',
            bodyEn: result.terms?.bodyEn ?? '',
            saved: result.terms,
          },
        }));
        setMessage({ kind: 'success', text: savedMessage(result.terms) });
      } catch (caught) {
        setMessage({ kind: 'error', text: saveErrorMessage(caught, ar) });
      }
    });
  }

  let status: string;
  if (draft.saved) {
    const when = formatDate(draft.saved.updatedAt, ar);
    status = isTemplate
      ? ar
        ? `الصيغة الموحدة — الإصدار ${draft.saved.version} · آخر تحديث ${when}`
        : `Standard terms — version ${draft.saved.version} · updated ${when}`
      : ar
        ? `شروط مخصّصة لهذا العقار — الإصدار ${draft.saved.version} · آخر تحديث ${when}`
        : `Custom terms for this property — version ${draft.saved.version} · updated ${when}`;
  } else if (isTemplate) {
    status = ar
      ? 'لم تُكتب صيغة موحدة بعد — ترى العقارات حالياً الشروط الافتراضية المقترحة.'
      : 'No standard terms yet — properties currently show the suggested defaults.';
  } else if (hasText(inherited)) {
    status = ar
      ? `هذا العقار يستخدم الصيغة الموحدة (الإصدار ${inherited?.version}). اكتب هنا فقط إذا أردت شروطاً مختلفة لهذا العقار.`
      : `This property uses the standard terms (version ${inherited?.version}). Write here only to customize them for this property.`;
  } else {
    status = ar
      ? 'هذا العقار يستخدم الشروط الافتراضية للمنصة — لا توجد صيغة موحدة ولا شروط مخصّصة.'
      : 'This property uses the platform defaults — no standard or custom terms yet.';
  }

  const Heading = isTemplate ? 'h2' : 'h1';

  return (
    <div
      className={`form-shell booking-terms-editor${isTemplate ? ' booking-terms-editor--template' : ''}`}
    >
      <header className="property-manage-hub__header">
        <div>
          <span className="ops-kicker">
            BHD R ·{' '}
            {isTemplate
              ? ar
                ? 'الصيغة الموحدة'
                : 'STANDARD TERMS'
              : ar
                ? 'الشروط والأحكام'
                : 'TERMS & CONDITIONS'}
          </span>
          <Heading>
            {target.kind === 'organization'
              ? ar
                ? 'الصيغة الموحدة للشروط والأحكام'
                : 'Standard terms & conditions'
              : ar
                ? target.property.nameAr
                : target.property.nameEn}
          </Heading>
          <p className="muted">
            {isTemplate
              ? ar
                ? 'تُطبّق هذه الصيغة تلقائياً على جميع عقاراتك كما هي. يمكنك تخصيص الشروط لعقار معيّن من القائمة أدناه.'
                : 'These terms apply to all your properties as-is. Customize terms for a specific property from the list below.'
              : ar
                ? 'شروط هذا العقار يقرؤها المستأجر أو المشتري ويوافق عليها قبل دفع مبلغ الضمان وتوقيع العقد. إن لم تخصّصها يُستخدم نص الصيغة الموحدة.'
                : 'Tenants and buyers accept these terms before paying the deposit and signing. Without custom terms the standard terms apply.'}
          </p>
        </div>
        {target.kind === 'property' ? (
          <div className="booking-terms-editor__links">
            <Link
              className="button button--quiet"
              href={`/${portal}/terms`}
              prefetch
              scroll={false}
            >
              {ar ? 'الصيغة الموحدة' : 'Standard terms'}
            </Link>
            <Link
              className="button button--quiet"
              href={`/${portal}/properties/${target.property.id}`}
              prefetch
              scroll={false}
            >
              {ar ? 'العودة لإدارة العقار' : 'Back to property'}
            </Link>
          </div>
        ) : null}
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
              <span className="booking-terms-editor__badge">
                {isTemplate ? (ar ? 'محفوظة' : 'Saved') : ar ? 'مخصّصة' : 'Custom'}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <p className="muted booking-terms-editor__status">{status}</p>

      <div className="booking-terms-editor__grid">
        <div className="field">
          <label htmlFor={`${fieldPrefix}-ar`}>
            {ar ? 'الشروط بالعربية (كل بند في سطر)' : 'Arabic terms (one clause per line)'}
          </label>
          <textarea
            id={`${fieldPrefix}-ar`}
            className="textarea booking-terms-editor__textarea"
            dir="rtl"
            maxLength={BOOKING_TERMS_MAX_BODY}
            value={draft.bodyAr}
            onChange={(event) => updateDraft({ bodyAr: event.target.value })}
            placeholder={(hasText(inherited)
              ? parseTermsBody(inherited?.bodyAr)
              : suggestedOwnerTerms(mode, true)
            ).join('\n')}
          />
        </div>
        <div className="field">
          <label htmlFor={`${fieldPrefix}-en`}>
            {ar ? 'الشروط بالإنجليزية (اختياري)' : 'English terms (optional)'}
          </label>
          <textarea
            id={`${fieldPrefix}-en`}
            className="textarea booking-terms-editor__textarea"
            dir="ltr"
            maxLength={BOOKING_TERMS_MAX_BODY}
            value={draft.bodyEn}
            onChange={(event) => updateDraft({ bodyEn: event.target.value })}
            placeholder={(hasText(inherited)
              ? parseTermsBody(inherited?.bodyEn)
              : suggestedOwnerTerms(mode, false)
            ).join('\n')}
          />
        </div>
      </div>
      <p className="muted booking-terms-editor__hint">
        {ar
          ? `اكتب كل بند في سطر مستقل (حتى ${BOOKING_TERMS_MAX_LINES} بنداً). إذا تركت الإنجليزية فارغة تُعرض العربية للجميع.`
          : `One clause per line (up to ${BOOKING_TERMS_MAX_LINES}). If English is empty, the Arabic text is shown to everyone.`}
      </p>

      <div className="stays-checkout__nav booking-terms-editor__actions">
        {isTemplate ? (
          <button
            type="button"
            className="button button--quiet"
            onClick={fillSuggested}
            disabled={pending}
          >
            {ar ? 'استخدم النموذج المقترح' : 'Use suggested template'}
          </button>
        ) : (
          <button
            type="button"
            className="button button--quiet"
            onClick={fillFromTemplate}
            disabled={pending}
          >
            {hasText(inherited)
              ? ar
                ? 'انسخ الصيغة الموحدة لتعديلها'
                : 'Copy standard terms to edit'
              : ar
                ? 'استخدم النموذج المقترح'
                : 'Use suggested template'}
          </button>
        )}
        {draft.saved ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={pending}
            onClick={() => save({ bodyAr: '', bodyEn: '' })}
          >
            {isTemplate
              ? ar
                ? 'حذف الصيغة الموحدة'
                : 'Clear standard terms'
              : ar
                ? 'العودة للصيغة الموحدة'
                : 'Use standard terms'}
          </button>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          disabled={pending || !dirty}
          onClick={() => save({ bodyAr: draft.bodyAr, bodyEn: draft.bodyEn })}
        >
          {pending
            ? ar
              ? 'جارٍ الحفظ…'
              : 'Saving…'
            : isTemplate
              ? ar
                ? 'حفظ الصيغة الموحدة'
                : 'Save standard terms'
              : ar
                ? 'حفظ كشروط مخصّصة لهذا العقار'
                : 'Save as custom terms'}
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

      <section className="booking-terms-editor__preview" aria-labelledby={`${fieldPrefix}-preview`}>
        <h2 id={`${fieldPrefix}-preview`}>
          {ar ? 'معاينة ما يراه العميل' : 'Customer preview'}
          <span className="booking-terms-editor__badge">
            {previewSource === 'custom'
              ? isTemplate
                ? ar
                  ? 'الصيغة الموحدة'
                  : 'Standard'
                : ar
                  ? 'مخصّصة'
                  : 'Custom'
              : previewSource === 'template'
                ? ar
                  ? 'من الصيغة الموحدة'
                  : 'From standard terms'
                : ar
                  ? 'افتراضية'
                  : 'Default'}
          </span>
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
