'use client';

import { useMemo, useRef, useState } from 'react';
import { compressPhoto } from '@/components/stays/stay-handover-form';
import {
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN_WHEN_LOW,
  REVIEW_PHOTO_MAX,
  REVIEW_PHOTOS_MAX,
  REVIEW_SCALE,
  needsComment,
  reviewScoreLabel,
  reviewScoreTone,
  rubricFor,
  scoreAnswers,
  validAnswers,
  type ReviewAnswers,
  type ReviewDirection,
} from '@/lib/review-rubric';

export type ReviewFormValue = {
  answers: ReviewAnswers;
  comment?: string;
  recommend: boolean | null;
  photos: string[];
};

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
  onSubmit,
  onCancel,
}: {
  direction: ReviewDirection;
  ar: boolean;
  idPrefix: string;
  busy: boolean;
  error: string | null;
  subjectName?: string | null;
  onSubmit: (value: ReviewFormValue) => void;
  onCancel?: () => void;
}) {
  const rubric = rubricFor(direction);
  const [answers, setAnswers] = useState<ReviewAnswers>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [comment, setComment] = useState('');
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const required = rubric.flatMap((group) =>
    group.criteria.filter((item) => !item.optional).map((item) => item.key),
  );
  const answered = Object.keys(answers).length;
  const missing = required.filter((key) => !answers[key]);
  const complete = validAnswers(direction, answers);
  const scores = useMemo(() => scoreAnswers(direction, answers), [direction, answers]);
  const commentNeeded = complete && needsComment(direction, answers);
  const commentOk = !commentNeeded || comment.trim().length >= REVIEW_COMMENT_MIN_WHEN_LOW;
  const guest = direction === 'guest_to_host';

  function pick(key: string, value: number) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setSkipped((current) => ({ ...current, [key]: false }));
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
      photos,
    });
  }

  return (
    <form
      className="review-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
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
          <p className="muted">
            {ar
              ? 'اختر لكل بند من 1 (سيئ جداً) إلى 5 (ممتاز). تُحسب الدرجة من 10 تلقائياً، ويحلّل الذكاء الاصطناعي ملاحظاتك ليكمل التقييم النهائي.'
              : 'Rate each item from 1 (very poor) to 5 (excellent). The score on 10 updates as you go; AI reads your comment to finish the final score.'}
          </p>
        </div>
      </div>

      {rubric.map((group) => {
        const groupScore = scores.groups.find((item) => item.key === group.key)?.score ?? null;
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
            {group.criteria.map((item) => {
              const value = answers[item.key];
              const invalid = tried && !item.optional && !value;
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
                      {REVIEW_SCALE.map((step) => (
                        <label
                          key={step.value}
                          className={`review-form__step review-form__step--${step.value}${
                            value === step.value ? ' is-on' : ''
                          }`}
                          title={ar ? step.ar : step.en}
                        >
                          <input
                            type="radio"
                            name={name}
                            value={step.value}
                            checked={value === step.value}
                            onChange={() => pick(item.key, step.value)}
                          />
                          <span dir="ltr">{step.value}</span>
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

      {tried && missing.length ? (
        <p className="field__error" role="alert">
          {ar
            ? `بقي ${missing.length} من البنود المطلوبة دون تقييم.`
            : `${missing.length} required items are not rated yet.`}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="form-actions review-form__actions">
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy
            ? ar
              ? 'جارٍ التحليل والحفظ…'
              : 'Analysing and saving…'
            : ar
              ? 'إرسال التقييم'
              : 'Submit review'}
        </button>
        {onCancel ? (
          <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>
            {ar ? 'لاحقاً' : 'Later'}
          </button>
        ) : null}
      </div>
      <p className="muted review-form__note">
        {ar
          ? 'التقييم نهائي ولا يُعدَّل بعد إرساله. يظهر للطرف الآخر وللعامة بعد أن يقيّم الطرفان، أو بعد 14 يوماً.'
          : 'Reviews are final. They become visible once both sides have reviewed, or after 14 days.'}
      </p>
    </form>
  );
}
