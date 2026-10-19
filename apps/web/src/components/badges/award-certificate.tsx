'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BadgeEmblem } from '@/components/badges/badge-emblem';
import { dateText } from '@/lib/badges-client';
import {
  AWARD_STATUS_LABELS,
  LEVEL_LABELS,
  SUBJECT_LABELS,
  TIER_LABELS,
  type AwardStatus,
  type BadgeIcon,
  type BadgeLevel,
  type BadgeSubject,
  type BadgeTier,
} from '@/lib/badges-shared';

export type CertificateData = {
  serial: string;
  badgeNameAr: string;
  badgeNameEn: string;
  tier: BadgeTier;
  level: BadgeLevel;
  icon: BadgeIcon;
  subjectType: BadgeSubject;
  holder: string;
  organizationNameAr: string;
  organizationNameEn: string;
  status: AwardStatus;
  awardedAt: string | null;
  expiresAt: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  criteria?: string[];
  rationale?: string | null;
};

function useQr(path: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const absolute = new URL(path, window.location.origin).toString();
    void Promise.all([import('qrcode'), import('@/lib/qr-brand')])
      .then(([mod, brand]) =>
        brand.brandedQrDataUrl(mod.toString.bind(mod), absolute, {
          width: 132,
          dark: '#0f172a',
          light: '#ffffff',
        }),
      )
      .then((data) => {
        if (!cancelled) setSrc(data);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return src;
}

/** A printable certificate or award card, carrying its serial and a QR code to the public check. */
export function AwardCertificate({
  data,
  locale,
  backHref,
  publicView = false,
}: {
  data: CertificateData;
  locale: 'ar' | 'en';
  backHref?: string;
  publicView?: boolean;
}) {
  const ar = locale === 'ar';
  const verifyPath = `/${locale}/verify/badge/${data.serial}`;
  const qr = useQr(verifyPath);
  const valid = data.status === 'active';
  const tierText = ar ? TIER_LABELS[data.tier].ar : TIER_LABELS[data.tier].en;
  const description = ar ? data.descriptionAr : data.descriptionEn;
  return (
    <section className="award-certificate-page">
      {!publicView ? (
        <div className="award-certificate-page__tools">
          {backHref ? (
            <Link className="button button--ghost" href={backHref}>
              {ar ? '→ الشارات' : '← Badges'}
            </Link>
          ) : null}
          <button type="button" className="button button--primary" onClick={() => window.print()}>
            {ar ? 'طباعة / حفظ PDF' : 'Print / save PDF'}
          </button>
        </div>
      ) : null}
      <article
        className={`award-certificate award-certificate--${data.level}${valid ? '' : ' is-ended'}`}
      >
        <div className="award-certificate__frame">
          <header className="award-certificate__head">
            <p className="award-certificate__org">
              {ar ? data.organizationNameAr : data.organizationNameEn}
            </p>
            <p className="award-certificate__kind">
              {data.tier === 'certificate'
                ? ar
                  ? 'شهادة تميّز'
                  : 'Certificate of excellence'
                : data.tier === 'shield'
                  ? ar
                    ? 'درع التميّز'
                    : 'Shield of excellence'
                  : data.tier === 'medal'
                    ? ar
                      ? 'وسام التميّز'
                      : 'Medal of excellence'
                    : ar
                      ? 'شارة تميّز'
                      : 'Excellence badge'}
            </p>
          </header>
          <div className="award-certificate__emblem">
            <BadgeEmblem
              tier={data.tier}
              level={data.level}
              icon={data.icon}
              size={132}
              muted={!valid}
            />
          </div>
          <p className="award-certificate__lead">{ar ? 'تُمنح إلى' : 'Awarded to'}</p>
          <h1 className="award-certificate__holder">
            <bdi>{data.holder}</bdi>
          </h1>
          <p className="award-certificate__subject muted">
            {ar ? SUBJECT_LABELS[data.subjectType].ar : SUBJECT_LABELS[data.subjectType].en}
          </p>
          <p className="award-certificate__badge">
            {tierText} «{ar ? data.badgeNameAr : data.badgeNameEn}» —{' '}
            {ar ? LEVEL_LABELS[data.level].ar : LEVEL_LABELS[data.level].en}
          </p>
          {description ? <p className="award-certificate__desc">{description}</p> : null}
          {data.rationale ? <p className="award-certificate__why">{data.rationale}</p> : null}
          {data.criteria?.length ? (
            <ul className="award-certificate__criteria">
              {data.criteria.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
          <footer className="award-certificate__foot">
            <dl>
              <div>
                <dt>{ar ? 'الرقم التسلسلي' : 'Serial'}</dt>
                <dd dir="ltr">{data.serial}</dd>
              </div>
              <div>
                <dt>{ar ? 'تاريخ المنح' : 'Awarded'}</dt>
                <dd>{dateText(data.awardedAt, ar)}</dd>
              </div>
              <div>
                <dt>{ar ? 'صالحة حتى' : 'Valid until'}</dt>
                <dd>
                  {data.expiresAt
                    ? dateText(data.expiresAt, ar)
                    : ar
                      ? 'ما دامت الشروط متحققة'
                      : 'While criteria hold'}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'الحالة' : 'Status'}</dt>
                <dd className={`award-certificate__status is-${data.status}`}>
                  {ar ? AWARD_STATUS_LABELS[data.status].ar : AWARD_STATUS_LABELS[data.status].en}
                </dd>
              </div>
            </dl>
            <div className="award-certificate__qr">
              {qr ? (
                <img
                  src={qr}
                  alt={ar ? 'رمز التحقق' : 'Verification code'}
                  width={112}
                  height={112}
                />
              ) : (
                <span className="award-certificate__qr-ph" aria-hidden="true" />
              )}
              <span className="muted">{ar ? 'امسح للتحقق' : 'Scan to verify'}</span>
            </div>
          </footer>
        </div>
      </article>
    </section>
  );
}
