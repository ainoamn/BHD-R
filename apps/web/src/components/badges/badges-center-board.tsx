'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeEmblem } from '@/components/badges/badge-emblem';
import { browserNextMutation } from '@/lib/api';
import { dateText, errorText, getJson } from '@/lib/badges-client';
import {
  AWARD_STATUS_LABELS,
  BADGE_GRANT_MODES,
  BADGE_ICONS,
  BADGE_LEVELS,
  BADGE_METRICS,
  BADGE_SUBJECTS,
  BADGE_TIERS,
  GRANT_LABELS,
  LEVEL_LABELS,
  SUBJECT_LABELS,
  TIER_LABELS,
  describeCriterion,
  endReasonText,
  formatMetric,
  isMetricKey,
  metricsFor,
  type BadgeAwardView,
  type BadgeCriterion,
  type BadgeDefinitionInput,
  type BadgeDefinitionView,
  type BadgeSubject,
  type BadgesCenter,
  type EvaluationSummary,
} from '@/lib/badges-shared';

type Locale = 'ar' | 'en';
type Tab = 'catalog' | 'pending' | 'activity';
type EditorState =
  { mode: 'create'; subject: BadgeSubject } | { mode: 'edit'; definition: BadgeDefinitionView };

function label(entry: { ar: string; en: string }, ar: boolean): string {
  return ar ? entry.ar : entry.en;
}

function validityText(definition: BadgeDefinitionInput, ar: boolean): string {
  if (!definition.validityDays)
    return ar ? 'دائمة ما دامت الشروط متحققة' : 'Kept while criteria hold';
  return ar
    ? `صالحة ${definition.validityDays} يوماً ثم تُجدَّد تلقائياً`
    : `Valid ${definition.validityDays} days, then renewed`;
}

function StatusPill({ status, ar }: { status: BadgeAwardView['status']; ar: boolean }) {
  return (
    <span className={`badge-pill badge-pill--${status}`}>
      {label(AWARD_STATUS_LABELS[status], ar)}
    </span>
  );
}

