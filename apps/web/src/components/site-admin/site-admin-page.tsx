'use client';

import type { ReactNode } from 'react';
import type { AdminNotice } from './admin-fetch';

/** Shared page chrome for every /admin section — calm header, clear action, soft body. */
export function SiteAdminPage({
  locale,
  eyebrow,
  title,
  lead,
  actions,
  children,
  wide = true,
}: {
  locale: 'ar' | 'en';
  eyebrow?: string;
  title: string;
  lead: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const ar = locale === 'ar';
  return (
    <div className={wide ? 'sa-page site-admin--wide' : 'sa-page'} dir={ar ? 'rtl' : 'ltr'}>
      <header className="sa-page__head">
        <div className="sa-page__intro">
          <p className="sa-page__eyebrow">
            <span className="sa-page__mark" aria-hidden="true" />
            {eyebrow ?? (ar ? 'BHD R · تحكم الموقع' : 'BHD R · Site console')}
          </p>
          <h1 className="sa-page__title">{title}</h1>
          <p className="sa-page__lead">{lead}</p>
        </div>
        {actions ? <div className="sa-page__actions">{actions}</div> : null}
      </header>
      <div className="sa-page__body">{children}</div>
    </div>
  );
}

export function SiteAdminBanner({ notice }: { notice: AdminNotice | null }) {
  if (!notice) return null;
  return (
    <p
      className={`sa-banner sa-banner--${notice.tone}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      {notice.text}
    </p>
  );
}

export function SiteAdminLoading({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  return (
    <div className="sa-state sa-state--loading" aria-busy="true">
      <span className="sa-state__pulse" aria-hidden="true" />
      <p>{ar ? 'جارٍ تجهيز الصفحة…' : 'Preparing this page…'}</p>
    </div>
  );
}

export function SiteAdminFailed({
  locale,
  messageAr,
  messageEn,
}: {
  locale: 'ar' | 'en';
  messageAr: string;
  messageEn: string;
}) {
  return (
    <div className="sa-state sa-state--error" role="alert">
      <p>{locale === 'ar' ? messageAr : messageEn}</p>
    </div>
  );
}

export function SiteAdminSurface({
  children,
  title,
  hint,
  className,
}: {
  children: ReactNode;
  title?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <section className={className ? `sa-surface ${className}` : 'sa-surface'}>
      {title ? (
        <header className="sa-surface__head">
          <h2>{title}</h2>
          {hint ? <p>{hint}</p> : null}
        </header>
      ) : null}
      <div className="sa-surface__body">{children}</div>
    </section>
  );
}
