import type { ReactNode } from 'react';

type IconId =
  'account' | 'portal' | 'wazen' | 'hisaby' | 'nasab' | 'baitak' | 'store' | 'office' | 'bhd-r';

const ICONS: Record<IconId, { label: string; soft: string; accent: string; glyph: ReactNode }> = {
  account: {
    label: 'الحساب',
    soft: '#dceee9',
    accent: '#092d24',
    glyph: (
      <>
        <circle cx="24" cy="18" r="6.2" />
        <path d="M12.5 36.5c1.4-7.2 6.2-10.7 11.5-10.7s10.1 3.5 11.5 10.7" />
      </>
    ),
  },
  portal: {
    label: 'البوابة',
    soft: '#d9ebe4',
    accent: '#075c45',
    glyph: (
      <>
        <path d="M15 14h7.4c3.4 0 5.6 1.9 5.6 4.8 0 2-1 3.4-2.8 4.2 2.3.7 3.6 2.5 3.6 4.8 0 3.2-2.5 5.4-6.2 5.4H18.4v-3.1h8.1c1.8 0 2.9-.9 2.9-2.3s-1.2-2.4-3.3-2.4H15V14Zm0 0" />
        <path d="M15 14v19.2" />
      </>
    ),
  },
  wazen: {
    label: 'وازن',
    soft: '#d7efe9',
    accent: '#126b63',
    glyph: (
      <>
        <path d="M24 11v18" />
        <path d="M16 13.5h16" />
        <path d="M24 16.5 14 28h8.2L24 16.5Zm0 0 10 11.5h-8.2L24 16.5Z" />
        <path d="M17 32.5h14" />
      </>
    ),
  },
  hisaby: {
    label: 'حسابي',
    soft: '#d9ebe4',
    accent: '#075c45',
    glyph: (
      <>
        <rect x="14" y="12" width="20" height="24" rx="3.5" />
        <path d="M18 18h12M18 23h12M18 28h8" />
      </>
    ),
  },
  nasab: {
    label: 'نَسَب',
    soft: '#f3e2e5',
    accent: '#8a3c45',
    glyph: (
      <>
        <circle cx="24" cy="14.5" r="4" />
        <circle cx="15.5" cy="33" r="4" />
        <circle cx="32.5" cy="33" r="4" />
        <path d="M24 18.5v5.5M24 24l-8.5 5M24 24l8.5 5" />
      </>
    ),
  },
  baitak: {
    label: 'بيتك',
    soft: '#f4e8d8',
    accent: '#a66b2d',
    glyph: (
      <>
        <path d="M11 23.5 24 12l13 11.5" />
        <path d="M16 22.5V35h16V22.5" />
        <path d="M21.5 35v-8h5v8" />
      </>
    ),
  },
  store: {
    label: 'المتجر',
    soft: '#dce7f3',
    accent: '#315d89',
    glyph: (
      <>
        <path d="M16 18h16l-1.4 16.2A3 3 0 0 1 27.6 37h-7.2a3 3 0 0 1-3-2.8L16 18Z" />
        <path d="M19 18.2c0-4 2.1-7.2 5-7.2s5 3.2 5 7.2" />
      </>
    ),
  },
  office: {
    label: 'المكتب',
    soft: '#e2e7eb',
    accent: '#283b4d',
    glyph: (
      <>
        <path d="M16 36V14h16v22" />
        <path d="M16 36h16M20 19h3M25 19h3M20 24h3M25 24h3M20 29h3M25 29h3" />
      </>
    ),
  },
  'bhd-r': {
    label: 'BHD R',
    soft: '#f4e8d8',
    accent: '#a66b2d',
    glyph: (
      <>
        <path d="M11 23.5 24 12l13 11.5" />
        <path d="M16 22.5V35h16V22.5" />
        <path d="M21.5 35v-8h5v8" />
      </>
    ),
  },
};

const SLUG_TO_ICON: Record<string, IconId> = {
  account: 'account',
  portal: 'portal',
  wazen: 'wazen',
  hisab: 'hisaby',
  hisaby: 'hisaby',
  nasab: 'nasab',
  baitak: 'baitak',
  'ain-oman': 'baitak',
  'bhd-store': 'store',
  store: 'store',
  'bhd-office': 'office',
  office: 'office',
  'bhd-r': 'bhd-r',
  'real-estate': 'bhd-r',
};

export function appIconId(idOrSlug: string): IconId {
  return SLUG_TO_ICON[idOrSlug] || 'portal';
}

export function BhdAppIcon({
  id,
  title,
  className = '',
}: {
  id: string;
  title?: string;
  className?: string;
}) {
  const icon = ICONS[appIconId(id)];
  return (
    <span
      className={`bhd-app-icon ${className}`.trim()}
      style={{ background: icon.soft, color: icon.accent }}
      title={title || icon.label}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" fill="none">
        <g
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          {icon.glyph}
        </g>
      </svg>
    </span>
  );
}
