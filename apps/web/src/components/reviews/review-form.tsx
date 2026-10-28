'use client';

import { useMemo, useRef, useState } from 'react';
import {
  NoteTranslateBar,
  OWNER_NOTE_SERVICE,
  guestReviewNoteService,
  type NoteService,
} from '@/components/note-translate';
import { compressPhoto } from '@/components/stays/stay-handover-form';
import { ApiError, browserNextMutation } from '@/lib/api';
import { noteLanguage, noteOriginal } from '@/lib/note-translation';
import {
  GUEST_REVIEW_TAGS,
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN_WHEN_LOW,
  REVIEW_PHOTO_MAX,
  REVIEW_PHOTOS_MAX,
  REVIEW_SCALE,
  REVIEW_TAGS_MAX,
  needsComment,
  reviewScoreLabel,
  reviewScoreTone,
  rubricFor,
  scoreAnswers,
  validAnswers,
  type ReviewAnswers,
  type ReviewDirection,
  type ReviewGroup,
} from '@/lib/review-rubric';

export type ReviewFormValue = {
  answers: ReviewAnswers;
  comment?: string;
  recommend: boolean | null;
  tags?: string[];
  photos: string[];
};

type ReviewDraft = { engine: 'ai' | 'rules'; text: string };

export type ReviewDraftRequest = {
  answers: ReviewAnswers;
  tags: string[];
  recommend: boolean | null;
  comment?: string;
  lang: 'ar' | 'en';
};

/** AI writing help for the comment: an editable summary plus live translation and rewording. */
export type ReviewAssistant = {
  notes: NoteService;
  summarize: (request: ReviewDraftRequest) => Promise<ReviewDraft>;
};

/** The guest's review: public route, allowed while the stay's review is open. */
export function guestReviewAssistant(referenceCode: string): ReviewAssistant {
  return {
    notes: guestReviewNoteService(referenceCode),
    summarize: async (request) => {
      const response = await fetch('/api/public/stays/guest/review/assist', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-requested-with': 'BHD-R',
        },
        body: JSON.stringify({ action: 'summarize', referenceCode, ...request }),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = (await response.json().catch(() => null)) as
        (ReviewDraft & { error?: { code?: string; messageAr?: string } }) | null;
      if (!response.ok || !payload?.text) {
        throw new ApiError(
          response.status,
          payload?.error?.code ?? 'ai_failed',
          payload?.error?.messageAr ?? 'تعذّر التلخيص الآن.',
        );
      }
      return { engine: payload.engine, text: payload.text };
    },
  };
}

/** The host's review of a guest: owner session, allowed while that review is still open. */
export function hostReviewAssistant(propertyId: string, bookingId: string): ReviewAssistant {
  return {
    notes: OWNER_NOTE_SERVICE,
    summarize: ({ answers, recommend, comment, lang }) =>
      browserNextMutation<ReviewDraft>(
        `/api/owner/properties/${encodeURIComponent(propertyId)}/guest-review/assist`,
        {
          method: 'POST',
          body: JSON.stringify({
            bookingId,
            answers,
            recommend,
            ...(comment ? { comment } : {}),
            lang,
          }),
          signal: AbortSignal.timeout(45_000),
        },
      ),
  };
}

/** Low answers (1–2) that deserve a word in the comment. */
const LOW_ANSWER = 2;

/** Score badge on 10, colored by band. */
export function ScoreBadge({
  score,
  ar,
  size = 'md',
}: {
  score: number;
  ar: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      className={`review-score review-score--${reviewScoreTone(score)} review-score--${size}`}
      title={reviewScoreLabel(score, ar)}
    >
      <strong dir="ltr">{score.toFixed(1)}</strong>
      <small>{reviewScoreLabel(score, ar)}</small>
    </span>
  );
}

