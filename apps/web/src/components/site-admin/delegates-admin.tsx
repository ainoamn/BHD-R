'use client';

import { useEffect, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import {
  ADMIN_SCOPES,
  DELEGATE_LIMIT,
  SCOPE_LABELS,
  type AdminDelegate,
  type AdminScope,
  type SiteAdminAccess,
} from '@/lib/site-admin-shared';
import { validAdminEmail } from '@/lib/stay-deposit-claims';
import { adminDate, adminErrorText, adminGet, type AdminNotice } from './admin-fetch';
import {
  SiteAdminBanner,
  SiteAdminFailed,
  SiteAdminLoading,
  SiteAdminPage,
  SiteAdminSurface,
} from './site-admin-page';

type View = { access: SiteAdminAccess; rootEmails: string[]; delegates: AdminDelegate[] };
type Draft = {
  email: string;
  scopes: AdminScope[];
  note: string;
  grantedBy?: string | null;
  grantedAt?: string;
};

const toDraft = (item: AdminDelegate): Draft => ({
  email: item.email,
  scopes: item.scopes,
  note: item.note ?? '',
  grantedBy: item.grantedBy,
  grantedAt: item.grantedAt,
});

/** Grants parts of site administration to other accounts by email, scope by scope. */
export function DelegatesAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [view, setView] = useState<View | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [scopes, setScopes] = useState<AdminScope[]>(['complaints']);
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    adminGet<View>('/api/site-admin/delegates')
      .then((data) => {
        if (!live) return;
        setView(data);
        setDrafts(data.delegates.map(toDraft));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const title = ar ? 'التفويض' : 'Delegation';
  const lead = ar
    ? 'بدلاً من حساب إدارة منفصل: فوّض أي حساب BHD ببريده، واختر ما يديره فقط. يدخل المفوَّض بحسابه المعتاد ويجد «إدارة الموقع» في قائمة حسابه.'
    : 'No separate admin login: delegate any BHD account by email and pick exactly what it runs. Delegates sign in as usual and find “Site admin” in their account menu.';

  if (failed) {
    return (
      <SiteAdminPage locale={locale} title={title} lead={lead}>
        <SiteAdminFailed
          locale={locale}
          messageAr="تعذّر تحميل المفوضين."
          messageEn="Could not load delegates."
        />
      </SiteAdminPage>
    );
  }
  if (!view) {
    return (
      <SiteAdminPage locale={locale} title={title} lead={lead}>
        <SiteAdminLoading locale={locale} />
      </SiteAdminPage>
    );
  }
  const root = view.access.root;
  const locked = (draft: Draft) => !root && draft.scopes.includes('delegates');

  function toggle(list: AdminScope[], scope: AdminScope): AdminScope[] {
    return list.includes(scope) ? list.filter((item) => item !== scope) : [...list, scope];
  }

  function add() {
    const value = email.trim().toLowerCase();
    if (!validAdminEmail(value)) {
      setNotice({ tone: 'error', text: ar ? 'البريد غير صحيح.' : 'Invalid email.' });
      return;
    }
    if (view!.rootEmails.includes(value) || drafts.some((item) => item.email === value)) {
      setNotice({ tone: 'error', text: ar ? 'هذا البريد مضاف من قبل.' : 'Already listed.' });
      return;
    }
    if (!scopes.length) {
      setNotice({
        tone: 'error',
        text: ar ? 'اختر صلاحية واحدة على الأقل.' : 'Pick at least one permission.',
      });
      return;
    }
    setDrafts((list) => [...list, { email: value, scopes, note: note.trim() }]);
    setEmail('');
    setNote('');
    setScopes(['complaints']);
    setNotice(null);
  }

  async function save() {
    setBusy(true);
    try {
      const data = await browserNextMutation<View>('/api/site-admin/delegates', {
        method: 'PUT',
        body: JSON.stringify({
          delegates: drafts.map((item) => ({
            email: item.email,
            scopes: item.scopes,
            note: item.note.trim() || null,
          })),
        }),
      });
      setView(data);
      setDrafts(data.delegates.map(toDraft));
      setNotice({ tone: 'success', text: ar ? 'حُفظ التفويض.' : 'Delegation saved.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الحفظ.', 'Could not save.'),
      });
    } finally {
      setBusy(false);
    }
  }

  const scopeBoxes = (
    selected: AdminScope[],
    onChange: (next: AdminScope[]) => void,
    disabled: boolean,
    key: string,
  ) => (
    <div className="sa-scopes">
      {ADMIN_SCOPES.map((scope) => (
        <label key={scope} title={ar ? SCOPE_LABELS[scope].hintAr : SCOPE_LABELS[scope].hintEn}>
          <input
            type="checkbox"
            name={`${key}-${scope}`}
            checked={selected.includes(scope)}
            disabled={disabled || (scope === 'delegates' && !root)}
            onChange={() => onChange(toggle(selected, scope))}
          />{' '}
          {ar ? SCOPE_LABELS[scope].ar : SCOPE_LABELS[scope].en}
        </label>
      ))}
    </div>
  );

  return (
    <SiteAdminPage
      locale={locale}
      title={title}
      lead={lead}
      actions={
        root ? (
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ التفويض' : 'Save delegation'}
          </button>
        ) : undefined
      }
    >
      <SiteAdminBanner notice={notice} />

      <SiteAdminSurface
        title={ar ? 'الإدارة العليا' : 'Top-level admins'}
        hint={
          ar
            ? 'كل الصلاحيات، وتُدار من «شكاوى التأمين ← استقبال الشكاوى».'
            : 'Every permission; managed under “Deposit complaints → Complaint inbox”.'
        }
      >
        <ul className="site-admin__chips">
          {view.rootEmails.map((item) => (
            <li key={item}>
              <bdi dir="ltr">{item}</bdi>
            </li>
          ))}
        </ul>
      </SiteAdminSurface>

      <SiteAdminSurface title={ar ? `المفوَّضون (${drafts.length})` : `Delegates (${drafts.length})`}>
        {drafts.length ? (
          <ul className="site-admin__list">
            {drafts.map((draft, index) => (
              <li key={draft.email} className="site-admin__card">
                <div className="site-admin__card-head">
                  <strong>
                    <bdi dir="ltr">{draft.email}</bdi>
                  </strong>
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    disabled={locked(draft)}
                    onClick={() => setDrafts((list) => list.filter((_, at) => at !== index))}
                  >
                    {ar ? 'إلغاء التفويض' : 'Revoke'}
                  </button>
                </div>
                {scopeBoxes(
                  draft.scopes,
                  (next) =>
                    setDrafts((list) =>
                      list.map((item, at) => (at === index ? { ...item, scopes: next } : item)),
                    ),
                  locked(draft),
                  draft.email,
                )}
                <input
                  className="sa-input"
                  value={draft.note}
                  maxLength={120}
                  placeholder={ar ? 'ملاحظة (اختياري)' : 'Note (optional)'}
                  onChange={(event) =>
                    setDrafts((list) =>
                      list.map((item, at) =>
                        at === index ? { ...item, note: event.target.value } : item,
                      ),
                    )
                  }
                />
                {draft.grantedAt ? (
                  <small className="muted">
                    {ar ? 'فُوِّض في ' : 'Granted '}
                    {adminDate(draft.grantedAt, ar)}
                    {draft.grantedBy ? (
                      <>
                        {ar ? ' بواسطة ' : ' by '}
                        <bdi dir="ltr">{draft.grantedBy}</bdi>
                      </>
                    ) : null}
                  </small>
                ) : (
                  <small className="muted">
                    {ar ? 'جديد — احفظ لتفعيله.' : 'New — save to apply.'}
                  </small>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {ar ? 'لا يوجد مفوَّضون بعد.' : 'No delegates yet.'}
          </p>
        )}
      </SiteAdminSurface>

      {drafts.length < DELEGATE_LIMIT ? (
        <SiteAdminSurface title={ar ? 'إضافة مفوَّض' : 'Add a delegate'}>
          <input
            className="sa-input"
            type="email"
            dir="ltr"
            value={email}
            placeholder="name@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          {scopeBoxes(scopes, setScopes, false, 'new')}
          <input
            className="sa-input"
            value={note}
            maxLength={120}
            placeholder={ar ? 'ملاحظة (اختياري)' : 'Note (optional)'}
            onChange={(event) => setNote(event.target.value)}
          />
          <button type="button" className="button button--quiet" onClick={add}>
            {ar ? 'إضافة إلى القائمة' : 'Add to the list'}
          </button>
        </SiteAdminSurface>
      ) : null}
    </SiteAdminPage>
  );
}