/** The organization's badges hub: catalogue per subject, holders, approvals, activity and the editor. */
export function BadgesCenterBoard({
  locale,
  portal,
}: {
  locale: Locale;
  portal: 'owner' | 'developer';
}) {
  const ar = locale === 'ar';
  const [center, setCenter] = useState<BadgesCenter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('catalog');
  const [filter, setFilter] = useState<BadgeSubject | 'all'>('all');
  const [holdersFor, setHoldersFor] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCenter(await getJson<BadgesCenter>(`/api/portal/badges?locale=${locale}`));
      setError(null);
    } catch (caught) {
      setError(errorText(caught, ar));
    }
  }, [ar, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const evaluate = async () => {
    setBusy('evaluate');
    setNotice(null);
    try {
      const summary = await browserNextMutation<EvaluationSummary>('/api/portal/badges/evaluate', {
        method: 'POST',
        body: '{}',
      });
      setNotice(
        ar
          ? `اكتمل التقييم: ${summary.subjects} عنصر فُحص، ${summary.awarded} شارة جديدة، ${summary.pending} بانتظار الاعتماد، ${summary.revoked} سُحبت، ${summary.expired} انتهت، ${summary.renewed} جُدّدت.`
          : `Evaluated ${summary.subjects}: ${summary.awarded} awarded, ${summary.pending} pending, ${summary.revoked} revoked, ${summary.expired} expired, ${summary.renewed} renewed.`,
      );
      await load();
    } catch (caught) {
      setNotice(errorText(caught, ar));
    } finally {
      setBusy(null);
    }
  };

  const decide = async (award: BadgeAwardView, action: 'approve' | 'reject' | 'revoke') => {
    let note: string | null = null;
    if (action !== 'approve') {
      const typed = window.prompt(ar ? 'سبب القرار (اختياري):' : 'Reason (optional):') ?? null;
      if (typed === null) return;
      note = typed.trim() || null;
    }
    setBusy(award.id);
    try {
      await browserNextMutation(`/api/portal/badges/awards/${award.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, note }),
      });
      await load();
    } catch (caught) {
      setNotice(errorText(caught, ar));
    } finally {
      setBusy(null);
    }
  };

  const definitions = useMemo(
    () => (center?.definitions ?? []).filter((item) => item.status !== 'archived'),
    [center],
  );
  const totals = useMemo(() => {
    const active = definitions.filter((item) => item.status === 'active');
    return {
      active: active.length,
      holders: definitions.reduce((sum, item) => sum + item.holders, 0),
      ever: definitions.reduce((sum, item) => sum + item.everAwarded, 0),
    };
  }, [definitions]);

  if (error && !center) {
    return (
      <section className="badges-center">
        <p className="form-error" role="alert">
          {error}
        </p>
        <button type="button" className="button button--secondary" onClick={() => void load()}>
          {ar ? 'إعادة المحاولة' : 'Retry'}
        </button>
      </section>
    );
  }
  if (!center) {
    return (
      <section className="badges-center" aria-busy="true">
        <p className="muted">{ar ? 'جارٍ تحميل الشارات…' : 'Loading badges…'}</p>
      </section>
    );
  }

  const subjects = filter === 'all' ? BADGE_SUBJECTS : [filter];

  return (
    <section className="badges-center">
      <header className="badges-hero">
        <div>
          <p className="eyebrow">{ar ? 'نظام التميّز' : 'Excellence programme'}</p>
          <h1>{ar ? 'الشارات والتميّز' : 'Badges & excellence'}</h1>
          <p className="muted">
            {ar
              ? 'شارات ودروع وشهادات وأوسمة تُمنح للمباني والملاك والمستأجرين والموظفين والعمال عند تحقيق شروط محددة لمدة محددة، وتُسحب تلقائياً عند تراجع الأداء.'
              : 'Badges, shields, certificates and medals awarded when criteria hold for a set period, and withdrawn when performance drops.'}
          </p>
        </div>
        <div className="badges-hero__actions">
          {center.canManage ? (
            <>
              <button
                type="button"
                className="button button--primary"
                disabled={busy === 'evaluate'}
                onClick={() => void evaluate()}
              >
                {busy === 'evaluate'
                  ? ar
                    ? 'جارٍ التقييم…'
                    : 'Evaluating…'
                  : ar
                    ? 'تقييم الآن'
                    : 'Evaluate now'}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() =>
                  setEditor({ mode: 'create', subject: filter === 'all' ? 'property' : filter })
                }
              >
                {ar ? 'شارة جديدة' : 'New badge'}
              </button>
            </>
          ) : null}
        </div>
      </header>

      <dl className="badges-kpis">
        <div>
          <dt>{ar ? 'شارات فعّالة' : 'Active badges'}</dt>
          <dd>{totals.active}</dd>
        </div>
        <div>
          <dt>{ar ? 'حاملون حالياً' : 'Current holders'}</dt>
          <dd>{totals.holders}</dd>
        </div>
        <div>
          <dt>{ar ? 'مُنحت منذ البداية' : 'Ever awarded'}</dt>
          <dd>{totals.ever}</dd>
        </div>
        <div>
          <dt>{ar ? 'بانتظار الاعتماد' : 'Awaiting approval'}</dt>
          <dd>{center.pending.length}</dd>
        </div>
        <div>
          <dt>{ar ? 'آخر تقييم' : 'Last evaluation'}</dt>
          <dd className="badges-kpis__date">{dateText(center.lastEvaluatedAt, ar)}</dd>
        </div>
      </dl>

      {notice ? (
        <p className="badges-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="badges-tabs" role="tablist">
        {(
          [
            ['catalog', ar ? 'سجل الشارات' : 'Catalogue'],
            ['pending', `${ar ? 'بانتظار الاعتماد' : 'Approvals'} (${center.pending.length})`],
            ['activity', ar ? 'آخر المنح والسحب' : 'Activity'],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-active' : undefined}
            onClick={() => setTab(id)}
          >
            {text}
          </button>
        ))}
      </div>

      {tab === 'catalog' ? (
        <>
          <div
            className="badges-filter"
            role="group"
            aria-label={ar ? 'نوع الشارات' : 'Badge type'}
          >
            <button
              type="button"
              className={filter === 'all' ? 'is-active' : undefined}
              onClick={() => setFilter('all')}
            >
              {ar ? 'الكل' : 'All'}
            </button>
            {BADGE_SUBJECTS.map((subject) => (
              <button
                key={subject}
                type="button"
                className={filter === subject ? 'is-active' : undefined}
                onClick={() => setFilter(subject)}
              >
                {ar ? SUBJECT_LABELS[subject].arMany : SUBJECT_LABELS[subject].en}
              </button>
            ))}
          </div>
          {subjects.map((subject) => {
            const list = definitions.filter((item) => item.subjectType === subject);
            return (
              <section key={subject} className="badges-group">
                <h2>
                  {ar ? SUBJECT_LABELS[subject].arMany : `${SUBJECT_LABELS[subject].en} badges`}
                </h2>
                {list.length === 0 ? (
                  <p className="muted">{ar ? 'لا توجد شارات لهذا النوع بعد.' : 'No badges yet.'}</p>
                ) : (
                  <div className="badges-grid">
                    {list.map((definition) => (
                      <article
                        key={definition.id}
                        className={`badge-card badge-card--${definition.level}${definition.status !== 'active' ? ' is-paused' : ''}`}
                      >
                        <button
                          type="button"
                          className="badge-card__main"
                          onClick={() => setHoldersFor(definition.id)}
                          aria-label={
                            ar
                              ? `عرض حاملي ${definition.nameAr}`
                              : `Holders of ${definition.nameEn}`
                          }
                        >
                          <BadgeEmblem
                            tier={definition.tier}
                            level={definition.level}
                            icon={definition.icon}
                            size={64}
                            muted={definition.status !== 'active'}
                          />
                          <span className="badge-card__text">
                            <span className="badge-card__serial" dir="ltr">
                              {definition.serial}
                            </span>
                            <strong>{ar ? definition.nameAr : definition.nameEn}</strong>
                            <span className="muted">
                              {label(TIER_LABELS[definition.tier], ar)} ·{' '}
                              {label(LEVEL_LABELS[definition.level], ar)}
                              {definition.status !== 'active'
                                ? ` · ${ar ? 'موقوفة' : 'Paused'}`
                                : ''}
                            </span>
                          </span>
                        </button>
                        <ul className="badge-card__criteria">
                          {definition.criteria.map((criterion, index) => (
                            <li key={index}>{describeCriterion(criterion, ar)}</li>
                          ))}
                        </ul>
                        <p className="badge-card__meta muted">
                          {ar
                            ? `لمدة ${definition.sustainDays} يوماً متصلة · نافذة ${definition.windowDays} يوماً`
                            : `${definition.sustainDays} days sustained · ${definition.windowDays}-day window`}
                          <br />
                          {validityText(definition, ar)} ·{' '}
                          {label(GRANT_LABELS[definition.grantMode], ar)}
                        </p>
                        <footer className="badge-card__foot">
                          <button
                            type="button"
                            className="badge-card__holders"
                            onClick={() => setHoldersFor(definition.id)}
                          >
                            {ar ? `${definition.holders} حامل` : `${definition.holders} holders`}
                            {definition.pending
                              ? ` · ${definition.pending} ${ar ? 'معلّق' : 'pending'}`
                              : ''}
                          </button>
                          {center.canManage ? (
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              onClick={() => setEditor({ mode: 'edit', definition })}
                            >
                              {ar ? 'تعديل' : 'Edit'}
                            </button>
                          ) : null}
                        </footer>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </>
      ) : (
        <AwardList
          locale={locale}
          portal={portal}
          awards={tab === 'pending' ? center.pending : center.recent}
          canManage={center.canManage}
          busy={busy}
          empty={
            tab === 'pending'
              ? ar
                ? 'لا توجد شارات بانتظار الاعتماد.'
                : 'Nothing awaiting approval.'
              : ar
                ? 'لم تُمنح أي شارة بعد. اضغط «تقييم الآن» لبدء الفحص.'
                : 'No awards yet. Press “Evaluate now”.'
          }
          onDecide={decide}
          onOpenBadge={setHoldersFor}
        />
      )}

      {holdersFor ? (
        <HoldersDrawer
          locale={locale}
          portal={portal}
          badgeId={holdersFor}
          canManage={center.canManage}
          onClose={() => setHoldersFor(null)}
          onChanged={load}
        />
      ) : null}
      {editor ? (
        <DefinitionEditor
          locale={locale}
          state={editor}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}

function AwardList({
  locale,
  portal,
  awards,
  canManage,
  busy,
  empty,
  onDecide,
  onOpenBadge,
}: {
  locale: Locale;
  portal: 'owner' | 'developer';
  awards: BadgeAwardView[];
  canManage: boolean;
  busy: string | null;
  empty: string;
  onDecide: (award: BadgeAwardView, action: 'approve' | 'reject' | 'revoke') => Promise<void>;
  onOpenBadge?: (badgeId: string) => void;
}) {
  const ar = locale === 'ar';
  if (awards.length === 0) return <p className="muted badges-empty">{empty}</p>;
  return (
    <ul className="award-list">
      {awards.map((award) => {
        const ended = endReasonText(award.endReason, ar);
        const rationale = ar ? award.rationaleAr : award.rationaleEn;
        return (
          <li key={award.id} className={`award-row award-row--${award.status}`}>
            <BadgeEmblem
              tier={award.tier}
              level={award.level}
              icon={award.icon}
              size={44}
              muted={award.status !== 'active' && award.status !== 'pending'}
            />
            <div className="award-row__body">
              <p className="award-row__title">
                <strong>{award.subjectName}</strong>
                <span className="muted"> · {label(SUBJECT_LABELS[award.subjectType], ar)}</span>
              </p>
              <p className="award-row__badge">
                {onOpenBadge ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onOpenBadge(award.badgeId)}
                  >
                    {ar ? award.badgeNameAr : award.badgeNameEn}
                  </button>
                ) : (
                  <span>{ar ? award.badgeNameAr : award.badgeNameEn}</span>
                )}
                <span className="award-row__serial" dir="ltr">
                  {award.serial}
                </span>
                <StatusPill status={award.status} ar={ar} />
              </p>
              <p className="muted award-row__dates">
                {award.awardedAt
                  ? `${ar ? 'مُنحت' : 'Awarded'} ${dateText(award.awardedAt, ar)}`
                  : `${ar ? 'اقتُرحت' : 'Proposed'} ${dateText(award.createdAt, ar)}`}
                {award.expiresAt && award.status === 'active'
                  ? ` · ${ar ? 'تنتهي' : 'Expires'} ${dateText(award.expiresAt, ar)}`
                  : ''}
                {award.endedAt
                  ? ` · ${ar ? 'أُغلقت' : 'Closed'} ${dateText(award.endedAt, ar)}`
                  : ''}
              </p>
              {rationale ? <p className="award-row__why">{rationale}</p> : null}
              {ended ? <p className="award-row__ended">{ended}</p> : null}
            </div>
            <div className="award-row__actions">
              {award.status === 'active' || award.status === 'expired' ? (
                <Link
                  className="button button--ghost button--small"
                  href={`/${locale}/${portal}/badges/awards/${award.id}`}
                >
                  {award.tier === 'badge'
                    ? ar
                      ? 'البطاقة'
                      : 'Card'
                    : ar
                      ? 'الشهادة'
                      : 'Certificate'}
                </Link>
              ) : null}
              {canManage && award.status === 'pending' ? (
                <>
                  <button
                    type="button"
                    className="button button--primary button--small"
                    disabled={busy === award.id}
                    onClick={() => void onDecide(award, 'approve')}
                  >
                    {ar ? 'اعتماد' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    disabled={busy === award.id}
                    onClick={() => void onDecide(award, 'reject')}
                  >
                    {ar ? 'رفض' : 'Reject'}
                  </button>
                </>
              ) : null}
              {canManage && award.status === 'active' ? (
                <button
                  type="button"
                  className="button button--danger button--small"
                  disabled={busy === award.id}
                  onClick={() => void onDecide(award, 'revoke')}
                >
                  {ar ? 'سحب' : 'Revoke'}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function HoldersDrawer({
  locale,
  portal,
  badgeId,
  canManage,
  onClose,
  onChanged,
}: {
  locale: Locale;
  portal: 'owner' | 'developer';
  badgeId: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const ar = locale === 'ar';
  const [data, setData] = useState<{
    definition: BadgeDefinitionView;
    awards: BadgeAwardView[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<'current' | 'all'>('current');
  const [subjects, setSubjects] = useState<{ id: string; name: string }[] | null>(null);
  const [grantTo, setGrantTo] = useState('');
  const [grantNote, setGrantNote] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await getJson(`/api/portal/badges/definitions/${badgeId}?locale=${locale}`));
      setError(null);
    } catch (caught) {
      setError(errorText(caught, ar));
    }
  }, [ar, badgeId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openGrant = async () => {
    if (!data) return;
    try {
      const result = await getJson<{ subjects: { id: string; name: string }[] }>(
        `/api/portal/badges/subjects?type=${data.definition.subjectType}&locale=${locale}`,
      );
      setSubjects(result.subjects);
    } catch (caught) {
      setError(errorText(caught, ar));
    }
  };

  const grant = async () => {
    setBusy('grant');
    try {
      await browserNextMutation('/api/portal/badges/awards', {
        method: 'POST',
        body: JSON.stringify({ badgeId, subjectId: grantTo, note: grantNote.trim() }),
      });
      setSubjects(null);
      setGrantTo('');
      setGrantNote('');
      await Promise.all([load(), onChanged()]);
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(null);
    }
  };

  const decide = async (award: BadgeAwardView, action: 'approve' | 'reject' | 'revoke') => {
    let note: string | null = null;
    if (action !== 'approve') {
      const typed = window.prompt(ar ? 'سبب القرار (اختياري):' : 'Reason (optional):') ?? null;
      if (typed === null) return;
      note = typed.trim() || null;
    }
    setBusy(award.id);
    try {
      await browserNextMutation(`/api/portal/badges/awards/${award.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, note }),
      });
      await Promise.all([load(), onChanged()]);
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(null);
    }
  };

  const definition = data?.definition;
  const shown = (data?.awards ?? []).filter(
    (award) => view === 'all' || award.status === 'active' || award.status === 'pending',
  );

  return (
    <div
      className="badges-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={ar ? 'حاملو الشارة' : 'Badge holders'}
    >
      <button
        type="button"
        className="badges-drawer__scrim"
        aria-label={ar ? 'إغلاق' : 'Close'}
        onClick={onClose}
      />
      <div className="badges-drawer__panel">
        <button
          type="button"
          className="badges-drawer__close"
          onClick={onClose}
          aria-label={ar ? 'إغلاق' : 'Close'}
        >
          ×
        </button>
        {!definition ? (
          error ? (
            <p className="form-error">{error}</p>
          ) : (
            <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
          )
        ) : (
          <>
            <header className="badges-drawer__head">
              <BadgeEmblem
                tier={definition.tier}
                level={definition.level}
                icon={definition.icon}
                size={88}
              />
              <div>
                <p className="badge-card__serial" dir="ltr">
                  {definition.serial}
                </p>
                <h2>{ar ? definition.nameAr : definition.nameEn}</h2>
                <p className="muted">
                  {label(SUBJECT_LABELS[definition.subjectType], ar)} ·{' '}
                  {label(TIER_LABELS[definition.tier], ar)} ·{' '}
                  {label(LEVEL_LABELS[definition.level], ar)}
                </p>
                {(ar ? definition.descriptionAr : definition.descriptionEn) ? (
                  <p>{ar ? definition.descriptionAr : definition.descriptionEn}</p>
                ) : null}
              </div>
            </header>
            <section className="badges-drawer__rules">
              <h3>{ar ? 'شروط المنح' : 'Criteria'}</h3>
              <ul>
                {definition.criteria.map((criterion, index) => (
                  <li key={index}>{describeCriterion(criterion, ar)}</li>
                ))}
              </ul>
              <p className="muted">
                {ar
                  ? `يجب أن تتحقق الشروط ${definition.sustainDays} يوماً متصلة. ${validityText(definition, ar)}. ${definition.autoRevoke ? 'تُسحب تلقائياً إذا تراجعت المعايير (عدا الممنوحة يدوياً).' : 'لا تُسحب تلقائياً.'}`
                  : `Criteria must hold ${definition.sustainDays} days. ${validityText(definition, ar)}. ${definition.autoRevoke ? 'Auto-revoked when criteria fail (except hand grants).' : 'Not auto-revoked.'}`}
              </p>
            </section>
            <dl className="badges-kpis badges-kpis--compact">
              <div>
                <dt>{ar ? 'حاملون حالياً' : 'Holders'}</dt>
                <dd>{definition.holders}</dd>
              </div>
              <div>
                <dt>{ar ? 'معلّقة' : 'Pending'}</dt>
                <dd>{definition.pending}</dd>
              </div>
              <div>
                <dt>{ar ? 'مُنحت إجمالاً' : 'Ever awarded'}</dt>
                <dd>{definition.everAwarded}</dd>
              </div>
            </dl>
            {error ? <p className="form-error">{error}</p> : null}
            {canManage && definition.status === 'active' ? (
              subjects ? (
                <div className="badges-grant">
                  <label>
                    <span>{ar ? 'منح يدوي إلى' : 'Grant to'}</span>
                    <select value={grantTo} onChange={(event) => setGrantTo(event.target.value)}>
                      <option value="">{ar ? '— اختر —' : '— Choose —'}</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>
                      {ar ? 'سبب المنح (يظهر في الشهادة)' : 'Reason (shown on the certificate)'}
                    </span>
                    <textarea
                      rows={2}
                      maxLength={400}
                      value={grantNote}
                      onChange={(event) => setGrantNote(event.target.value)}
                    />
                  </label>
                  <div className="badges-grant__actions">
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={!grantTo || grantNote.trim().length < 3 || busy === 'grant'}
                      onClick={() => void grant()}
                    >
                      {ar ? 'منح الشارة' : 'Grant'}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setSubjects(null)}
                    >
                      {ar ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => void openGrant()}
                >
                  {ar ? 'منح يدوي' : 'Grant by hand'}
                </button>
              )
            ) : null}
            <div className="badges-tabs badges-tabs--small" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'current'}
                className={view === 'current' ? 'is-active' : undefined}
                onClick={() => setView('current')}
              >
                {ar ? 'المقلَّدون حالياً' : 'Current holders'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'all'}
                className={view === 'all' ? 'is-active' : undefined}
                onClick={() => setView('all')}
              >
                {ar ? 'السجل الكامل' : 'Full history'}
              </button>
            </div>
            <AwardList
              locale={locale}
              portal={portal}
              awards={shown}
              canManage={canManage}
              busy={busy}
              empty={ar ? 'لم يُقلَّد أحد هذه الشارة بعد.' : 'Nobody holds this badge yet.'}
              onDecide={decide}
            />
          </>
        )}
      </div>
    </div>
  );
}