export function ReviewForm({
  direction,
  ar,
  idPrefix,
  busy,
  error,
  subjectName,
  assistant,
  stepped = true,
  onSubmit,
  onCancel,
}: {
  direction: ReviewDirection;
  ar: boolean;
  idPrefix: string;
  busy: boolean;
  error: string | null;
  subjectName?: string | null;
  /** Turns on the AI summary and live translation of the comment; keep it memoized. */
  assistant?: ReviewAssistant;
  /** One section at a time (groups → recommend → comment). */
  stepped?: boolean;
  onSubmit: (value: ReviewFormValue) => void;
  onCancel?: () => void;
}) {
  const rubric = rubricFor(direction);
  const [answers, setAnswers] = useState<ReviewAnswers>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [comment, setComment] = useState('');
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [stepTried, setStepTried] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const required = rubric.flatMap((group) =>
    group.criteria.filter((item) => !item.optional).map((item) => item.key),
  );
  const answered = Object.keys(answers).length;
  const missing = required.filter((key) => !answers[key]);
  const totalSteps = rubric.length + 2; // groups + recommend + finish
  const criteriaProgress = required.length
    ? Math.round(((required.length - missing.length) / required.length) * 100)
    : 100;
  const progress = stepped
    ? Math.round((Math.min(step, totalSteps - 1) / (totalSteps - 1)) * 100)
    : criteriaProgress;
  const complete = validAnswers(direction, answers);
  const scores = useMemo(() => scoreAnswers(direction, answers), [direction, answers]);
  const commentNeeded = complete && needsComment(direction, answers);
  const commentOk = !commentNeeded || comment.trim().length >= REVIEW_COMMENT_MIN_WHEN_LOW;
  const guest = direction === 'guest_to_host';
  const lows = rubric.flatMap((group) =>
    group.criteria.filter((item) => (answers[item.key] ?? 6) <= LOW_ANSWER),
  );
  const onRecommendStep = stepped && step === rubric.length;
  const onFinishStep = stepped && step === rubric.length + 1;
  const currentGroup = stepped && step < rubric.length ? rubric[step]! : null;

  function groupComplete(group: ReviewGroup): boolean {
    return group.criteria.every((item) => item.optional || Boolean(answers[item.key]));
  }

  function goNext() {
    if (currentGroup) {
      setStepTried(true);
      if (!groupComplete(currentGroup)) return;
      setStepTried(false);
      setStep((value) => value + 1);
      return;
    }
    if (onRecommendStep) {
      setStepTried(false);
      setStep((value) => value + 1);
    }
  }

  function goBack() {
    setStepTried(false);
    setStep((value) => Math.max(0, value - 1));
  }

  function pick(key: string, value: number) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setSkipped((current) => ({ ...current, [key]: false }));
  }

  /** One tap for the whole section; each item can still be changed afterwards. */
  function fillGroup(group: ReviewGroup, value: number) {
    setAnswers((current) => ({
      ...current,
      ...Object.fromEntries(group.criteria.map((item) => [item.key, value])),
    }));
    setSkipped((current) => ({
      ...current,
      ...Object.fromEntries(group.criteria.map((item) => [item.key, false])),
    }));
  }

  function skipGroup(group: ReviewGroup) {
    setAnswers((current) => {
      const next = { ...current };
      for (const item of group.criteria) delete next[item.key];
      return next;
    });
    setSkipped((current) => ({
      ...current,
      ...Object.fromEntries(group.criteria.map((item) => [item.key, true])),
    }));
  }

  function toggleTag(key: string) {
    setTags((current) =>
      current.includes(key)
        ? current.filter((tag) => tag !== key)
        : current.length < REVIEW_TAGS_MAX
          ? [...current, key]
          : current,
    );
  }

  async function summarize() {
    if (!assistant || drafting) return;
    setDrafting(true);
    setDraftError(null);
    const notes = noteOriginal(comment).trim();
    try {
      setDraft(
        await assistant.summarize({
          answers,
          tags,
          recommend,
          ...(notes ? { comment: notes } : {}),
          lang: notes.length >= 10 ? noteLanguage(notes) : ar ? 'ar' : 'en',
        }),
      );
    } catch (caught) {
      setDraftError(
        caught instanceof ApiError && caught.code === 'rate_limited'
          ? ar
            ? 'طلبات كثيرة خلال دقيقة — انتظر قليلاً.'
            : 'Too many requests in a minute — wait a moment.'
          : ar
            ? 'تعذّر التلخيص الآن. أعد المحاولة.'
            : 'Could not summarise right now. Try again.',
      );
    } finally {
      setDrafting(false);
    }
  }

  function skip(key: string) {
    setAnswers((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSkipped((current) => ({ ...current, [key]: true }));
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setPhotoError(null);
    const room = REVIEW_PHOTOS_MAX - photos.length;
    const added: string[] = [];
    for (const file of Array.from(files).slice(0, room)) {
      try {
        added.push(await compressPhoto(file, REVIEW_PHOTO_MAX));
      } catch {
        setPhotoError(
          ar ? 'تعذّرت قراءة إحدى الصور. جرّب صورة أخرى.' : 'Could not read one photo.',
        );
      }
    }
    setPhotos((current) => [...current, ...added].slice(0, REVIEW_PHOTOS_MAX));
    if (fileRef.current) fileRef.current.value = '';
  }

  function submit() {
    setTried(true);
    if (!complete || !commentOk) return;
    onSubmit({
      answers,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      recommend,
      ...(tags.length ? { tags } : {}),
      photos,
    });
  }

  return (
    <form
      className="review-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (stepped && !onFinishStep) {
          goNext();
          return;
        }
        submit();
      }}
    >
      <div className="review-form__live" aria-live="polite">
        {answered ? (
          <ScoreBadge score={scores.criteria} ar={ar} size="lg" />
        ) : (
          <span className="review-score review-score--empty review-score--lg">
            <strong>—</strong>
            <small>{ar ? 'من 10' : 'out of 10'}</small>
          </span>
        )}
        <div>
          <strong>
            {guest
              ? ar
                ? `قيّم إقامتك${subjectName ? ` في ${subjectName}` : ''}`
                : `Rate your stay${subjectName ? ` at ${subjectName}` : ''}`
              : ar
                ? `قيّم الضيف${subjectName ? ` ${subjectName}` : ''}`
                : `Rate the guest${subjectName ? ` ${subjectName}` : ''}`}
          </strong>
          <div className="review-form__progress">
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label={ar ? 'نسبة الإكمال' : 'Completion'}
            >
              <i style={{ width: `${progress}%` }} />
            </span>
            <small>
              {ar
                ? `${required.length - missing.length} من ${required.length} بنداً مطلوباً`
                : `${required.length - missing.length} of ${required.length} required items`}
            </small>
          </div>
          {guest && (scores.property !== null || scores.host !== null) ? (
            <p className="review-form__sides">
              {scores.property !== null ? (
                <span>
                  {ar ? 'المكان' : 'The place'} <b dir="ltr">{scores.property.toFixed(1)}</b>
                </span>
              ) : null}
              {scores.host !== null ? (
                <span>
                  {ar ? 'المالك والموظفون' : 'Host and staff'}{' '}
                  <b dir="ltr">{scores.host.toFixed(1)}</b>
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
      <p className="muted review-form__how">
        {stepped
          ? ar
            ? `الخطوة ${Math.min(step + 1, totalSteps)} من ${totalSteps}: قيّم من 1 (سيئ جداً) إلى 5 (ممتاز)، أو استخدم التعبئة السريعة ثم تابع.`
            : `Step ${Math.min(step + 1, totalSteps)} of ${totalSteps}: rate from 1 (very poor) to 5 (excellent), or use quick fill, then continue.`
          : ar
            ? 'اختر لكل بند من 1 (سيئ جداً) إلى 5 (ممتاز)، أو استخدم «تعبئة سريعة» لكل قسم ثم عدّل ما تشاء. تُحسب الدرجة من 10 تلقائياً، ويحلّل الذكاء الاصطناعي ملاحظاتك ليكمل التقييم النهائي.'
            : 'Rate each item from 1 (very poor) to 5 (excellent), or use "Quick fill" per section and adjust. The score on 10 updates as you go; AI reads your comment to finish the final score.'}
      </p>

      {(stepped ? (currentGroup ? [currentGroup] : []) : rubric).map((group) => {
        const groupScore = scores.groups.find((item) => item.key === group.key)?.score ?? null;
        const allOptional = group.criteria.every((item) => item.optional);
        const allSkipped = group.criteria.every((item) => skipped[item.key]);
        return (
          <fieldset key={group.key} className="review-form__group">
            <legend>
              <span>{ar ? group.ar : group.en}</span>
              {groupScore !== null ? (
                <span className="review-form__group-score" dir="ltr">
                  {groupScore.toFixed(1)}
                </span>
              ) : null}
            </legend>
            <div className="review-form__quick">
              <small>{ar ? 'تعبئة سريعة:' : 'Quick fill:'}</small>
              {[5, 4, 3, 2, 1].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`review-form__quick-step review-form__quick-step--${value}`}
                  title={ar ? REVIEW_SCALE[value - 1]!.ar : REVIEW_SCALE[value - 1]!.en}
                  aria-label={
                    ar
                      ? `${REVIEW_SCALE[value - 1]!.ar} لكل بنود ${group.ar}`
                      : `${REVIEW_SCALE[value - 1]!.en} for all of ${group.en}`
                  }
                  onClick={() => fillGroup(group, value)}
                >
                  <span dir="ltr">{value}</span>
                </button>
              ))}
              {allOptional ? (
                <button
                  type="button"
                  className={`review-form__quick-skip${allSkipped ? ' is-on' : ''}`}
                  onClick={() => skipGroup(group)}
                >
                  {ar ? 'لم أتعامل معهم' : 'Did not deal with them'}
                </button>
              ) : null}
            </div>
            {group.criteria.map((item) => {
              const value = answers[item.key];
              const invalid =
                (tried || (stepped && stepTried)) && !item.optional && !value && !skipped[item.key];
              const name = `${idPrefix}-${item.key}`;
              return (
                <div
                  key={item.key}
                  className={`review-form__row${invalid ? ' review-form__row--invalid' : ''}`}
                  role="radiogroup"
                  aria-labelledby={`${name}-label`}
                >
                  <div className="review-form__label" id={`${name}-label`}>
                    <span>
                      {ar ? item.ar : item.en}
                      {item.optional ? null : <b aria-hidden="true"> *</b>}
                    </span>
                    <small className="muted">{ar ? item.hintAr : item.hintEn}</small>
                  </div>
                  <div className="review-form__answer">
                    <div className="review-form__scale">
                      {REVIEW_SCALE.map((scaleStep) => (
                        <label
                          key={scaleStep.value}
                          className={`review-form__step review-form__step--${scaleStep.value}${
                            value === scaleStep.value ? ' is-on' : ''
                          }`}
                          title={ar ? scaleStep.ar : scaleStep.en}
                        >
                          <input
                            type="radio"
                            name={name}
                            value={scaleStep.value}
                            checked={value === scaleStep.value}
                            onChange={() => pick(item.key, scaleStep.value)}
                          />
                          <span dir="ltr">{scaleStep.value}</span>
                        </label>
                      ))}
                      {item.optional ? (
                        <label
                          className={`review-form__step review-form__step--na${
                            skipped[item.key] ? ' is-on' : ''
                          }`}
                        >
                          <input
                            type="radio"
                            name={name}
                            checked={Boolean(skipped[item.key])}
                            onChange={() => skip(item.key)}
                          />
                          <span>{ar ? 'لا ينطبق' : 'N/A'}</span>
                        </label>
                      ) : null}
                    </div>
                    <small className="review-form__picked">
                      {value
                        ? ar
                          ? REVIEW_SCALE[value - 1]!.ar
                          : REVIEW_SCALE[value - 1]!.en
                        : invalid
                          ? ar
                            ? 'مطلوب'
                            : 'Required'
                          : ''}
                    </small>
                  </div>
                </div>
              );
            })}
          </fieldset>
        );
      })}

      {!stepped || onRecommendStep ? (
        <>
          <fieldset className="review-form__group review-form__recommend">
            <legend>
              {guest
                ? ar
                  ? 'هل تنصح غيرك بهذا العقار؟'
                  : 'Would you recommend this place?'
                : ar
                  ? 'هل تقبل استضافة هذا الضيف مرة أخرى؟'
                  : 'Would you host this guest again?'}
            </legend>
            <div className="review-form__choices">
              {[
                { value: true, ar: 'نعم', en: 'Yes' },
                { value: false, ar: 'لا', en: 'No' },
              ].map((choice) => (
                <label
                  key={String(choice.value)}
                  className={`review-form__choice${recommend === choice.value ? ' is-on' : ''}`}
                >
                  <input
                    type="radio"
                    name={`${idPrefix}-recommend`}
                    checked={recommend === choice.value}
                    onChange={() => setRecommend(choice.value)}
                  />
                  {ar ? choice.ar : choice.en}
                </label>
              ))}
            </div>
          </fieldset>

          {guest ? (
            <fieldset className="review-form__group review-form__tags">
              <legend>
                {ar ? 'ما الذي ميّز إقامتك؟ (اختياري)' : 'What stood out? (optional)'}
              </legend>
              <p className="muted">
                {ar
                  ? `اختر ما ينطبق (حتى ${REVIEW_TAGS_MAX}). يستعين بها الذكاء الاصطناعي في تلخيص تقييمك.`
                  : `Pick what applies (up to ${REVIEW_TAGS_MAX}). The AI uses them to summarise your review.`}
              </p>
              <div className="review-form__tag-list">
                {GUEST_REVIEW_TAGS.map((tag) => {
                  const on = tags.includes(tag.key);
                  return (
                    <button
                      key={tag.key}
                      type="button"
                      aria-pressed={on}
                      className={`review-form__tag review-form__tag--${tag.tone}${on ? ' is-on' : ''}`}
                      disabled={!on && tags.length >= REVIEW_TAGS_MAX}
                      onClick={() => toggleTag(tag.key)}
                    >
                      <span aria-hidden="true">{tag.tone === 'good' ? '+' : '−'}</span>
                      {ar ? tag.ar : tag.en}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
        </>
      ) : null}

      {!stepped || onFinishStep ? (
        <>
          {lows.length ? (
            <p className="review-form__lows" role="status">
              {ar
                ? `قيّمت بدرجة منخفضة: ${lows.map((item) => item.ar).join('، ')}. اكتب ما حدث في ملاحظاتك ليعرف المالك ما يحتاج إلى إصلاح.`
                : `You rated low: ${lows.map((item) => item.en).join(', ')}. Say what happened so the host knows what to fix.`}
            </p>
          ) : null}

          <label className="field review-form__comment">
            <span>
              {ar ? 'ملاحظاتك' : 'Your comments'}
              {commentNeeded ? ' *' : ` ${ar ? '(اختياري)' : '(optional)'}`}
            </span>
            <textarea
              className="textarea"
              rows={4}
              maxLength={REVIEW_COMMENT_MAX}
              value={comment}
              aria-invalid={tried && !commentOk}
              placeholder={
                guest
                  ? ar
                    ? 'ما الذي أعجبك؟ وما الذي يحتاج إلى تحسين؟'
                    : 'What did you like? What could be better?'
                  : ar
                    ? 'كيف كان الضيف؟ هل ترك المكان كما استلمه؟'
                    : 'How was the guest? Did they leave the place as they found it?'
              }
              onChange={(event) => setComment(event.target.value)}
            />
            {tried && !commentOk ? (
              <small className="field__error" role="alert">
                {ar
                  ? 'التقييم أقل من 6: اكتب سبب ذلك بإيجاز (15 حرفاً على الأقل).'
                  : 'The score is below 6: briefly say why (at least 15 characters).'}
              </small>
            ) : (
              <small className="muted">
                {ar
                  ? 'يُنشر تعليقك مع اسمك الأول. لا تكتب أرقام هواتف أو حسابات.'
                  : 'Published with your first name. Do not include phone or account numbers.'}
              </small>
            )}
          </label>

          {assistant ? (
            <div className="review-ai">
              <div className="review-ai__bar">
                <button
                  type="button"
                  className="note-translate__button"
                  disabled={busy || drafting || answered === 0}
                  onClick={() => void summarize()}
                >
                  <span aria-hidden="true">✨</span>
                  {drafting
                    ? ar
                      ? 'جارٍ التلخيص…'
                      : 'Summarising…'
                    : draft
                      ? ar
                        ? 'إعادة التلخيص'
                        : 'Summarise again'
                      : ar
                        ? 'لخّص تقييمي بالذكاء الاصطناعي'
                        : 'Summarise my review with AI'}
                </button>
                <small className="muted">
                  {answered === 0
                    ? ar
                      ? 'قيّم بعض البنود أولاً، ثم يكتب لك الذكاء الاصطناعي ملخصاً تعدّله كما تشاء.'
                      : 'Rate a few items first; the AI then drafts a summary you can edit.'
                    : ar
                      ? 'يكتب ملخصاً من تقييماتك واختياراتك وملاحظاتك، وتعدّله قبل اعتماده.'
                      : 'Drafts a summary from your ratings, picks and notes; edit it before using it.'}
                </small>
              </div>
              {draftError ? (
                <small className="note-translate__error" role="alert">
                  {draftError}
                </small>
              ) : null}
              {draft ? (
                <div className="review-ai__draft" aria-live="polite">
                  <label className="field">
                    <span className="note-assist__label">
                      <span aria-hidden="true">✨</span>
                      {draft.engine === 'ai'
                        ? ar
                          ? 'ملخص مقترح بالذكاء الاصطناعي · قابل للتعديل'
                          : 'AI-suggested summary · editable'
                        : ar
                          ? 'ملخص مقترح من تقييماتك · قابل للتعديل'
                          : 'Summary from your ratings · editable'}
                    </span>
                    <textarea
                      className="textarea"
                      rows={4}
                      maxLength={REVIEW_COMMENT_MAX}
                      dir="auto"
                      value={draft.text}
                      onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                    />
                  </label>
                  <div className="note-translate__actions">
                    <button
                      type="button"
                      className="note-translate__button"
                      disabled={busy || !draft.text.trim()}
                      onClick={() => {
                        setComment(draft.text.trim().slice(0, REVIEW_COMMENT_MAX));
                        setDraft(null);
                      }}
                    >
                      {ar ? 'استخدمه كملاحظتي' : 'Use as my comment'}
                    </button>
                    <button
                      type="button"
                      className="note-translate__button note-translate__button--quiet"
                      onClick={() => setDraft(null)}
                    >
                      {ar ? 'إلغاء' : 'Discard'}
                    </button>
                  </div>
                </div>
              ) : null}
              <NoteTranslateBar
                value={comment}
                onChange={setComment}
                locale={ar ? 'ar' : 'en'}
                max={REVIEW_COMMENT_MAX}
                disabled={busy}
                service={assistant.notes}
              />
            </div>
          ) : null}

          <div className="review-form__photos">
            <span className="review-form__photos-title">
              {ar
                ? `صور (اختياري، حتى ${REVIEW_PHOTOS_MAX})`
                : `Photos (optional, up to ${REVIEW_PHOTOS_MAX})`}
            </span>
            <div className="review-form__thumbs">
              {photos.map((photo, index) => (
                <figure key={index} className="review-form__thumb">
                  <img src={photo} alt={ar ? `صورة ${index + 1}` : `Photo ${index + 1}`} />
                  <button
                    type="button"
                    aria-label={ar ? 'حذف الصورة' : 'Remove photo'}
                    onClick={() => setPhotos((current) => current.filter((_, at) => at !== index))}
                  >
                    ×
                  </button>
                </figure>
              ))}
              {photos.length < REVIEW_PHOTOS_MAX ? (
                <label className="review-form__add">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => void addPhotos(event.target.files)}
                  />
                  <span aria-hidden="true">+</span>
                  <small>{ar ? 'إرفاق صورة' : 'Add photo'}</small>
                </label>
              ) : null}
            </div>
            {photoError ? (
              <small className="field__error" role="alert">
                {photoError}
              </small>
            ) : null}
          </div>
        </>
      ) : null}

      {tried && missing.length ? (
        <p className="field__error" role="alert">
          {ar
            ? `بقي ${missing.length} من البنود المطلوبة دون تقييم.`
            : `${missing.length} required items are not rated yet.`}
        </p>
      ) : null}
      {stepTried && currentGroup && !groupComplete(currentGroup) ? (
        <p className="field__error" role="alert">
          {ar
            ? 'أكمل بنود هذه الخطوة قبل المتابعة.'
            : 'Finish this step’s items before continuing.'}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="form-actions review-form__actions">
        {stepped && !onFinishStep ? (
          <>
            {step > 0 ? (
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={goBack}
              >
                {ar ? 'السابق' : 'Back'}
              </button>
            ) : onCancel ? (
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={onCancel}
              >
                {ar ? 'لاحقاً' : 'Later'}
              </button>
            ) : null}
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={goNext}
            >
              {ar ? 'التالي' : 'Next'}
            </button>
          </>
        ) : (
          <>
            {stepped ? (
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={goBack}
              >
                {ar ? 'السابق' : 'Back'}
              </button>
            ) : null}
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy
                ? ar
                  ? 'جارٍ التحليل والحفظ…'
                  : 'Analysing and saving…'
                : ar
                  ? 'إرسال التقييم'
                  : 'Submit review'}
            </button>
            {!stepped && onCancel ? (
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={onCancel}
              >
                {ar ? 'لاحقاً' : 'Later'}
              </button>
            ) : null}
          </>
        )}
      </div>
      {onFinishStep || !stepped ? (
        <p className="muted review-form__note">
          {ar
            ? 'التقييم نهائي ولا يُعدَّل بعد إرساله. لا يرى أي طرف تقييم الآخر قبل تحويل مبلغ التأمين وتأكيد استلامه، ثم يظهر للطرف الآخر وللعامة بعد أن يقيّم الطرفان (أو بعد 14 يوماً).'
            : 'Reviews are final. Neither side sees the other’s review before the deposit is refunded and received; it then becomes visible once both sides have reviewed (or after 14 days).'}
        </p>
      ) : null}
    </form>
  );
}
