'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';

type ShareChannel = {
  id: string;
  labelAr: string;
  labelEn: string;
  href?: string;
  action?: 'native' | 'copy';
  icon: ReactNode;
};

function IconWhatsApp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.04 2a9.9 9.9 0 0 0-8.5 14.94L2 22l5.2-1.48A9.9 9.9 0 1 0 12.04 2Zm0 1.8a8.1 8.1 0 0 1 6.9 12.3 8.1 8.1 0 0 1-9.7 2.55l-.55-.3-3.08.88.9-3-.34-.58A8.1 8.1 0 0 1 12.04 3.8Zm4.56 11.56c-.2.56-1.15 1.06-1.6 1.13-.41.06-.93.09-1.5-.09-.35-.11-.79-.26-1.36-.51-2.4-1.04-3.96-3.46-4.08-3.62-.12-.16-1-1.33-1-2.54s.63-1.8.86-2.05c.22-.25.48-.31.64-.31h.47c.15 0 .35-.06.55.42.2.5.68 1.66.74 1.78.06.12.1.26.02.42-.08.16-.12.26-.24.4-.12.14-.25.31-.36.42-.12.12-.24.24-.1.47.14.23.62 1.02 1.33 1.65.92.81 1.69 1.06 1.93 1.18.24.12.38.1.52-.06.14-.16.6-.7.76-.94.16-.24.32-.2.54-.12.22.08 1.4.66 1.64.78.24.12.4.18.46.28.06.1.06.58-.14 1.14Z"
      />
    </svg>
  );
}

function IconFacebook() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.5 22v-8.1h2.72l.41-3.17H13.5V8.7c0-.92.25-1.54 1.57-1.54H16.8V4.32C16.4 4.27 15.1 4.15 13.57 4.15c-3.18 0-5.36 1.94-5.36 5.5v3.08H5.7v3.17h2.51V22h5.29Z"
      />
    </svg>
  );
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 4h4.3l3.7 5.1L16.4 4H20l-5.7 6.8L20.4 20h-4.3l-4-5.5L7.6 20H4l6-7.1L4 4Zm3.1 1.5 9.7 13h1.7L8.9 5.5H7.1Z"
      />
    </svg>
  );
}

function IconTelegram() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.7 4.3 2.9 11.5c-1.28.5-1.26 1.2-.23 1.5l4.8 1.5 1.85 5.7c.23.63.12.88.82.88.54 0 .78-.25 1.08-.54l2.6-2.53 5.4 4c1 .55 1.72.26 1.97-.93L22.9 5.6c.32-1.28-.46-1.84-1.2-1.3ZM9.4 14.9l-.3 3.4 2.5-2.4 5.1 3.7L20.5 6 5.6 12.7l3.8 1.2 7.4-4.66-5.4 5.66Z"
      />
    </svg>
  );
}

