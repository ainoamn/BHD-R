'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IdentityAvatar, VerifiedMark } from '@/components/identity/verified-mark';
import { browserNextMutation } from '@/lib/api';
import { dateText, errorText, getJson, shrinkImage } from '@/lib/badges-client';
import { formatMoney } from '@/lib/format';
import {
  BUSINESS_DOCUMENTS,
  DOCUMENT_LABELS,
  KIND_LABELS,
  NAME_MATCH_THRESHOLD,
  PAYMENT_LABELS,
  PERIOD_LABELS,
  PERSONAL_DOCUMENTS,
  RENEWAL_WINDOW_DAYS,
  SLOT_LABELS,
  STATUS_LABELS,
  VERIFICATION_PERIODS,
  bestNameMatch,
  type AccountVerificationState,
  type DocumentSlot,
  type VerificationDocumentType,
  type VerificationKind,
  type VerificationPeriod,
  type VerificationPlan,
  type VerificationRecord,
} from '@/lib/verification-shared';

type Locale = 'ar' | 'en';

const REQUIRED_SLOTS: Record<VerificationDocumentType, DocumentSlot[]> = {
  civil_id: ['front', 'back', 'selfie'],
  residence_card: ['front', 'back', 'selfie'],
  passport: ['front', 'selfie'],
  commercial_registration: ['registration'],
};

function planFor(plans: VerificationPlan[], kind: VerificationKind, period: VerificationPeriod) {
  return plans.find((plan) => plan.kind === kind && plan.period === period && plan.active) ?? null;
}

function priceText(plan: VerificationPlan | null, locale: Locale): string {
  if (!plan) return locale === 'ar' ? 'غير متاح' : 'Unavailable';
  if (plan.priceMinor === '0') return locale === 'ar' ? 'مجاناً' : 'Free';
  return formatMoney(plan.priceMinor, plan.currency, locale);
}

function daysLeft(until: string | null): number | null {
  if (!until) return null;
  return Math.ceil((new Date(until).getTime() - Date.now()) / 86_400_000);
}

