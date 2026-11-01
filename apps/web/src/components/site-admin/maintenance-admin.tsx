'use client';

import { useEffect, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import type { MaintenanceView } from '@/lib/site-control-shared';
import { adminErrorText, adminGet, type AdminNotice } from './admin-fetch';
import {
  SiteAdminBanner,
  SiteAdminFailed,
  SiteAdminLoading,
  SiteAdminPage,
  SiteAdminSurface,
} from './site-admin-page';

/** Site-wide maintenance toggle and the notice shown to visitors. */
export function MaintenanceAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [form, setForm] = useState<Omit<MaintenanceView, 'updatedAt'> | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const title = ar ? 'صيانة الموقع والتنبيه' : 'Site maintenance & notice';
  const lead = ar
    ? 'أظهر تنبيهاً للزوار، أو أوقف الصفحات العامة مؤقتاً. تحكم الموقع وتسجيل الدخول يبقيان متاحين.'
    : 'Show a visitor notice, or briefly block public pages. Site control and login stay available.';

  useEffect(() => {
    let live = true;
    adminGet<MaintenanceView>('/api/site-admin/maintenance')
      .then((data) => {
        if (!live) return;
        setForm({
          enabled: data.enabled,
          mode: data.mode,
          messageAr: data.messageAr,
          messageEn: data.messageEn,
        });
      })
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
          messageAr="تعذّر تحميل إعدادات الصيانة."
          messageEn="Could not load maintenance settings."
        />
      </SiteAdminPage>
    );
  }
  if (!form) {
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
      const data = await browserNextMutation<MaintenanceView>('/api/site-admin/maintenance', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setForm({
        enabled: data.enabled,
        mode: data.mode,
        messageAr: data.messageAr,
        messageEn: data.messageEn,
      });
      setNotice({ tone: 'success', text: ar ? 'حُفظت إعدادات الصيانة.' : 'Maintenance saved.' });
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
      <SiteAdminSurface
        title={ar ? 'الإعدادات' : 'Settings'}
        hint={ar ? 'غيّر الوضع والنص ثم احفظ.' : 'Change mode and copy, then save.'}
      >
        <label className="sa-toggle">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
          />
          {ar ? 'تفعيل وضع الصيانة' : 'Enable maintenance mode'}
        </label>

        <fieldset className="sa-field">
          <legend>{ar ? 'نمط الصيانة' : 'Maintenance mode'}</legend>
          <label>
            <input
              type="radio"
              name="maint-mode"
              checked={form.mode === 'banner'}
              onChange={() => setForm({ ...form, mode: 'banner' })}
            />
            {ar ? 'تنبيه فقط (الصفحات تعمل)' : 'Banner only (pages stay open)'}
          </label>
          <label>
            <input
              type="radio"
              name="maint-mode"
              checked={form.mode === 'hard'}
              onChange={() => setForm({ ...form, mode: 'hard' })}
            />
            {ar
              ? 'إيقاف الصفحات العامة (ما عدا الدخول والتحكم)'
              : 'Block public pages (except login & admin)'}
          </label>
        </fieldset>

        <label className="sa-field">
          <span>{ar ? 'نص التنبيه (عربي)' : 'Notice (Arabic)'}</span>
          <textarea
            className="sa-input sa-input--area"
            rows={3}
            value={form.messageAr}
            onChange={(event) => setForm({ ...form, messageAr: event.target.value })}
          />
        </label>
        <label className="sa-field">
          <span>{ar ? 'نص التنبيه (إنجليزي)' : 'Notice (English)'}</span>
          <textarea
            className="sa-input sa-input--area"
            rows={3}
            value={form.messageEn}
            onChange={(event) => setForm({ ...form, messageEn: event.target.value })}
          />
        </label>

        {form.enabled ? (
          <div className="sa-maintenance-preview" role="status">
            <strong>{ar ? 'معاينة التنبيه' : 'Notice preview'}</strong>
            <p>{ar ? form.messageAr : form.messageEn}</p>
          </div>
        ) : null}
      </SiteAdminSurface>
    </SiteAdminPage>
  );
}