const EMPTY_INPUT = (subject: BadgeSubject): BadgeDefinitionInput => ({
  subjectType: subject,
  tier: 'badge',
  level: 'gold',
  nameAr: '',
  nameEn: '',
  descriptionAr: null,
  descriptionEn: null,
  icon: 'star',
  criteria: [{ metric: metricsFor(subject)[0]!, op: 'gte', value: 1 }],
  windowDays: 90,
  sustainDays: 30,
  validityDays: 180,
  autoRevoke: true,
  grantMode: 'auto',
});

function editableFields(definition: BadgeDefinitionInput): BadgeDefinitionInput {
  return {
    subjectType: definition.subjectType,
    tier: definition.tier,
    level: definition.level,
    nameAr: definition.nameAr,
    nameEn: definition.nameEn,
    descriptionAr: definition.descriptionAr,
    descriptionEn: definition.descriptionEn,
    icon: definition.icon,
    criteria: definition.criteria.map((criterion) => ({ ...criterion })),
    windowDays: definition.windowDays,
    sustainDays: definition.sustainDays,
    validityDays: definition.validityDays,
    autoRevoke: definition.autoRevoke,
    grantMode: definition.grantMode,
  };
}

function DefinitionEditor({
  locale,
  state,
  onClose,
  onSaved,
}: {
  locale: Locale;
  state: EditorState;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const ar = locale === 'ar';
  const [input, setInput] = useState<BadgeDefinitionInput>(() =>
    state.mode === 'edit' ? editableFields(state.definition) : EMPTY_INPUT(state.subject),
  );
  const [status, setStatus] = useState<'active' | 'inactive' | 'archived'>(
    state.mode === 'edit' && state.definition.status !== 'draft'
      ? state.definition.status
      : 'active',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const allowed = metricsFor(input.subjectType);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = <K extends keyof BadgeDefinitionInput>(key: K, value: BadgeDefinitionInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));

  const setCriterion = (index: number, patch: Partial<BadgeCriterion>) =>
    setInput((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, at) => {
        if (at !== index) return criterion;
        const next = { ...criterion, ...patch };
        if (patch.metric) {
          const info = BADGE_METRICS[patch.metric];
          next.op = info.higherIsBetter ? 'gte' : 'lte';
          next.value = info.unit === 'flag' ? 1 : criterion.value;
        }
        return next;
      }),
    }));

  const changeSubject = (subject: BadgeSubject) =>
    setInput((current) => {
      const metrics = metricsFor(subject);
      const kept = current.criteria.filter((criterion) => metrics.includes(criterion.metric));
      return {
        ...current,
        subjectType: subject,
        criteria: kept.length ? kept : [{ metric: metrics[0]!, op: 'gte', value: 1 }],
      };
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      ...input,
      nameAr: input.nameAr.trim(),
      nameEn: input.nameEn.trim(),
      descriptionAr: input.descriptionAr?.trim() || null,
      descriptionEn: input.descriptionEn?.trim() || null,
    };
    try {
      if (state.mode === 'create') {
        await browserNextMutation('/api/portal/badges/definitions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      } else {
        const { subjectType: _subject, ...rest } = body;
        void _subject;
        await browserNextMutation(`/api/portal/badges/definitions/${state.definition.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...rest, status }),
        });
      }
      await onSaved();
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="badges-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={ar ? 'محرر الشارة' : 'Badge editor'}
    >
      <button
        type="button"
        className="badges-drawer__scrim"
        aria-label={ar ? 'إغلاق' : 'Close'}
        onClick={onClose}
      />
      <div className="badges-drawer__panel badges-editor">
        <button
          type="button"
          className="badges-drawer__close"
          onClick={onClose}
          aria-label={ar ? 'إغلاق' : 'Close'}
        >
          ×
        </button>
        <header className="badges-drawer__head">
          <BadgeEmblem tier={input.tier} level={input.level} icon={input.icon} size={88} />
          <div>
            <h2>
              {state.mode === 'create'
                ? ar
                  ? 'شارة جديدة'
                  : 'New badge'
                : ar
                  ? 'تعديل الشارة'
                  : 'Edit badge'}
            </h2>
            <p className="muted">
              {input.nameAr || (ar ? 'اسم الشارة' : 'Badge name')} ·{' '}
              {label(TIER_LABELS[input.tier], ar)} · {label(LEVEL_LABELS[input.level], ar)}
            </p>
          </div>
        </header>
        <div className="badges-editor__grid">
          <label>
            <span>{ar ? 'تُمنح لـ' : 'Awarded to'}</span>
            <select
              value={input.subjectType}
              disabled={state.mode === 'edit'}
              onChange={(event) => changeSubject(event.target.value as BadgeSubject)}
            >
              {BADGE_SUBJECTS.map((subject) => (
                <option key={subject} value={subject}>
                  {label(SUBJECT_LABELS[subject], ar)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{ar ? 'الشكل' : 'Form'}</span>
            <select
              value={input.tier}
              onChange={(event) => set('tier', event.target.value as BadgeDefinitionInput['tier'])}
            >
              {BADGE_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {label(TIER_LABELS[tier], ar)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{ar ? 'المستوى' : 'Level'}</span>
            <select
              value={input.level}
              onChange={(event) =>
                set('level', event.target.value as BadgeDefinitionInput['level'])
              }
            >
              {BADGE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {label(LEVEL_LABELS[level], ar)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{ar ? 'طريقة المنح' : 'Granting'}</span>
            <select
              value={input.grantMode}
              onChange={(event) =>
                set('grantMode', event.target.value as BadgeDefinitionInput['grantMode'])
              }
            >
              {BADGE_GRANT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {label(GRANT_LABELS[mode], ar)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{ar ? 'الاسم بالعربية' : 'Arabic name'}</span>
            <input
              value={input.nameAr}
              maxLength={80}
              onChange={(event) => set('nameAr', event.target.value)}
            />
          </label>
          <label>
            <span>{ar ? 'الاسم بالإنجليزية' : 'English name'}</span>
            <input
              dir="ltr"
              value={input.nameEn}
              maxLength={80}
              onChange={(event) => set('nameEn', event.target.value)}
            />
          </label>
          <label className="badges-editor__wide">
            <span>{ar ? 'الوصف بالعربية' : 'Arabic description'}</span>
            <textarea
              rows={2}
              maxLength={400}
              value={input.descriptionAr ?? ''}
              onChange={(event) => set('descriptionAr', event.target.value)}
            />
          </label>
          <label className="badges-editor__wide">
            <span>{ar ? 'الوصف بالإنجليزية' : 'English description'}</span>
            <textarea
              dir="ltr"
              rows={2}
              maxLength={400}
              value={input.descriptionEn ?? ''}
              onChange={(event) => set('descriptionEn', event.target.value)}
            />
          </label>
        </div>
        <fieldset className="badges-editor__icons">
          <legend>{ar ? 'الرمز' : 'Icon'}</legend>
          {BADGE_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              className={input.icon === icon ? 'is-active' : undefined}
              aria-pressed={input.icon === icon}
              aria-label={icon}
              onClick={() => set('icon', icon)}
            >
              <BadgeEmblem tier="badge" level={input.level} icon={icon} size={34} />
            </button>
          ))}
        </fieldset>
        <fieldset className="badges-editor__criteria">
          <legend>{ar ? 'الشروط (يجب أن تتحقق كلها)' : 'Criteria (all must hold)'}</legend>
          {input.criteria.map((criterion, index) => {
            const info = BADGE_METRICS[criterion.metric];
            return (
              <div key={index} className="badges-editor__criterion">
                <select
                  value={criterion.metric}
                  onChange={(event) =>
                    isMetricKey(event.target.value) &&
                    setCriterion(index, { metric: event.target.value })
                  }
                >
                  {allowed.map((key) => (
                    <option key={key} value={key}>
                      {ar ? BADGE_METRICS[key].ar : BADGE_METRICS[key].en}
                    </option>
                  ))}
                </select>
                {info.unit === 'flag' ? (
                  <select
                    value={criterion.value >= 1 ? 'yes' : 'no'}
                    onChange={(event) =>
                      setCriterion(
                        index,
                        event.target.value === 'yes'
                          ? { op: 'gte', value: 1 }
                          : { op: 'lte', value: 0 },
                      )
                    }
                  >
                    <option value="yes">{ar ? 'نعم' : 'Yes'}</option>
                    <option value="no">{ar ? 'لا' : 'No'}</option>
                  </select>
                ) : (
                  <>
                    <select
                      value={criterion.op}
                      onChange={(event) =>
                        setCriterion(index, { op: event.target.value as 'gte' | 'lte' })
                      }
                    >
                      <option value="gte">{ar ? 'لا يقل عن' : 'at least'}</option>
                      <option value="lte">{ar ? 'لا يزيد عن' : 'at most'}</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      step={info.unit === 'rating' || info.unit === 'days' ? 0.1 : 1}
                      value={criterion.value}
                      onChange={(event) =>
                        setCriterion(index, { value: Number(event.target.value) || 0 })
                      }
                    />
                  </>
                )}
                <span className="muted badges-editor__hint">
                  {formatMetric(criterion.metric, criterion.value, ar)}
                </span>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  disabled={input.criteria.length <= 1}
                  onClick={() =>
                    set(
                      'criteria',
                      input.criteria.filter((_, at) => at !== index),
                    )
                  }
                >
                  {ar ? 'حذف' : 'Remove'}
                </button>
              </div>
            );
          })}
          {input.criteria.length < 8 ? (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() =>
                set('criteria', [...input.criteria, { metric: allowed[0]!, op: 'gte', value: 1 }])
              }
            >
              {ar ? 'إضافة شرط' : 'Add criterion'}
            </button>
          ) : null}
        </fieldset>
        <div className="badges-editor__grid">
          <label>
            <span>{ar ? 'نافذة القياس (يوم)' : 'Measurement window (days)'}</span>
            <input
              type="number"
              min={7}
              max={3650}
              value={input.windowDays}
              onChange={(event) => set('windowDays', Math.round(Number(event.target.value) || 0))}
            />
          </label>
          <label>
            <span>{ar ? 'مدة الاستمرار المطلوبة (يوم)' : 'Must hold for (days)'}</span>
            <input
              type="number"
              min={0}
              max={3650}
              value={input.sustainDays}
              onChange={(event) => set('sustainDays', Math.round(Number(event.target.value) || 0))}
            />
          </label>
          <label>
            <span>
              {ar ? 'الصلاحية (يوم، فارغ = دائمة)' : 'Validity (days, empty = permanent)'}
            </span>
            <input
              type="number"
              min={1}
              max={3650}
              value={input.validityDays ?? ''}
              onChange={(event) =>
                set(
                  'validityDays',
                  event.target.value ? Math.round(Number(event.target.value)) : null,
                )
              }
            />
          </label>
          <label className="badges-editor__check">
            <input
              type="checkbox"
              checked={input.autoRevoke}
              onChange={(event) => set('autoRevoke', event.target.checked)}
            />
            <span>
              {ar
                ? 'تُسحب تلقائياً إذا تراجعت المعايير'
                : 'Revoke automatically when criteria fail'}
            </span>
          </label>
          {state.mode === 'edit' ? (
            <label>
              <span>{ar ? 'الحالة' : 'Status'}</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as typeof status)}
              >
                <option value="active">{ar ? 'فعّالة' : 'Active'}</option>
                <option value="inactive">{ar ? 'موقوفة مؤقتاً' : 'Paused'}</option>
                <option value="archived">
                  {ar ? 'مؤرشفة (تُسحب من حامليها)' : 'Archived (withdrawn)'}
                </option>
              </select>
            </label>
          ) : null}
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="badges-grant__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ الشارة' : 'Save badge'}
          </button>
          <button type="button" className="button button--ghost" onClick={onClose}>
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
