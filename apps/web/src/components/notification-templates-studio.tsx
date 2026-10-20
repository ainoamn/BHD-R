'use client';

import { useEffect, useState } from 'react';
import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationTemplateMeta,
} from '@/lib/notification-templates-catalog';

type PreviewPayload = {
  id: string;
  channel: NotificationChannel;
  email: { subject: string; text: string; html: string } | null;
  whatsapp: { textAr: string; textEn: string; combined: string } | null;
};

const CHANNEL_LABEL: Record<NotificationChannel, { ar: string; en: string }> = {
  email: { ar: 'بريد', en: 'Email' },
  whatsapp: { ar: 'واتساب', en: 'WhatsApp' },
  both: { ar: 'بريد + واتساب', en: 'Email + WhatsApp' },
};

export function NotificationTemplatesStudio({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [templates, setTemplates] = useState<NotificationTemplateMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [tab, setTab] = useState<'email' | 'whatsapp'>('email');
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all');
  const [wishRotate, setWishRotate] = useState(0);
  const [device, setDevice] = useState<'phone' | 'tablet' | 'desktop'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (templates.length) return;
    let stopped = false;
    void (async () => {
      setLoadingList(true);
      setError(null);
      try {
        const response = await fetch('/api/owner/notification-templates', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const body = (await response.json().catch(() => null)) as
          | { templates?: NotificationTemplateMeta[] }
          | { error?: { code?: string } }
          | null;
        if (stopped) return;
        if (!response.ok || !body || !('templates' in body) || !body.templates) {
          setError((body && 'error' in body && body.error?.code) || 'load_failed');
          return;
        }
        setTemplates(body.templates);
        const first = body.templates[0];
        if (first) setSelectedId(first.id);
      } catch {
        if (!stopped) setError('load_failed');
      } finally {
        if (!stopped) setLoadingList(false);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [templates.length]);

  useEffect(() => {
    setWishRotate(0);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setPreview(null);
      return;
    }
    let stopped = false;
    void (async () => {
      setLoadingPreview(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/owner/notification-templates/${encodeURIComponent(selectedId)}/preview?rotate=${wishRotate}`,
          { credentials: 'same-origin', cache: 'no-store' },
        );
        const body = (await response.json().catch(() => null)) as
          | PreviewPayload
          | { error?: { code?: string } }
          | null;
        if (stopped) return;
        if (!response.ok || !body || !('id' in body)) {
          setError((body && 'error' in body && body.error?.code) || 'load_failed');
          setPreview(null);
          return;
        }
        setPreview(body);
        if (body.email && !body.whatsapp) setTab('email');
        else if (!body.email && body.whatsapp) setTab('whatsapp');
        else if (body.email) setTab('email');
      } catch {
        if (!stopped) {
          setError('load_failed');
          setPreview(null);
        }
      } finally {
        if (!stopped) setLoadingPreview(false);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [selectedId, wishRotate]);

  const filtered =
    category === 'all' ? templates : templates.filter((item) => item.category === category);
  const selected = templates.find((item) => item.id === selectedId) ?? null;
  const categories = [
    'all',
    ...new Set(templates.map((item) => item.category)),
  ] as Array<NotificationCategory | 'all'>;

  return (
    <div className="form-shell notify-studio">
      <header className="notify-studio__head">
        <div>
          <span className="ops-kicker">{ar ? 'الإشعارات' : 'Notifications'}</span>
          <h1>{ar ? 'قوالب البريد وواتساب' : 'Email & WhatsApp templates'}</h1>
          <p className="muted">
            {ar
              ? 'معاينة متجاوبة للجوال واللوحي وسطح المكتب، مع رسائل واتساب مرحّة بالعربي والإنجليزي ونفس العبارات التحفيزية والأيقونات.'
              : 'Responsive email preview across phone, tablet and desktop, plus cheerful bilingual WhatsApp with the same icons and motivational closings.'}
          </p>
        </div>
      </header>

      <div className="notify-studio__filters" role="tablist" aria-label={ar ? 'التصنيف' : 'Category'}>
        {categories.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={category === key}
            className={`button button--quiet${category === key ? ' is-active' : ''}`}
            onClick={() => setCategory(key)}
          >
            {key === 'all'
              ? ar
                ? 'الكل'
                : 'All'
              : ar
                ? NOTIFICATION_CATEGORY_LABELS[key].ar
                : NOTIFICATION_CATEGORY_LABELS[key].en}
          </button>
        ))}
      </div>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="notify-studio__layout">
        <aside className="notify-studio__list" aria-label={ar ? 'القوالب' : 'Templates'}>
          {loadingList ? (
            <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
          ) : (
            <ul>
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === selectedId ? 'is-current' : undefined}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <strong>{ar ? item.nameAr : item.nameEn}</strong>
                    <span className="notify-studio__chip">
                      {ar ? CHANNEL_LABEL[item.channel].ar : CHANNEL_LABEL[item.channel].en}
                    </span>
                    <span className="muted">
                      {ar ? item.descriptionAr : item.descriptionEn}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="notify-studio__preview" aria-live="polite">
          {selected ? (
            <>
              <header className="notify-studio__preview-head">
                <h2>{ar ? selected.nameAr : selected.nameEn}</h2>
                <p className="muted">{ar ? selected.descriptionAr : selected.descriptionEn}</p>
                <p className="notice" role="status">
                  {ar
                    ? 'البريد لا يقطع النص على الهاتف، وواتساب يحمل أيقونة النوع + أمنية مرحّة + عبارة تشجيعية تتغيّر مع كل رسالة.'
                    : 'Email stays readable on phones; WhatsApp carries the tone icon, a cheerful wish, and a rotating encouragement line.'}
                </p>
              </header>

              <div className="notify-studio__tabs">
                {preview?.email ? (
                  <button
                    type="button"
                    className={tab === 'email' ? 'is-active' : undefined}
                    onClick={() => setTab('email')}
                  >
                    {ar ? 'معاينة البريد' : 'Email preview'}
                  </button>
                ) : null}
                {preview?.whatsapp ? (
                  <button
                    type="button"
                    className={tab === 'whatsapp' ? 'is-active' : undefined}
                    onClick={() => setTab('whatsapp')}
                  >
                    {ar ? 'معاينة واتساب' : 'WhatsApp preview'}
                  </button>
                ) : null}
                {(preview?.email || preview?.whatsapp) && (
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={loadingPreview}
                    onClick={() => setWishRotate((value) => value + 1)}
                  >
                    {ar ? 'غيّر العبارة المرحّة' : 'Shuffle cheerful line'}
                  </button>
                )}
              </div>

              {tab === 'email' && preview?.email ? (
                <div className="notify-studio__devices" role="group" aria-label={ar ? 'الجهاز' : 'Device'}>
                  {(
                    [
                      ['phone', ar ? 'جوال' : 'Phone'],
                      ['tablet', ar ? 'لوحي' : 'Tablet'],
                      ['desktop', ar ? 'سطح مكتب' : 'Desktop'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={device === key ? 'is-active' : undefined}
                      onClick={() => setDevice(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}

              {loadingPreview ? (
                <p className="muted">{ar ? 'جارٍ تجهيز المعاينة…' : 'Preparing preview…'}</p>
              ) : null}

              {!loadingPreview && tab === 'email' && preview?.email ? (
                <div className={`notify-studio__email notify-studio__email--${device}`}>
                  <p className="notify-studio__subject" dir="auto">
                    <span className="muted">{ar ? 'الموضوع:' : 'Subject:'}</span>{' '}
                    {preview.email.subject}
                  </p>
                  <div className="notify-studio__frame">
                    <iframe
                      title={ar ? 'معاينة البريد' : 'Email preview'}
                      className="notify-studio__iframe"
                      srcDoc={preview.email.html}
                      sandbox=""
                    />
                  </div>
                </div>
              ) : null}

              {!loadingPreview && tab === 'whatsapp' && preview?.whatsapp ? (
                <div className="notify-studio__wa">
                  <div className="notify-studio__wa-phone">
                    <div className="notify-studio__wa-status">BHD R · WhatsApp</div>
                    <p className="notify-studio__wa-lang">العربية</p>
                    <p className="notify-studio__wa-bubble" dir="rtl">
                      {preview.whatsapp.textAr}
                    </p>
                    <p className="notify-studio__wa-lang">English</p>
                    <p className="notify-studio__wa-bubble notify-studio__wa-bubble--en" dir="ltr">
                      {preview.whatsapp.textEn}
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted">
              {ar ? 'اختر قالباً من القائمة.' : 'Choose a template from the list.'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
