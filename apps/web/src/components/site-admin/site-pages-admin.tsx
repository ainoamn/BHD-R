'use client';

import { useEffect, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import {
  SITE_PAGE_IDS,
  SITE_PAGE_META,
  type SitePageId,
  type SitePagesView,
} from '@/lib/site-control-shared';
import { adminErrorText, adminGet, type AdminNotice } from './admin-fetch';
import {
  SiteAdminBanner,
  SiteAdminFailed,
  SiteAdminLoading,
  SiteAdminPage,
  SiteAdminSurface,
} from './site-admin-page';

/** Toggle public marketing / catalogue pages on or off. */
export function SitePagesAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [pages, setPages] = useState<Record<SitePageId, boolean> | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const title = ar ? 'صفحات الموقع' : 'Site pages';
  const lead = ar
    ? 'عطّل صفحة عامة مؤقتاً دون حذفها. تسجيل الدخول يبقى متاحاً دائماً.'
    : 'Temporarily disable a public page without deleting it. Login stays always available.';

  useEffect(() => {
    let live = true;
    adminGet<SitePagesView>('/api/site-admin/site-pages')
      .then((data) => live && setPages(data.pages))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return (
      <SiteAdminPage locale={locale} title={title} lead={lead}>
        <SiteAdminFailed
          locale={locale}
          messageAr="تعذّر تحميل صفحات الموقع."
          messageEn="Could not load site pages."
        />
      </SiteAdminPage>
    );
  }
  if (!pages) {
    return (
      <SiteAdminPage locale={locale} title={title} lead={lead}>
        <SiteAdminLoading locale={locale} />
      </SiteAdminPage>
    );
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const data = await browserNextMutation<SitePagesView>('/api/site-admin/site-pages', {
        method: 'PUT',
        body: JSON.stringify({ pages }),
      });
      setPages(data.pages);
      setNotice({ tone: 'success', text: ar ? 'حُفظت الصفحات.' : 'Pages saved.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الحفظ.', 'Could not save.'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SiteAdminPage
      locale={locale}
      title={title}
      lead={lead}
      actions={
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ' : 'Save'}
        </button>
      }
    >
      <SiteAdminBanner notice={notice} />
      <SiteAdminSurface title={ar ? 'الصفحات العامة' : 'Public pages'}>
        <ul className="sa-page-list">
          {SITE_PAGE_IDS.map((id) => {
            const meta = SITE_PAGE_META[id];
            const locked = id === 'login';
            return (
              <li key={id} className={pages[id] ? '' : 'is-off'}>
                <label>
                  <input
                    type="checkbox"
                    checked={pages[id]}
                    disabled={locked}
                    onChange={(event) =>
                      setPages((current) =>
                        current ? { ...current, [id]: event.target.checked } : current,
                      )
                    }
                  />
                  <span>
                    <strong>{ar ? meta.ar : meta.en}</strong>
                    <small>
                      <code>{meta.path}</code>
                      {locked ? (ar ? ' — دائماً متاح' : ' — always on') : null}
                    </small>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </SiteAdminSurface>
    </SiteAdminPage>
  );
}