function IconLinkedIn() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.3 9.2H3.5V20.5h2.8V9.2ZM4.9 3.5A1.7 1.7 0 1 0 4.9 6.9 1.7 1.7 0 0 0 4.9 3.5ZM13.2 9c-1.55 0-2.55.85-2.98 1.65V9.2H7.5V20.5h2.8v-6c0-1.58.3-3.1 2.25-3.1 1.93 0 1.96 1.8 1.96 3.2v5.9h2.8v-6.6C17.3 10.1 16.2 9 13.2 9Z"
      />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 7.2A4.8 4.8 0 1 0 12 16.8 4.8 4.8 0 0 0 12 7.2Zm0 7.9a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2Zm6.1-8.2a1.12 1.12 0 1 1-2.24 0 1.12 1.12 0 0 1 2.24 0ZM12 3.5c-2.3 0-2.6.01-3.5.05-2.25.1-3.5 1.35-3.6 3.6-.04.9-.05 1.2-.05 3.5s.01 2.6.05 3.5c.1 2.24 1.35 3.5 3.6 3.6.9.04 1.2.05 3.5.05s2.6-.01 3.5-.05c2.25-.1 3.5-1.36 3.6-3.6.04-.9.05-1.2.05-3.5s-.01-2.6-.05-3.5c-.1-2.25-1.35-3.5-3.6-3.6-.9-.04-1.2-.05-3.5-.05Zm0 1.7c2.26 0 2.53.01 3.42.05 1.62.07 2.5.9 2.57 2.57.04.89.05 1.16.05 3.42s-.01 2.53-.05 3.42c-.07 1.66-.95 2.5-2.57 2.57-.89.04-1.16.05-3.42.05s-2.53-.01-3.42-.05c-1.63-.07-2.5-.91-2.57-2.57-.04-.89-.05-1.16-.05-3.42s.01-2.53.05-3.42c.07-1.67.94-2.5 2.57-2.57.89-.04 1.16-.05 3.42-.05Z"
      />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8.5 4.5A2.5 2.5 0 0 1 11 2h7.5A2.5 2.5 0 0 1 21 4.5V12a2.5 2.5 0 0 1-2.5 2.5H16V16.5A2.5 2.5 0 0 1 13.5 19H6A2.5 2.5 0 0 1 3.5 16.5V9A2.5 2.5 0 0 1 6 6.5h2.5V4.5Zm1.7 2H6A.8.8 0 0 0 5.2 9v7.5c0 .44.36.8.8.8h7.5a.8.8 0 0 0 .8-.8V14H11A2.5 2.5 0 0 1 8.5 11.5V6.5Zm2.5-2.8a.8.8 0 0 0-.8.8V11.5c0 .44.36.8.8.8H18.5a.8.8 0 0 0 .8-.8V4.5a.8.8 0 0 0-.8-.8H12.7Z"
      />
    </svg>
  );
}

/** Icon-only share row for public listings (place below booking CTAs). */
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
        icon: <IconWhatsApp />,
      },
      {
        id: 'facebook',
        labelAr: 'فيسبوك',
        labelEn: 'Facebook',
        href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(absoluteUrl)}`,
        icon: <IconFacebook />,
      },
      {
        id: 'x',
        labelAr: 'X',
        labelEn: 'X',
        href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(absoluteUrl)}&text=${encodeURIComponent(title)}`,
        icon: <IconX />,
      },
      {
        id: 'telegram',
        labelAr: 'تيليجرام',
        labelEn: 'Telegram',
        href: `https://t.me/share/url?url=${encodeURIComponent(absoluteUrl)}&text=${encodeURIComponent(title)}`,
        icon: <IconTelegram />,
      },
      {
        id: 'linkedin',
        labelAr: 'لينكدإن',
        labelEn: 'LinkedIn',
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(absoluteUrl)}`,
        icon: <IconLinkedIn />,
      },
      {
        id: 'instagram',
        labelAr: 'إنستغرام',
        labelEn: 'Instagram',
        action: 'native',
        icon: <IconInstagram />,
      },
      {
        id: 'copy',
        labelAr: 'نسخ الرابط',
        labelEn: 'Copy link',
        action: 'copy',
        icon: <IconCopy />,
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
          flash(ar ? 'تعذّر النسخ.' : 'Could not copy.');
        }
        return;
      }
      if (channel.action === 'native') {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          try {
            await navigator.share({ title, text: shareText, url: absoluteUrl });
            return;
          } catch {
            /* fall through */
          }
        }
        try {
          await navigator.clipboard.writeText(absoluteUrl);
          flash(ar ? 'تم نسخ الرابط للمشاركة.' : 'Link copied to share.');
        } catch {
          flash(ar ? 'تعذّرت المشاركة.' : 'Share unavailable.');
        }
      }
    },
    [absoluteUrl, ar, flash, shareText, title],
  );

  return (
    <div className="listing-share listing-share--icons" aria-label={ar ? 'مشاركة العقار' : 'Share listing'}>
      <div className="listing-share__grid">
        {channels.map((channel) => {
          const label = ar ? channel.labelAr : channel.labelEn;
          if (channel.href) {
            return (
              <a
                key={channel.id}
                className={`listing-share__icon listing-share__icon--${channel.id}`}
                href={channel.href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                title={label}
              >
                {channel.icon}
              </a>
            );
          }
          return (
            <button
              key={channel.id}
              type="button"
              className={`listing-share__icon listing-share__icon--${channel.id}`}
              onClick={() => void onChannel(channel)}
              aria-label={label}
              title={label}
            >
              {channel.icon}
            </button>
          );
        })}
      </div>
      {notice ? (
        <p className="listing-share__notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
