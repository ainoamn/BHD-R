'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PENDING_APPROVALS_CHANGED_EVENT } from '@/lib/pending-approvals-shared';
import {
  CLAIM_MESSAGE_MAX,
  CLAIM_NOTE_MIN,
  SITE_ADMIN_LIMIT,
  claimKindLabel,
  claimStatusLabel,
  claimStatusTone,
  validAdminEmail,
  whatsappDigits,
  type ComplaintChannel,
  type DepositClaimView,
  type SiteAdminSettings,
} from '@/lib/stay-deposit-claims';

type Complaint = DepositClaimView & {
  reference: string;
  propertyName: string;
  propertyNameEn: string | null;
  organizationName: string;
  guestName: string | null;
  guestEmail: string | null;
  depositMinor: string | null;
  refundStatus: string | null;
  refundAmountMinor: string | null;
  paidMinor: string | null;
  decisionNote: string | null;
  guestPageUrl: string;
};

type Notice = { tone: 'success' | 'error'; text: string };

function stamp(value: string, ar: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

function refundStatusText(status: string | null, ar: boolean): string {
  switch (status) {
    case 'requested':
      return ar ? 'طلب الضيف الاسترداد' : 'Requested';
    case 'approved':
      return ar ? 'معتمد بانتظار التحويل' : 'Approved, awaiting transfer';
    case 'executed':
      return ar ? 'حُوّل للضيف' : 'Transferred';
    case 'rejected':
      return ar ? 'رفض المالك الاسترداد' : 'Rejected by the host';
    default:
      return ar ? 'لا يوجد طلب استرداد' : 'No refund request';
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; messageAr?: string } }) | null;
  if (!response.ok || !payload) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'request_failed',
      payload?.error?.messageAr ?? 'تعذّر التحميل.',
    );
  }
  return payload;
}

