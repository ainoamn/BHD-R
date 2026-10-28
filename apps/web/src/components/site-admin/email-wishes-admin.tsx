'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import { EMAIL_TONES, type EmailTone } from '@/lib/email-template';
import type { EmailWishPoolsView } from '@/lib/email-wish-pools-shared';

const TONE_LABELS: Record<EmailTone, { ar: string; en: string }> = {
  maintenance: { ar: 'الصيانة', en: 'Maintenance' },
  contract: { ar: 'العقود', en: 'Contracts' },
  invoice: { ar: 'الفواتير', en: 'Invoices' },
  arrears: { ar: 'المتأخرات', en: 'Arrears' },
  reminder: { ar: 'التذكير', en: 'Reminder' },
  reward: { ar: 'المكافآت', en: 'Rewards' },
  upgrade: { ar: 'الترقيات', en: 'Upgrades' },
  booking: { ar: 'الحجوزات', en: 'Bookings' },
  listing: { ar: 'الإعلانات', en: 'Listings' },
  vacancy: { ar: 'الشواغر', en: 'Vacancies' },
  request: { ar: 'الطلبات', en: 'Requests' },
  alert: { ar: 'تنبيه', en: 'Alert' },
  team: { ar: 'الفريق', en: 'Team' },
  legal: { ar: 'القانوني', en: 'Legal' },
  deposit: { ar: 'التأمين', en: 'Deposit' },
  general: { ar: 'عام', en: 'General' },
};

function linesToText(lines: string[]): string {
  return lines.join('\n');
}

function textToLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function EmailWishesAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [tone, setTone] = useState<EmailTone>('booking');
  const [data, setData] = useState<EmailWishPoolsView | null>(null);
  const [wishText, setWishText] = useState('');
  const [sparksText, setSparksText] = useState('');
  const [namedText, setNamedText] = useState('');
  const [anonText, setAnonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/site-admin/email-wishes', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(ar ? 'تعذّر التحميل' : 'Load failed');
      const json = (await response.json()) as EmailWishPoolsView;
      setData(json);
      setWishText(linesToText(json.wishes[tone] ?? []));
      setSparksText(linesToText(json.sparks));
      setNamedText(linesToText(json.greetingsNamed));
      setAnonText(linesToText(json.greetingsAnon));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load
  }, []);

  useEffect(() => {
    if (!data) return;
    setWishText(linesToText(data.wishes[tone] ?? []));
  }, [tone, data]);

  const toneLabel = useMemo(() => TONE_LABELS[tone], [tone]);

  async function save() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const wishes = { ...data.wishes, [tone]: textToLines(wishText) };
      for (const key of EMAIL_TONES) {
        if (!wishes[key]?.length) wishes[key] = data.wishes[key];
      }
      const saved = await browserNextMutation<EmailWishPoolsView>('/api/site-admin/email-wishes', {
        method: 'PUT',
        body: JSON.stringify({
          wishes,
          sparks: textToLines(sparksText),
          greetingsNamed: textToLines(namedText),
          greetingsAnon: textToLines(anonText),
        }),
      });
      setData(saved);
      setWishText(linesToText(saved.wishes[tone] ?? []));
      setSparksText(linesToText(saved.sparks));
      setNamedText(linesToText(saved.greetingsNamed));
      setAnonText(linesToText(saved.greetingsAnon));
      setNotice(ar ? 'تم الحفظ — ستظهر العبارات في الإيميلات التالية.' : 'Saved — next emails will use these lines.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm(ar ? 'إعادة العبارات الافتراضية؟' : 'Reset to default phrases?')) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await browserNextMutation<EmailWishPoolsView>('/api/site-admin/email-wishes', {
        method: 'DELETE',
      });
      setData(saved);
      setWishText(linesToText(saved.wishes[tone] ?? []));
      setSparksText(linesToText(saved.sparks));
      setNamedText(linesToText(saved.greetingsNamed));
      setAnonText(linesToText(saved.greetingsAnon));
      setNotice(ar ? 'تمت إعادة الافتراضي.' : 'Defaults restored.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-shell" dir={ar ? 'rtl' : 'ltr'}>
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · SITE ADMIN</span>
          <h1>{ar ? 'العبارات التحفيزية في الإيميل' : 'Email motivational phrases'}</h1>
          <p className="muted">
            {ar
              ? 'الشريط اللطيف أسفل محتوى الرسالة (مثل «المفتاح جاهز والقهوة العمانية…») والتحية في المقدمة. سطر واحد لكل عبارة، عربي · إنجليزي.'
              : 'The soft banner under the email body (e.g. “Key ready; Omani coffee…”) and the opening greeting. One bilingual line per phrase (AR · EN).'}
          </p>
        </div>
      </header>

      {data?.usingDefaults ? (
        <p className="notice" role="status">
          {ar ? 'حالياً تُستخدم العبارات الافتراضية من النظام.' : 'Currently using built-in defaults.'}
        </p>
      ) : (
        <p className="notice" role="status">
          {ar ? 'تُستخدم عبارات مخصّصة محفوظة في المنصة.' : 'Using custom phrases saved on the platform.'}
        </p>
      )}

      <div className="form-grid">
        <label className="field">
          <span>{ar ? 'نبرة الرسالة' : 'Email tone'}</span>
          <select
            className="select"
            value={tone}
            onChange={(event) => setTone(event.target.value as EmailTone)}
          >
            {EMAIL_TONES.map((id) => (
              <option key={id} value={id}>
                {ar ? TONE_LABELS[id].ar : TONE_LABELS[id].en}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>
          {ar
            ? `عبارات التحفيز — ${toneLabel.ar} (سطر لكل عبارة)`
            : `Wish lines — ${toneLabel.en} (one per line)`}
        </span>
        <textarea
          className="textarea"
          rows={10}
          value={wishText}
          onChange={(event) => setWishText(event.target.value)}
          spellCheck
        />
      </label>

      <label className="field">
        <span>{ar ? 'جمل التعزيز المشتركة (Sparks)' : 'Shared spark lines'}</span>
        <textarea
          className="textarea"
          rows={8}
          value={sparksText}
          onChange={(event) => setSparksText(event.target.value)}
        />
      </label>

      <label className="field">
        <span>
          {ar
            ? 'تحيات بالاسم — استخدم {name} مكان الاسم'
            : 'Named greetings — use {name} for the recipient'}
        </span>
        <textarea
          className="textarea"
          rows={5}
          value={namedText}
          onChange={(event) => setNamedText(event.target.value)}
        />
      </label>

      <label className="field">
        <span>{ar ? 'تحيات بدون اسم' : 'Anonymous greetings'}</span>
        <textarea
          className="textarea"
          rows={5}
          value={anonText}
          onChange={(event) => setAnonText(event.target.value)}
        />
      </label>

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}

      <div className="form-actions">
        <button className="button button--quiet" type="button" disabled={busy} onClick={() => void load()}>
          {ar ? 'تحديث' : 'Reload'}
        </button>
        <button className="button button--quiet" type="button" disabled={busy} onClick={() => void reset()}>
          {ar ? 'إعادة الافتراضي' : 'Reset defaults'}
        </button>
        <button className="button button--primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? (ar ? 'جارٍ…' : 'Working…') : ar ? 'حفظ' : 'Save'}
        </button>
      </div>
    </div>
  );
}
