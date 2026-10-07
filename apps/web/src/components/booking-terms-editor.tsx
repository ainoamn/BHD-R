'use client';

import { useMemo, useRef, useState, useTransition, type ClipboardEvent } from 'react';
import { TermsDocument } from '@/components/terms-document';
import { TermsPrintButton } from '@/components/terms-print-button';
import { Link } from '@/i18n/navigation';
import { ApiError, fetchBrowserCsrfToken, humanizeBrowserError } from '@/lib/api';
import {
  BOOKING_TERMS_MODES,
  TERMS_MAX_BLOCKS,
  TERMS_MAX_CLAUSE,
  TERMS_MAX_HEADING,
  bookingTermsDocument,
  bookingTermsModeLabel,
  hasTermsText,
  numberTermsBlocks,
  parseTermsText,
  stripTermsNumbering,
  suggestedTermsBlocks,
  type BookingTermsMode,
  type OwnerBookingTerms,
  type TermsBlock,
  type TermsLetterhead,
} from '@/lib/booking-terms';

type Lang = 'ar' | 'en';
type EditorBlock = { id: string; kind: TermsBlock['kind']; ar: string; en: string };
type Draft = { blocks: EditorBlock[]; saved: OwnerBookingTerms | null };
type TermsMap = Record<BookingTermsMode, OwnerBookingTerms | null>;

export type BookingTermsEditorTarget =
  | { kind: 'organization' }
  | { kind: 'property'; property: { id: string; nameAr: string; nameEn: string } };

let blockSeq = 0;
function newId() {
  blockSeq += 1;
  return `b${Date.now().toString(36)}${blockSeq}`;
}

function toEditor(blocks: readonly TermsBlock[]): EditorBlock[] {
  return blocks.map((block) => ({ id: newId(), kind: block.kind, ar: block.ar, en: block.en }));
}

function toPayload(blocks: readonly EditorBlock[]): TermsBlock[] {
  return blocks
    .map((block) => ({
      kind: block.kind,
      ar: stripTermsNumbering(block.ar),
      en: stripTermsNumbering(block.en),
    }))
    .filter((block) => block.ar || block.en);
}