/** Guests' deposit complaints escalated to the site administration, and the complaint inbox. */
export function SiteAdminPanel({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [settings, setSettings] = useState<SiteAdminSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [list, current] = await Promise.all([
          getJson<{ complaints: Complaint[] }>('/api/site-admin/complaints'),
          getJson<{ settings: SiteAdminSettings }>('/api/site-admin/settings'),
        ]);
        if (!live) return;
        setComplaints(list.complaints);
        setSettings(current.settings);
        setFailed(false);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const waiting = complaints?.filter((item) => item.status === 'escalated') ?? [];
  const decided = complaints?.filter((item) => item.status !== 'escalated') ?? [];

  return (
    <main className="site-admin">
      <header className="site-admin__head">
        <div>
          <p className="site-admin__kicker">{ar ? 'إدارة الموقع' : 'Site administration'}</p>
          <h1>{ar ? 'شكاوى التأمين' : 'Deposit complaints'}</h1>
          <p className="muted">
            {ar
              ? 'شكاوى الضيوف على قرارات الملاك في مبالغ التأمين، بعد أن لم يصلوا لحل مرضٍ مع المالك. قرارك نهائي ويُبلَّغ به الضيف.'
              : 'Guest complaints about hosts’ deposit decisions, after no satisfying answer from the host. Your decision is final and the guest is told.'}
          </p>
        </div>
        <Link className="button button--quiet" href="/" prefetch={false}>
          {ar ? 'الرئيسية' : 'Home'}
        </Link>
      </header>

      {notice ? (
        <p
          className={`notice notice--${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}

      {failed ? (
        <p className="notice notice--error" role="alert">
          {ar ? 'تعذّر تحميل الشكاوى.' : 'Could not load the complaints.'}{' '}
          <button type="button" className="button button--quiet" onClick={reload}>
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </p>
      ) : complaints === null ? (
        <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : (
        <>
          <section className="site-admin__section" aria-labelledby="site-admin-waiting">
            <h2 id="site-admin-waiting">
              {ar
                ? `بانتظار قرارك (${waiting.length})`
                : `Awaiting your decision (${waiting.length})`}
            </h2>
            {waiting.length ? (
              <ul className="site-admin__list">
                {waiting.map((item) => (
                  <ComplaintCard
                    key={item.id}
                    item={item}
                    locale={locale}
                    onNotice={setNotice}
                    onDone={() => {
                      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
                      reload();
                    }}
                  />
                ))}
              </ul>
            ) : (
              <p className="muted">{ar ? 'لا توجد شكاوى مفتوحة.' : 'No open complaints.'}</p>
            )}
          </section>
          {decided.length ? (
            <section className="site-admin__section" aria-labelledby="site-admin-decided">
              <h2 id="site-admin-decided">{ar ? 'شكاوى بُتّ فيها' : 'Decided complaints'}</h2>
              <ul className="site-admin__list">
                {decided.map((item) => (
                  <ComplaintCard
                    key={item.id}
                    item={item}
                    locale={locale}
                    onNotice={setNotice}
                    onDone={reload}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {settings ? (
        <InboxSettings
          initial={settings}
          locale={locale}
          onNotice={setNotice}
          onSaved={setSettings}
        />
      ) : null}
    </main>
  );
}

function ComplaintCard({
  item,
  locale,
  onNotice,
  onDone,
}: {
  item: Complaint;
  locale: 'ar' | 'en';
  onNotice: (notice: Notice) => void;
  onDone: () => void;
}) {
  const ar = locale === 'ar';
  const money = (minor: string | null) => (minor ? formatMoney(minor, item.currency, locale) : '—');
  const [outcome, setOutcome] = useState<'guest' | 'host' | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const noteMissing = note.trim().length < CLAIM_NOTE_MIN;

  async function submit() {
    setTried(true);
    if (!outcome || noteMissing) return;
    setBusy(true);
    try {
      await browserNextMutation(`/api/site-admin/complaints/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        body: JSON.stringify({
          outcome,
          note: note.trim(),
          ...(outcome === 'guest' && item.kind !== 'not_received' && amount.trim()
            ? { amount: amount.trim() }
            : {}),
        }),
      });
      onNotice({
        tone: 'success',
        text: ar
          ? `سُجّل قرارك في شكوى ${item.reference} وأُبلغ الضيف.`
          : `Decision recorded for ${item.reference}; the guest was told.`,
      });
      onDone();
    } catch (error) {
      onNotice({
        tone: 'error',
        text:
          error instanceof ApiError && error.message
            ? error.message
            : ar
              ? 'تعذّر حفظ القرار.'
              : 'Could not save the decision.',
      });
      if (error instanceof ApiError && error.code === 'complaint_not_open') onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="site-admin__card">
      <div className="site-admin__card-head">
        <strong>
          <bdi dir="ltr">{item.reference}</bdi> ·{' '}
          <bdi>{ar ? item.propertyName : item.propertyNameEn || item.propertyName}</bdi>
        </strong>
        <span className={`pmh-badge pmh-badge--${claimStatusTone(item.status)}`}>
          {claimStatusLabel(item.status, ar)}
        </span>
      </div>
      <dl className="site-admin__facts">
        <div>
          <dt>{ar ? 'المالك / الإدارة' : 'Host'}</dt>
          <dd>{item.organizationName}</dd>
        </div>
        <div>
          <dt>{ar ? 'الضيف' : 'Guest'}</dt>
          <dd>
            {item.guestName ?? '—'}
            {item.guestEmail ? (
              <>
                {' · '}
                <bdi dir="ltr">{item.guestEmail}</bdi>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{ar ? 'مبلغ التأمين' : 'Deposit'}</dt>
          <dd dir="ltr">{money(item.depositMinor)}</dd>
        </div>
        <div>
          <dt>{ar ? 'قرار المالك' : 'Host decision'}</dt>
          <dd>
            {refundStatusText(item.refundStatus, ar)}
            {item.refundAmountMinor && item.refundStatus !== 'rejected' ? (
              <>
                {' · '}
                {ar ? 'مُعتمد ' : 'approved '}
                <bdi dir="ltr">{money(item.refundAmountMinor)}</bdi>
              </>
            ) : null}
            {item.paidMinor && item.paidMinor !== '0' ? (
              <>
                {' · '}
                {ar ? 'محوَّل ' : 'paid '}
                <bdi dir="ltr">{money(item.paidMinor)}</bdi>
              </>
            ) : null}
          </dd>
        </div>
        {item.decisionNote ? (
          <div className="site-admin__wide">
            <dt>{ar ? 'ملاحظة المالك عند القرار' : 'Host note'}</dt>
            <dd>{item.decisionNote}</dd>
          </div>
        ) : null}
        <div className="site-admin__wide">
          <dt>
            {ar ? 'طلب الضيف للمالك' : 'Guest request to the host'} ·{' '}
            {claimKindLabel(item.kind, ar)}
            {item.amountMinor ? ` · ${money(item.amountMinor)}` : ''}
          </dt>
          <dd>{item.message}</dd>
        </div>
        <div className="site-admin__wide">
          <dt>{ar ? 'رد المالك' : 'Host answer'}</dt>
          <dd>
            {item.response
              ? `${item.response.decision === 'accepted' ? (ar ? 'قبول' : 'Accepted') : ar ? 'رفض' : 'Declined'}${
                  item.response.amountMinor ? ` (${money(item.response.amountMinor)})` : ''
                }${item.response.note ? ` — ${item.response.note}` : ''}`
              : ar
                ? 'لم يرد المالك.'
                : 'No answer from the host.'}
          </dd>
        </div>
        {item.escalation ? (
          <div className="site-admin__wide">
            <dt>
              {ar ? 'الشكوى' : 'Complaint'} · {stamp(item.escalation.at, ar)}
            </dt>
            <dd>{item.escalation.message}</dd>
          </div>
        ) : null}
        {item.resolution ? (
          <div className="site-admin__wide">
            <dt>
              {ar ? 'القرار' : 'Decision'} · {stamp(item.resolution.at, ar)}
              {item.resolution.by ? ` · ${item.resolution.by}` : ''}
            </dt>
            <dd>
              {item.resolution.outcome === 'guest'
                ? ar
                  ? 'لصالح الضيف'
                  : 'For the guest'
                : ar
                  ? 'لصالح المالك'
                  : 'For the host'}
              {item.resolution.amountMinor ? ` · ${money(item.resolution.amountMinor)}` : ''}
              {item.resolution.note ? ` — ${item.resolution.note}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>
      <a className="site-admin__link" href={item.guestPageUrl} target="_blank" rel="noreferrer">
        {ar ? 'صفحة إقامة الضيف ↗' : 'Guest stay page ↗'}
      </a>

      {item.status === 'escalated' ? (
        <form
          className="site-admin__form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="site-admin__outcome">
            <legend>{ar ? 'القرار' : 'Decision'}</legend>
            <label>
              <input
                type="radio"
                name={`outcome-${item.id}`}
                checked={outcome === 'guest'}
                onChange={() => setOutcome('guest')}
              />{' '}
              {ar ? 'لصالح الضيف' : 'For the guest'}
            </label>
            <label>
              <input
                type="radio"
                name={`outcome-${item.id}`}
                checked={outcome === 'host'}
                onChange={() => setOutcome('host')}
              />{' '}
              {ar ? 'لصالح المالك' : 'For the host'}
            </label>
          </fieldset>
          {outcome === 'guest' && item.kind === 'not_received' ? (
            <small className="muted">
              {ar
                ? 'يُلغى التحويل الأخير ويعود للمحاسب ليحوّل المبلغ للضيف من جديد.'
                : 'The last transfer is voided and goes back to the accountant to send again.'}
            </small>
          ) : null}
          {outcome === 'guest' && item.kind !== 'not_received' ? (
            <label className="field">
              <span>
                {ar
                  ? 'المبلغ الذي يُعاد للضيف من التأمين (اختياري)'
                  : 'Amount returned to the guest (optional)'}
              </span>
              <input
                inputMode="decimal"
                dir="ltr"
                value={amount}
                placeholder="0.000"
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          ) : null}
          <label className="field">
            <span>{ar ? 'نص القرار (يصل للضيف)' : 'Decision text (sent to the guest)'}</span>
            <textarea
              rows={3}
              maxLength={CLAIM_MESSAGE_MAX}
              value={note}
              aria-invalid={tried && noteMissing}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {tried && (!outcome || noteMissing) ? (
            <small className="field-error" role="alert">
              {ar ? 'اختر القرار واكتب نصه.' : 'Choose the decision and write it.'}
            </small>
          ) : null}
          <button type="submit" className="button button--primary" disabled={busy}>
            {ar ? 'اعتماد القرار' : 'Record the decision'}
          </button>
        </form>
      ) : null}
    </li>
  );
}

function InboxSettings({
  initial,
  locale,
  onNotice,
  onSaved,
}: {
  initial: SiteAdminSettings;
  locale: 'ar' | 'en';
  onNotice: (notice: Notice) => void;
  onSaved: (settings: SiteAdminSettings) => void;
}) {
  const ar = locale === 'ar';
  const [channel, setChannel] = useState<ComplaintChannel>(initial.channel);
  const [emails, setEmails] = useState<string[]>(initial.emails);
  const [numbers, setNumbers] = useState<string[]>(initial.whatsapp);
  const [newEmail, setNewEmail] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addEmail() {
    const value = newEmail.trim().toLowerCase();
    if (!validAdminEmail(value)) {
      setError(ar ? 'البريد غير صحيح.' : 'Invalid email.');
      return;
    }
    if (emails.length >= SITE_ADMIN_LIMIT) return;
    setError(null);
    setEmails((list) => (list.includes(value) ? list : [...list, value]));
    setNewEmail('');
  }

  function addNumber() {
    const value = newNumber.trim();
    if (!whatsappDigits(value)) {
      setError(ar ? 'رقم واتساب غير صحيح.' : 'Invalid WhatsApp number.');
      return;
    }
    if (numbers.length >= SITE_ADMIN_LIMIT) return;
    setError(null);
    setNumbers((list) => (list.includes(value) ? list : [...list, value]));
    setNewNumber('');
  }

  async function save() {
    if (!emails.length) {
      setError(ar ? 'أبقِ بريداً واحداً على الأقل لدخول هذه الصفحة.' : 'Keep at least one email.');
      return;
    }
    if (channel === 'whatsapp' && !numbers.length) {
      setError(ar ? 'أضف رقم واتساب واحداً على الأقل.' : 'Add at least one WhatsApp number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await browserNextMutation<{ settings: SiteAdminSettings }>(
        '/api/site-admin/settings',
        { method: 'PUT', body: JSON.stringify({ channel, emails, whatsapp: numbers }) },
      );
      onSaved(result.settings);
      onNotice({
        tone: 'success',
        text: ar ? 'حُفظت إعدادات استقبال الشكاوى.' : 'Complaint inbox settings saved.',
      });
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.message
          ? caught.message
          : ar
            ? 'تعذّر الحفظ.'
            : 'Could not save.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="site-admin__section site-admin__settings"
      aria-labelledby="site-admin-inbox"
    >
      <h2 id="site-admin-inbox">{ar ? 'استقبال الشكاوى' : 'Complaint inbox'}</h2>
      <p className="muted">
        {ar
          ? 'أصحاب هذه العناوين يدخلون هذه الصفحة ويبتّون في الشكاوى. اختر كيف يصلكم إشعار الشكوى الجديدة.'
          : 'These emails can open this page and decide complaints. Choose how a new complaint reaches you.'}
      </p>
      <fieldset className="site-admin__outcome">
        <legend>{ar ? 'طريقة الإشعار' : 'Notify by'}</legend>
        <label>
          <input
            type="radio"
            name="complaint-channel"
            checked={channel === 'email'}
            onChange={() => setChannel('email')}
          />{' '}
          {ar ? 'البريد الإلكتروني' : 'Email'}
        </label>
        <label>
          <input
            type="radio"
            name="complaint-channel"
            checked={channel === 'whatsapp'}
            onChange={() => setChannel('whatsapp')}
          />{' '}
          {ar ? 'واتساب' : 'WhatsApp'}
        </label>
      </fieldset>
      {channel === 'whatsapp' ? (
        <small className="muted">
          {ar
            ? 'مع واتساب، يظهر للضيف عند رفع الشكوى زر يرسلها مباشرة إلى أرقامكم.'
            : 'With WhatsApp, the guest gets a button that sends the complaint straight to your numbers.'}
        </small>
      ) : null}

      <div className="site-admin__group">
        <strong>{ar ? 'البريد الإلكتروني' : 'Emails'}</strong>
        <ul className="site-admin__chips">
          {emails.map((email) => (
            <li key={email}>
              <bdi dir="ltr">{email}</bdi>
              <button
                type="button"
                aria-label={ar ? `حذف ${email}` : `Remove ${email}`}
                onClick={() => setEmails((list) => list.filter((item) => item !== email))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="site-admin__add">
          <input
            type="email"
            dir="ltr"
            value={newEmail}
            placeholder="name@example.com"
            onChange={(event) => setNewEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addEmail();
              }
            }}
          />
          <button type="button" className="button button--quiet" onClick={addEmail}>
            {ar ? 'إضافة بريد' : 'Add email'}
          </button>
        </div>
      </div>

      <div className="site-admin__group">
        <strong>{ar ? 'أرقام واتساب' : 'WhatsApp numbers'}</strong>
        <ul className="site-admin__chips">
          {numbers.map((number) => (
            <li key={number}>
              <bdi dir="ltr">{number}</bdi>
              <button
                type="button"
                aria-label={ar ? `حذف ${number}` : `Remove ${number}`}
                onClick={() => setNumbers((list) => list.filter((item) => item !== number))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="site-admin__add">
          <input
            type="tel"
            dir="ltr"
            value={newNumber}
            placeholder="+968 9xxx xxxx"
            onChange={(event) => setNewNumber(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addNumber();
              }
            }}
          />
          <button type="button" className="button button--quiet" onClick={addNumber}>
            {ar ? 'إضافة رقم' : 'Add number'}
          </button>
        </div>
      </div>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--primary"
        disabled={busy}
        onClick={() => void save()}
      >
        {ar ? 'حفظ الإعدادات' : 'Save settings'}
      </button>
    </section>
  );
}