/** The signed-in person's own page: picture, verification requests, renewals and organization logos. */
export function AccountCenter({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const [state, setState] = useState<AccountVerificationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<{
    kind: VerificationKind;
    organizationId: string | null;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await getJson<AccountVerificationState>('/api/account/state'));
      setError(null);
    } catch (caught) {
      setError(errorText(caught, ar));
    }
  }, [ar]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadImage = async (subject: 'user' | 'organization', subjectId: string, file: File) => {
    setBusy(`img-${subjectId}`);
    setNotice(null);
    try {
      const dataUrl = await shrinkImage(file, 720, 0.9);
      await browserNextMutation('/api/account/avatar', {
        method: 'POST',
        body: JSON.stringify({ subject, subjectId, dataUrl }),
      });
      await load();
      setNotice(ar ? 'تم تحديث الصورة.' : 'Picture updated.');
    } catch (caught) {
      setNotice(errorText(caught, ar));
    } finally {
      setBusy(null);
    }
  };

  const removeImage = async (subject: 'user' | 'organization', subjectId: string) => {
    setBusy(`img-${subjectId}`);
    try {
      await browserNextMutation('/api/account/avatar', {
        method: 'DELETE',
        body: JSON.stringify({ subject, subjectId }),
      });
      await load();
    } catch (caught) {
      setNotice(errorText(caught, ar));
    } finally {
      setBusy(null);
    }
  };

  const act = async (record: VerificationRecord, body: Record<string, string>) => {
    if (
      body.action === 'cancel' &&
      !window.confirm(ar ? 'سحب طلب التوثيق؟' : 'Withdraw this request?')
    )
      return;
    setBusy(record.id);
    setNotice(null);
    try {
      await browserNextMutation(`/api/account/verification/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      await load();
      if (body.action === 'renew')
        setNotice(
          ar
            ? 'أُرسل طلب التجديد بنفس المستندات. سيتواصل معك فريق التوثيق لتأكيد سداد الرسوم.'
            : 'Renewal sent with the same documents. The team will confirm the fee.',
        );
    } catch (caught) {
      setNotice(errorText(caught, ar));
    } finally {
      setBusy(null);
    }
  };

  if (!state) {
    return (
      <section className="account-center" aria-busy={!error}>
        {error ? (
          <>
            <p className="form-error" role="alert">
              {error}
            </p>
            <button type="button" className="button button--secondary" onClick={() => void load()}>
              {ar ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </>
        ) : (
          <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
        )}
      </section>
    );
  }

  const openPersonal = state.history.find(
    (record) => record.kind === 'personal' && record.status === 'submitted',
  );
  const lastPersonal = state.history.find(
    (record) => record.kind === 'personal' && record.status === 'approved',
  );
  const personalDays = daysLeft(state.personal.until);
  const canRenewPersonal =
    !!lastPersonal &&
    state.personal.verified &&
    !openPersonal &&
    personalDays !== null &&
    personalDays <= RENEWAL_WINDOW_DAYS;

  return (
    <section className="account-center">
      <header className="account-hero">
        <div className="account-hero__avatar">
          <IdentityAvatar
            name={state.displayName}
            mark={{ verified: state.personal.verified, avatarUrl: state.avatarUrl }}
            locale={locale}
            size={96}
          />
          <ImagePicker
            ar={ar}
            busy={busy === `img-${state.userId}`}
            hasImage={!!state.avatarUrl}
            onPick={(file) => void uploadImage('user', state.userId, file)}
            onRemove={() => void removeImage('user', state.userId)}
          />
        </div>
        <div>
          <p className="eyebrow">{ar ? 'حسابي' : 'My account'}</p>
          <h1 className="account-hero__name">
            {state.displayName}
            <VerifiedMark verified={state.personal.verified} locale={locale} size={22} />
          </h1>
          <p className={`account-status${state.personal.verified ? ' is-verified' : ''}`}>
            {state.personal.verified
              ? ar
                ? `حساب موثّق حتى ${dateText(state.personal.until, ar)}`
                : `Verified until ${dateText(state.personal.until, ar)}`
              : openPersonal
                ? ar
                  ? 'طلب التوثيق قيد المراجعة'
                  : 'Verification under review'
                : ar
                  ? 'الحساب غير موثّق'
                  : 'Not verified'}
          </p>
          {state.personal.nameDrift ? (
            <p className="notice notice--warn">
              {ar
                ? 'تغيّر اسم حسابك ولم يعد يطابق مستند التوثيق، لذلك أُخفيت علامة التوثيق. أعد الاسم كما كان أو قدّم طلباً جديداً.'
                : 'Your account name no longer matches the verified document, so the tick is hidden.'}
            </p>
          ) : null}
        </div>
      </header>

      {notice ? (
        <p className="badges-notice" role="status">
          {notice}
        </p>
      ) : null}

      <section className="account-card">
        <h2>{ar ? 'توثيق الحساب الشخصي' : 'Personal verification'}</h2>
        <p className="muted">
          {ar
            ? 'تظهر علامة التوثيق الزرقاء بجانب اسمك في كل الصفحات بعد مطابقة اسمك مع مستند رسمي وسداد رسوم التوثيق. لا يطّلع على مستنداتك إلا فريق التوثيق المخوّل.'
            : 'The blue tick appears beside your name everywhere once your name matches an official document and the fee is settled. Only the authorized verification team sees your documents.'}
        </p>
        <PlansStrip plans={state.plans} kind="personal" locale={locale} />
        {openPersonal ? (
          <RecordCard
            record={openPersonal}
            locale={locale}
            busy={busy === openPersonal.id}
            onAct={act}
          />
        ) : form?.kind === 'personal' ? null : (
          <div className="account-card__actions">
            {canRenewPersonal && lastPersonal ? (
              <RenewButtons
                record={lastPersonal}
                plans={state.plans}
                locale={locale}
                busy={busy === lastPersonal.id}
                onAct={act}
              />
            ) : null}
            {!state.personal.verified ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => setForm({ kind: 'personal', organizationId: null })}
              >
                {ar ? 'ابدأ توثيق حسابي' : 'Verify my account'}
              </button>
            ) : null}
          </div>
        )}
        {form?.kind === 'personal' ? (
          <VerificationForm
            locale={locale}
            kind="personal"
            organizationId={null}
            accountName={state.displayName}
            plans={state.plans}
            onCancel={() => setForm(null)}
            onDone={async (serial) => {
              setForm(null);
              await load();
              setNotice(
                ar
                  ? `استلمنا طلبك برقم ${serial}. سيتواصل معك فريق التوثيق لتأكيد سداد الرسوم ثم المراجعة.`
                  : `Request ${serial} received. The team will confirm the fee, then review.`,
              );
            }}
          />
        ) : null}
      </section>

      {state.organizations.length ? (
        <section className="account-card">
          <h2>{ar ? 'منشآتي: الشعار والتوثيق' : 'My organizations: logo & verification'}</h2>
          <ul className="account-orgs">
            {state.organizations.map((org) => {
              const open = state.history.find(
                (record) =>
                  record.kind === 'business' &&
                  record.organizationId === org.id &&
                  record.status === 'submitted',
              );
              const last = state.history.find(
                (record) =>
                  record.kind === 'business' &&
                  record.organizationId === org.id &&
                  record.status === 'approved',
              );
              const left = daysLeft(org.until);
              return (
                <li key={org.id} className="account-org">
                  <div className="account-org__head">
                    <IdentityAvatar
                      name={org.name}
                      mark={{ verified: org.verified, avatarUrl: org.logoUrl }}
                      locale={locale}
                      size={56}
                      business
                    />
                    <div>
                      <strong className="account-org__name">
                        {org.name}
                        <VerifiedMark verified={org.verified} locale={locale} business />
                      </strong>
                      <p className="muted">
                        {org.verified
                          ? ar
                            ? `منشأة موثّقة حتى ${dateText(org.until, ar)}`
                            : `Verified until ${dateText(org.until, ar)}`
                          : open
                            ? ar
                              ? 'طلب التوثيق قيد المراجعة'
                              : 'Under review'
                            : ar
                              ? 'غير موثّقة'
                              : 'Not verified'}
                      </p>
                    </div>
                    <ImagePicker
                      ar={ar}
                      business
                      busy={busy === `img-${org.id}`}
                      hasImage={!!org.logoUrl}
                      onPick={(file) => void uploadImage('organization', org.id, file)}
                      onRemove={() => void removeImage('organization', org.id)}
                    />
                  </div>
                  {open ? (
                    <RecordCard record={open} locale={locale} busy={busy === open.id} onAct={act} />
                  ) : form?.kind === 'business' && form.organizationId === org.id ? (
                    <VerificationForm
                      locale={locale}
                      kind="business"
                      organizationId={org.id}
                      accountName={org.name}
                      plans={state.plans}
                      onCancel={() => setForm(null)}
                      onDone={async (serial) => {
                        setForm(null);
                        await load();
                        setNotice(
                          ar
                            ? `استلمنا طلب توثيق المنشأة برقم ${serial}.`
                            : `Business request ${serial} received.`,
                        );
                      }}
                    />
                  ) : (
                    <div className="account-card__actions">
                      {last && org.verified && left !== null && left <= RENEWAL_WINDOW_DAYS ? (
                        <RenewButtons
                          record={last}
                          plans={state.plans}
                          locale={locale}
                          busy={busy === last.id}
                          onAct={act}
                        />
                      ) : null}
                      {!org.verified ? (
                        <button
                          type="button"
                          className="button button--secondary"
                          onClick={() => setForm({ kind: 'business', organizationId: org.id })}
                        >
                          {ar ? 'توثيق المنشأة' : 'Verify business'}
                        </button>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <PlansStrip plans={state.plans} kind="business" locale={locale} />
        </section>
      ) : null}

      {state.history.length ? (
        <section className="account-card">
          <h2>{ar ? 'سجل طلبات التوثيق' : 'Verification history'}</h2>
          <ul className="account-history">
            {state.history.map((record) => (
              <li key={record.id}>
                <span dir="ltr" className="award-row__serial">
                  {record.serial}
                </span>
                <span>
                  {ar ? KIND_LABELS[record.kind].ar : KIND_LABELS[record.kind].en}
                  {record.organizationName ? ` · ${record.organizationName}` : ''}
                </span>
                <span className={`badge-pill badge-pill--v-${record.status}`}>
                  {ar ? STATUS_LABELS[record.status].ar : STATUS_LABELS[record.status].en}
                </span>
                <span className="muted">
                  {dateText(record.createdAt, ar)}
                  {record.verifiedUntil ? ` → ${dateText(record.verifiedUntil, ar)}` : ''}
                </span>
                {record.reviewNote && record.status === 'rejected' ? (
                  <span className="account-history__note">{record.reviewNote}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function ImagePicker({
  ar,
  busy,
  hasImage,
  business = false,
  onPick,
  onRemove,
}: {
  ar: boolean;
  busy: boolean;
  hasImage: boolean;
  business?: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="image-picker">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      <button
        type="button"
        className="button button--ghost button--small"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy
          ? ar
            ? 'جارٍ الرفع…'
            : 'Uploading…'
          : hasImage
            ? ar
              ? business
                ? 'تغيير الشعار'
                : 'تغيير الصورة'
              : 'Change'
            : ar
              ? business
                ? 'إضافة شعار'
                : 'إضافة صورة رمزية'
              : business
                ? 'Add logo'
                : 'Add picture'}
      </button>
      {hasImage ? (
        <button type="button" className="link-button" disabled={busy} onClick={onRemove}>
          {ar ? 'إزالة' : 'Remove'}
        </button>
      ) : null}
    </div>
  );
}

function PlansStrip({
  plans,
  kind,
  locale,
}: {
  plans: VerificationPlan[];
  kind: VerificationKind;
  locale: Locale;
}) {
  const ar = locale === 'ar';
  return (
    <ul className="plans-strip">
      {VERIFICATION_PERIODS.map((period) => (
        <li key={period}>
          <span>{ar ? PERIOD_LABELS[period].ar : PERIOD_LABELS[period].en}</span>
          <strong>{priceText(planFor(plans, kind, period), locale)}</strong>
        </li>
      ))}
    </ul>
  );
}

function RecordCard({
  record,
  locale,
  busy,
  onAct,
}: {
  record: VerificationRecord;
  locale: Locale;
  busy: boolean;
  onAct: (record: VerificationRecord, body: Record<string, string>) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const fee =
    record.feeMinor === '0'
      ? ar
        ? 'مجاناً'
        : 'Free'
      : formatMoney(record.feeMinor, record.currency, locale);
  return (
    <div className="verification-record">
      <p>
        <strong>{ar ? 'طلب قيد المراجعة' : 'Request under review'}</strong>{' '}
        <span dir="ltr" className="award-row__serial">
          {record.serial}
        </span>
      </p>
      <dl>
        <div>
          <dt>{ar ? 'المستند' : 'Document'}</dt>
          <dd>
            {ar ? DOCUMENT_LABELS[record.documentType].ar : DOCUMENT_LABELS[record.documentType].en}
            {record.documentLast4 ? ` ••${record.documentLast4}` : ''}
          </dd>
        </div>
        <div>
          <dt>{ar ? 'المدة' : 'Period'}</dt>
          <dd>{ar ? PERIOD_LABELS[record.period].ar : PERIOD_LABELS[record.period].en}</dd>
        </div>
        <div>
          <dt>{ar ? 'الرسوم' : 'Fee'}</dt>
          <dd>{fee}</dd>
        </div>
        <div>
          <dt>{ar ? 'الدفع' : 'Payment'}</dt>
          <dd className={`badge-pill badge-pill--pay-${record.paymentStatus}`}>
            {ar ? PAYMENT_LABELS[record.paymentStatus].ar : PAYMENT_LABELS[record.paymentStatus].en}
          </dd>
        </div>
        <div>
          <dt>{ar ? 'مطابقة الاسم' : 'Name match'}</dt>
          <dd>{record.nameMatchScore}%</dd>
        </div>
      </dl>
      {record.paymentStatus === 'unpaid' ? (
        <p className="muted">
          {ar
            ? `سيتواصل معك فريق بن حمود لتحصيل الرسوم. اذكر الرقم المرجعي ${record.serial} عند التحويل.`
            : `The BHD team will contact you to collect the fee. Quote ${record.serial} when paying.`}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--ghost button--small"
        disabled={busy}
        onClick={() => void onAct(record, { action: 'cancel' })}
      >
        {ar ? 'سحب الطلب' : 'Withdraw'}
      </button>
    </div>
  );
}

function RenewButtons({
  record,
  plans,
  locale,
  busy,
  onAct,
}: {
  record: VerificationRecord;
  plans: VerificationPlan[];
  locale: Locale;
  busy: boolean;
  onAct: (record: VerificationRecord, body: Record<string, string>) => Promise<void>;
}) {
  const ar = locale === 'ar';
  return (
    <>
      {VERIFICATION_PERIODS.map((period) => {
        const plan = planFor(plans, record.kind, period);
        if (!plan) return null;
        return (
          <button
            key={period}
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void onAct(record, { action: 'renew', period })}
          >
            {ar
              ? `تجديد ${PERIOD_LABELS[period].ar} (${priceText(plan, locale)})`
              : `Renew ${PERIOD_LABELS[period].en} (${priceText(plan, locale)})`}
          </button>
        );
      })}
    </>
  );
}

function VerificationForm({
  locale,
  kind,
  organizationId,
  accountName,
  plans,
  onCancel,
  onDone,
}: {
  locale: Locale;
  kind: VerificationKind;
  organizationId: string | null;
  accountName: string;
  plans: VerificationPlan[];
  onCancel: () => void;
  onDone: (serial: string) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const documentTypes: readonly VerificationDocumentType[] =
    kind === 'personal' ? PERSONAL_DOCUMENTS : BUSINESS_DOCUMENTS;
  const available = VERIFICATION_PERIODS.filter((period) => planFor(plans, kind, period));
  const [period, setPeriod] = useState<VerificationPeriod>(
    available.includes('yearly') ? 'yearly' : (available[0] ?? 'yearly'),
  );
  const [legalNameAr, setLegalNameAr] = useState('');
  const [legalNameEn, setLegalNameEn] = useState('');
  const [documentType, setDocumentType] = useState<VerificationDocumentType>(documentTypes[0]!);
  const [last4, setLast4] = useState('');
  const [expires, setExpires] = useState('');
  const [files, setFiles] = useState<Partial<Record<DocumentSlot, string>>>({});
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const slots = REQUIRED_SLOTS[documentType];
  const score = useMemo(
    () => bestNameMatch([legalNameAr, legalNameEn], [accountName]),
    [accountName, legalNameAr, legalNameEn],
  );
  const typed = legalNameAr.trim() || legalNameEn.trim();
  const ready =
    !!typed &&
    (kind === 'business' || score >= NAME_MATCH_THRESHOLD) &&
    slots.every((slot) => files[slot]) &&
    consent &&
    available.length > 0;

  const pick = async (slot: DocumentSlot, file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await shrinkImage(file, 1600, 0.82, slot === 'registration');
      setFiles((current) => ({ ...current, [slot]: dataUrl }));
    } catch (caught) {
      setError(errorText(caught, ar));
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const documents = Object.fromEntries(slots.map((slot) => [slot, files[slot]]));
      const result = await browserNextMutation<{ id: string; serial: string }>(
        '/api/account/verification',
        {
          method: 'POST',
          body: JSON.stringify({
            kind,
            organizationId,
            period,
            legalNameAr: legalNameAr.trim() || null,
            legalNameEn: legalNameEn.trim() || null,
            documentType,
            documentLast4: last4.trim() || null,
            documentExpiresOn: expires || null,
            documents,
          }),
        },
      );
      await onDone(result.serial);
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="verification-form">
      <h3>{ar ? KIND_LABELS[kind].ar : KIND_LABELS[kind].en}</h3>
      <fieldset className="verification-form__periods">
        <legend>{ar ? 'مدة التوثيق' : 'Period'}</legend>
        {available.length === 0 ? (
          <p className="muted">
            {ar ? 'التوثيق غير متاح حالياً.' : 'Verification is not available now.'}
          </p>
        ) : (
          available.map((option) => (
            <label key={option} className={period === option ? 'is-active' : undefined}>
              <input
                type="radio"
                name="period"
                checked={period === option}
                onChange={() => setPeriod(option)}
              />
              <span>{ar ? PERIOD_LABELS[option].ar : PERIOD_LABELS[option].en}</span>
              <strong>{priceText(planFor(plans, kind, option), locale)}</strong>
            </label>
          ))
        )}
      </fieldset>
      <div className="badges-editor__grid">
        <label>
          <span>
            {ar
              ? kind === 'personal'
                ? 'الاسم بالعربية كما في المستند'
                : 'اسم المنشأة بالعربية كما في السجل'
              : 'Arabic name as on the document'}
          </span>
          <input
            value={legalNameAr}
            maxLength={200}
            onChange={(event) => setLegalNameAr(event.target.value)}
          />
        </label>
        <label>
          <span>{ar ? 'الاسم بالإنجليزية كما في المستند' : 'English name as on the document'}</span>
          <input
            dir="ltr"
            value={legalNameEn}
            maxLength={200}
            onChange={(event) => setLegalNameEn(event.target.value)}
          />
        </label>
        <label>
          <span>{ar ? 'نوع المستند' : 'Document type'}</span>
          <select
            value={documentType}
            onChange={(event) => {
              setDocumentType(event.target.value as VerificationDocumentType);
              setFiles({});
            }}
          >
            {documentTypes.map((type) => (
              <option key={type} value={type}>
                {ar ? DOCUMENT_LABELS[type].ar : DOCUMENT_LABELS[type].en}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{ar ? 'آخر 4 أرقام من رقم المستند' : 'Last 4 digits of the number'}</span>
          <input
            dir="ltr"
            inputMode="numeric"
            maxLength={4}
            value={last4}
            onChange={(event) =>
              setLast4(event.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 4))
            }
          />
        </label>
        <label>
          <span>{ar ? 'تاريخ انتهاء المستند' : 'Document expiry'}</span>
          <input type="date" value={expires} onChange={(event) => setExpires(event.target.value)} />
        </label>
      </div>
      {typed && kind === 'personal' ? (
        <p
          className={`name-match${score >= NAME_MATCH_THRESHOLD ? ' is-ok' : ' is-bad'}`}
          role="status"
        >
          {ar
            ? `مطابقة الاسم مع اسم الحساب «${accountName}»: ${score}%`
            : `Match with “${accountName}”: ${score}%`}
          {score < NAME_MATCH_THRESHOLD
            ? ar
              ? ` — يجب ألا تقل عن ${NAME_MATCH_THRESHOLD}%. اكتب الاسم كما في المستند تماماً، أو عدّل اسم حسابك ليطابقه.`
              : ` — needs ${NAME_MATCH_THRESHOLD}%.`
            : ''}
        </p>
      ) : null}
      <div className="verification-form__slots">
        {slots.map((slot) => (
          <label key={slot} className={`doc-slot${files[slot] ? ' is-filled' : ''}`}>
            <input
              type="file"
              accept={
                slot === 'registration'
                  ? 'image/jpeg,image/png,image/webp,application/pdf'
                  : 'image/jpeg,image/png,image/webp'
              }
              capture={slot === 'selfie' ? 'user' : undefined}
              hidden
              onChange={(event) => {
                void pick(slot, event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {files[slot]?.startsWith('data:image/') ? (
              <img src={files[slot]} alt="" />
            ) : (
              <span className="doc-slot__icon" aria-hidden="true">
                {files[slot] ? 'PDF' : '+'}
              </span>
            )}
            <span>{ar ? SLOT_LABELS[slot].ar : SLOT_LABELS[slot].en}</span>
          </label>
        ))}
      </div>
      <label className="badges-editor__check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>
          {ar
            ? 'أقرّ بأن المستندات صحيحة وتخصّني، وأوافق على اطلاع فريق التوثيق عليها لغرض التحقق فقط.'
            : 'I confirm these documents are genuine and mine, and consent to their review for verification only.'}
        </span>
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="badges-grant__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!ready || saving}
          onClick={() => void submit()}
        >
          {saving
            ? ar
              ? 'جارٍ الإرسال…'
              : 'Sending…'
            : ar
              ? 'إرسال طلب التوثيق'
              : 'Submit request'}
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