function sameBlocks(left: readonly TermsBlock[], right: readonly TermsBlock[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatDate(value: string, ar: boolean) {
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function putBookingTerms(
  target: BookingTermsEditorTarget,
  body: { mode: BookingTermsMode; blocks: TermsBlock[] },
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
      return ar
        ? `النص طويل جداً أو عدد البنود كبير (الحد ${TERMS_MAX_BLOCKS} بنداً).`
        : `Text too long or too many items (max ${TERMS_MAX_BLOCKS}).`;
    }
  }
  return humanizeBrowserError(error, ar);
}

/**
 * Pasted multi-line text becomes several headings/clauses. Lines fill the same language of the
 * following blocks when their kind matches and that side is still empty; otherwise new blocks are inserted.
 */
function applyPaste(blocks: EditorBlock[], index: number, lang: Lang, text: string): EditorBlock[] {
  const parsed = parseTermsText(text);
  if (!parsed.length) return blocks;
  const other: Lang = lang === 'ar' ? 'en' : 'ar';
  const next = [...blocks];
  parsed.forEach((line, offset) => {
    const target = index + offset;
    const existing = next[target];
    if (offset === 0 && existing) {
      next[target] = {
        ...existing,
        kind: existing[other].trim() ? existing.kind : line.kind,
        [lang]: line.text,
      };
      return;
    }
    if (existing && existing.kind === line.kind && !existing[lang].trim()) {
      next[target] = { ...existing, [lang]: line.text };
      return;
    }
    next.splice(target, 0, { id: newId(), kind: line.kind, ar: '', en: '', [lang]: line.text });
  });
  return next.slice(0, TERMS_MAX_BLOCKS);
}

export function BookingTermsEditor({
  locale,
  portal,
  target,
  initialTerms,
  organizationTerms,
  letterhead,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  target: BookingTermsEditorTarget;
  initialTerms: TermsMap;
  /** Organization template the property inherits when it has no custom terms. */
  organizationTerms?: TermsMap;
  letterhead: TermsLetterhead;
}) {
  const ar = locale === 'ar';
  const isTemplate = target.kind === 'organization';
  const fieldPrefix = isTemplate ? 'org-terms' : 'property-terms';
  const [mode, setMode] = useState<BookingTermsMode>('rent');
  const [drafts, setDrafts] = useState<Record<BookingTermsMode, Draft>>(() => {
    const entries = BOOKING_TERMS_MODES.map((key) => {
      const saved = initialTerms[key];
      return [key, { blocks: toEditor(saved?.blocks ?? []), saved }] as const;
    });
    return Object.fromEntries(entries) as Record<BookingTermsMode, Draft>;
  });
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLOListElement | null>(null);

  const draft = drafts[mode];
  const inherited = isTemplate ? null : (organizationTerms?.[mode] ?? null);
  const payload = useMemo(() => toPayload(draft.blocks), [draft.blocks]);
  const dirty = !sameBlocks(payload, draft.saved?.blocks ?? []);
  const labels = useMemo(() => numberTermsBlocks(draft.blocks), [draft.blocks]);

  const previewSource: 'custom' | 'template' | 'default' = hasTermsText(payload)
    ? 'custom'
    : inherited && hasTermsText(inherited.blocks)
      ? 'template'
      : 'default';
  const previewBlocks = bookingTermsDocument({
    mode,
    blocks:
      previewSource === 'custom'
        ? payload
        : previewSource === 'template'
          ? (inherited?.blocks ?? null)
          : null,
  });

  function setBlocks(update: (blocks: EditorBlock[]) => EditorBlock[]) {
    setMessage(null);
    setDrafts((current) => ({
      ...current,
      [mode]: { ...current[mode], blocks: update(current[mode].blocks) },
    }));
  }

  function focusBlock(index: number, lang: Lang = ar ? 'ar' : 'en') {
    window.requestAnimationFrame(() => {
      const field = listRef.current?.querySelectorAll<HTMLElement>(`[data-lang="${lang}"]`)[index];
      field?.focus();
    });
  }

  function addBlock(kind: EditorBlock['kind'], at?: number) {
    if (draft.blocks.length >= TERMS_MAX_BLOCKS) return;
    const index = at ?? draft.blocks.length;
    setBlocks((blocks) => {
      const next = [...blocks];
      next.splice(index, 0, { id: newId(), kind, ar: '', en: '' });
      return next;
    });
    focusBlock(index);
  }

  function updateBlock(index: number, patch: Partial<EditorBlock>) {
    setBlocks((blocks) => blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  }

  function moveBlock(index: number, delta: -1 | 1) {
    setBlocks((blocks) => {
      const target = index + delta;
      if (target < 0 || target >= blocks.length) return blocks;
      const next = [...blocks];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(target, 0, moved);
      return next;
    });
  }

  function removeBlock(index: number) {
    setBlocks((blocks) => blocks.filter((_, i) => i !== index));
  }

  function onPaste(event: ClipboardEvent<HTMLElement>, index: number, lang: Lang) {
    const text = event.clipboardData.getData('text');
    if (!/\r?\n/.test(text.trim())) return;
    event.preventDefault();
    setBlocks((blocks) => applyPaste(blocks, index, lang, text));
  }

  function replaceBlocks(blocks: readonly TermsBlock[]) {
    setBlocks(() => toEditor(blocks));
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

  function save(blocks: TermsBlock[]) {
    const targetMode = mode;
    startTransition(async () => {
      setMessage(null);
      try {
        const result = await putBookingTerms(target, { mode: targetMode, blocks });
        setDrafts((current) => ({
          ...current,
          [targetMode]: { blocks: toEditor(result.terms?.blocks ?? []), saved: result.terms },
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
  } else if (inherited && hasTermsText(inherited.blocks)) {
    status = ar
      ? `هذا العقار يستخدم الصيغة الموحدة (الإصدار ${inherited.version}). أضف بنوداً هنا فقط إذا أردت شروطاً مختلفة لهذا العقار.`
      : `This property uses the standard terms (version ${inherited.version}). Add items here only to customize them for this property.`;
  } else {
    status = ar
      ? 'هذا العقار يستخدم الشروط الافتراضية للمنصة — لا توجد صيغة موحدة ولا شروط مخصّصة.'
      : 'This property uses the platform defaults — no standard or custom terms yet.';
  }

  const Heading = isTemplate ? 'h2' : 'h1';
  const atLimit = draft.blocks.length >= TERMS_MAX_BLOCKS;
  const printTitle =
    target.kind === 'property'
      ? {
          ar: `الشروط والأحكام — ${target.property.nameAr} — ${bookingTermsModeLabel(mode, true)}`,
          en: `Terms & conditions — ${target.property.nameEn} — ${bookingTermsModeLabel(mode, false)}`,
        }
      : {
          ar: `الشروط والأحكام — ${bookingTermsModeLabel(mode, true)}`,
          en: `Terms & conditions — ${bookingTermsModeLabel(mode, false)}`,
        };

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

      <p className="muted booking-terms-editor__hint">
        {ar
          ? 'أضف «عنواناً» ثم البنود التي تحته. الترقيم تلقائي: العناوين بالحروف (أ، ب، ج) والبنود بالأرقام (1، 2، 3) تحت كل عنوان — لا تكتب الأرقام بنفسك. يمكنك لصق نص كامل من عدة أسطر في أي حقل وسيقسّمه النظام تلقائياً إلى عناوين وبنود.'
          : 'Add a heading, then the clauses under it. Numbering is automatic: headings get letters (A, B, C) and clauses numbers (1, 2, 3) under each heading — don’t type numbers yourself. Paste multi-line text into any field and it is split into headings and clauses automatically.'}
      </p>

      {draft.blocks.length === 0 ? (
        <div className="booking-terms-editor__empty">
          <p>{ar ? 'لا توجد عناوين أو بنود بعد.' : 'No headings or clauses yet.'}</p>
        </div>
      ) : (
        <ol className="terms-blocks" ref={listRef}>
          {draft.blocks.map((block, index) => {
            const label = labels[index];
            const heading = block.kind === 'heading';
            const max = heading ? TERMS_MAX_HEADING : TERMS_MAX_CLAUSE;
            const fieldProps = (lang: Lang) => ({
              id: `${fieldPrefix}-${block.id}-${lang}`,
              'data-lang': lang,
              dir: lang === 'ar' ? ('rtl' as const) : ('ltr' as const),
              lang,
              maxLength: max,
              value: block[lang],
              placeholder:
                lang === 'ar'
                  ? heading
                    ? 'العنوان بالعربية — مثال: وديعة الحجز غير قابلة للاسترداد'
                    : 'نص البند بالعربية'
                  : heading
                    ? 'Heading in English — e.g. Non-refundable reservation deposit'
                    : 'Clause text in English (optional)',
              onChange: (event: { target: { value: string } }) =>
                updateBlock(index, { [lang]: event.target.value }),
              onBlur: () => {
                const cleaned = stripTermsNumbering(block[lang]);
                if (cleaned !== block[lang].trim()) updateBlock(index, { [lang]: cleaned });
              },
              onPaste: (event: ClipboardEvent<HTMLElement>) => onPaste(event, index, lang),
            });
            return (
              <li key={block.id} className={`terms-blocks__item terms-blocks__item--${block.kind}`}>
                <div className="terms-blocks__head">
                  <span className="terms-doc__label" aria-hidden="true">
                    {ar ? label?.labelAr : label?.labelEn}
                  </span>
                  <select
                    className="select terms-blocks__kind"
                    value={block.kind}
                    aria-label={ar ? 'النوع' : 'Type'}
                    onChange={(event) =>
                      updateBlock(index, { kind: event.target.value as EditorBlock['kind'] })
                    }
                  >
                    <option value="heading">{ar ? 'عنوان' : 'Heading'}</option>
                    <option value="clause">{ar ? 'بند' : 'Clause'}</option>
                  </select>
                  <div className="terms-blocks__tools">
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => moveBlock(index, -1)}
                      disabled={index === 0}
                      aria-label={ar ? 'تحريك للأعلى' : 'Move up'}
                      title={ar ? 'تحريك للأعلى' : 'Move up'}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => moveBlock(index, 1)}
                      disabled={index === draft.blocks.length - 1}
                      aria-label={ar ? 'تحريك للأسفل' : 'Move down'}
                      title={ar ? 'تحريك للأسفل' : 'Move down'}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => addBlock('clause', index + 1)}
                      disabled={atLimit}
                    >
                      {ar ? '+ بند أسفله' : '+ Clause below'}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet terms-blocks__remove"
                      onClick={() => removeBlock(index)}
                      aria-label={ar ? 'حذف' : 'Delete'}
                      title={ar ? 'حذف' : 'Delete'}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="terms-blocks__fields">
                  <div className="field terms-blocks__field terms-blocks__field--en">
                    <label htmlFor={`${fieldPrefix}-${block.id}-en`}>English</label>
                    {heading ? (
                      <input className="input" type="text" {...fieldProps('en')} />
                    ) : (
                      <textarea className="textarea" rows={3} {...fieldProps('en')} />
                    )}
                  </div>
                  <div className="field terms-blocks__field terms-blocks__field--ar">
                    <label htmlFor={`${fieldPrefix}-${block.id}-ar`}>العربية</label>
                    {heading ? (
                      <input className="input" type="text" {...fieldProps('ar')} />
                    ) : (
                      <textarea className="textarea" rows={3} {...fieldProps('ar')} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="terms-blocks__add">
        <button
          type="button"
          className="button button--quiet"
          onClick={() => addBlock('heading')}
          disabled={atLimit}
        >
          {ar ? '+ إضافة عنوان' : '+ Add heading'}
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => addBlock('clause')}
          disabled={atLimit}
        >
          {ar ? '+ إضافة بند' : '+ Add clause'}
        </button>
      </div>

      <div className="stays-checkout__nav booking-terms-editor__actions">
        {isTemplate || !(inherited && hasTermsText(inherited.blocks)) ? (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => replaceBlocks(suggestedTermsBlocks(mode))}
            disabled={pending}
          >
            {ar ? 'استخدم النموذج المقترح' : 'Use suggested template'}
          </button>
        ) : (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => replaceBlocks(inherited.blocks)}
            disabled={pending}
          >
            {ar ? 'انسخ الصيغة الموحدة لتعديلها' : 'Copy standard terms to edit'}
          </button>
        )}
        {draft.saved ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={pending}
            onClick={() => save([])}
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
          onClick={() => save(payload)}
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
        <div className="booking-terms-editor__preview-head">
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
          <TermsPrintButton
            ar={ar}
            blocks={previewBlocks}
            letterhead={letterhead}
            titleAr={printTitle.ar}
            titleEn={printTitle.en}
          />
        </div>
        <TermsDocument blocks={previewBlocks} />
        <p className="muted booking-terms-editor__hint">
          {ar
            ? 'القسم المظلل تضيفه المنصة دائماً (مبلغ الضمان والتوقيع الإلكتروني) ولا يمكن حذفه. يجب على العميل التمرير حتى آخر الشروط قبل ظهور زر الموافقة.'
            : 'The shaded section is always added by the platform (deposit and e-signature). Customers must scroll to the end before the accept checkbox appears.'}
        </p>
      </section>
    </div>
  );
}
