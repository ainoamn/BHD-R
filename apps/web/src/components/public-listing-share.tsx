'use client';

import { useCallback, useMemo, useState } from 'react';
import { PropertyQrCard } from '@/components/property-qr-card';

type ShareChannel = {
  id: string;
  labelAr: string;
  labelEn: string;
  href?: string;
  action?: 'native' | 'copy';
};

export function PublicListingShare({
  path,
  title,
  locale,
}: {
  path: string;
  title: string;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const [notice, setNotice] = useState<string | null>(null);

  const absoluteUrl = useMemo(() => {
    if (typeof window === 'undefined') return path;
    try {
      return new URL(path, window.location.origin).toString();
    } catch {
      return path;
    }
  }, [path]);

  const shareText = useMemo(
    () => (ar ? `${title}\nشاهده على BHD R:\n${absoluteUrl}` : `${title}\nSee it on BHD R:\n${absoluteUrl}`),
    [ar, absoluteUrl, title],
  );

  const channels: ShareChannel[] = useMemo(
    () => [
      {
        id: 'whatsapp',
        labelAr: 'واتساب',
        labelEn: 'WhatsApp',
        href: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
      },
      {
        id: 'facebook',
        labelAr: 'فيسبوك',
        labelEn: 'Facebook',
        href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(absoluteUrl)}`,
      },
      {
        id: 'x',
        labelAr: 'X',
        labelEn: 'X',
        href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(absoluteUrl)}&text=${encodeURIComponent(title)}`,
      },
      {
        id: 'telegram',
        labelAr: 'تيليجرام',
        labelEn: 'Telegram',
        href: `https://t.me/share/url?url=${encodeURIComponent(absoluteUrl)}&text=${encodeURIComponent(title)}`,
      },
      {
        id: 'linkedin',
        labelAr: 'لينكدإن',
        labelEn: 'LinkedIn',
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(absoluteUrl)}`,
      },
      {
        id: 'instagram',
        labelAr: 'إنستغرام',
        labelEn: 'Instagram',
        action: 'native',
      },
      {
        id: 'copy',
        labelAr: 'نسخ الرابط',
        labelEn: 'Copy link',
        action: 'copy',
      },
    ],
    [absoluteUrl, shareText, title],
  );

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2_400);
  }, []);

  const onChannel = useCallback(
    async (channel: ShareChannel) => {
      if (channel.href) {
        window.open(channel.href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (channel.action === 'copy') {
        try {
          await navigator.clipboard.writeText(absoluteUrl);
          flash(ar ? 'تم نسخ رابط العقار.' : 'Listing link copied.');
        } catch {
          flash(ar ? 'تعذّر النسخ — انسخ الرابط يدوياً.' : 'Could not copy — copy the link manually.');
        }
        return;
      }
      if (channel.action === 'native') {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          try {
            await navigator.share({ title, text: shareText, url: absoluteUrl });
            return;
          } catch {
            /* fall through to copy */
          }
        }
        try {
          await navigator.clipboard.writeText(absoluteUrl);
          flash(
            ar
              ? 'تم نسخ الرابط — الصقه في إنستغرام أو أي تطبيق.'
              : 'Link copied — paste it in Instagram or any app.',
          );
        } catch {
          flash(ar ? 'افتح المشاركة من جهازك أو انسخ الرابط.' : 'Use your device share sheet or copy the link.');
        }
      }
    },
    [absoluteUrl, ar, flash, shareText, title],
  );

  return (
    <div className="listing-share">
      <PropertyQrCard
        path={path}
        locale={locale}
        size={132}
        labelAr="امسح الرمز لفتح صفحة هذا العقار"
        labelEn="Scan to open this property page"
      />
      <div className="listing-share__channels" aria-label={ar ? 'مشاركة العقار' : 'Share listing'}>
        <p className="listing-share__title">{ar ? 'مشاركة مباشرة' : 'Share directly'}</p>
        <div className="listing-share__grid">
          {channels.map((channel) =>
            channel.href ? (
              <a
                key={channel.id}
                className={`button button--quiet listing-share__btn listing-share__btn--${channel.id}`}
                href={channel.href}
                target="_blank"
                rel="noreferrer"
              >
                {ar ? channel.labelAr : channel.labelEn}
              </a>
            ) : (
              <button
                key={channel.id}
                type="button"
                className={`button button--quiet listing-share__btn listing-share__btn--${channel.id}`}
                onClick={() => void onChannel(channel)}
              >
                {ar ? channel.labelAr : channel.labelEn}
              </button>
            ),
          )}
        </div>
        {notice ? (
          <p className="listing-share__notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}
