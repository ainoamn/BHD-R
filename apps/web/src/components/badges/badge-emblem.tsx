'use client';

import { useId } from 'react';
import type { BadgeIcon, BadgeLevel, BadgeTier } from '@/lib/badges-shared';

const PALETTE: Record<BadgeLevel, { light: string; mid: string; dark: string }> = {
  bronze: { light: '#f0b27a', mid: '#b86b34', dark: '#7a4520' },
  silver: { light: '#f4f6f8', mid: '#a7b1bc', dark: '#626d7a' },
  gold: { light: '#ffe38f', mid: '#d6a21e', dark: '#8f6a08' },
  platinum: { light: '#f3f8fa', mid: '#93b4c4', dark: '#3f6273' },
  diamond: { light: '#d3f6ff', mid: '#4cb6ea', dark: '#195f9e' },
};

const ICONS: Record<BadgeIcon, string> = {
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  check: 'M5 12.5l4.5 4.5L19 7',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
  clock: 'M12 3a9 9 0 110 18 9 9 0 010-18zM12 7v5l3 2',
  wrench: 'M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z',
  home: 'M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  key: 'M15 3a5 5 0 11-4.6 7L3 17.4V21h4v-2h2v-2h2l1.4-1.4A5 5 0 0115 3zM16 8h.01',
  trophy: 'M7 4h10v4a5 5 0 01-10 0zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3M12 13v4M8 21h8',
  leaf: 'M5 19C5 11 11 5 20 5c0 9-6 15-14 15M5 19l7-7',
  handshake: 'M2 12l4-4 4 2 3-2 3 1 6 5-3 3-2-2-2 2-2-2-2 2-3-3zM10 10l-3 3',
  gem: 'M6 3h12l3 6-9 12L3 9zM3 9h18M9.5 3L12 21M14.5 3L12 21',
  rocket: 'M12 2c4 2 6 6 6 10l-3 3H9l-3-3c0-4 2-8 6-10zM9 15l-3 5 4-2M15 15l3 5-4-2M12 9h.01',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
};

function scallop(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const steps = points * 2;
  return Array.from({ length: steps }, (_, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI * index) / points - Math.PI / 2;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

/** A badge, shield, certificate rosette or medal, coloured by level and carrying its icon. */
export function BadgeEmblem({
  tier,
  level,
  icon,
  size = 56,
  muted = false,
  title,
}: {
  tier: BadgeTier;
  level: BadgeLevel;
  icon: BadgeIcon;
  size?: number;
  muted?: boolean;
  title?: string;
}) {
  const id = useId().replace(/:/g, '');
  const colors = PALETTE[level];
  const fill = `url(#${id}-g)`;
  const ring = `url(#${id}-r)`;
  const iconBox = (cx: number, cy: number, scale: number) => (
    <g
      transform={`translate(${cx - 12 * scale} ${cy - 12 * scale}) scale(${scale})`}
      fill="none"
      stroke="#fff"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[icon]} />
    </g>
  );
  return (
    <svg
      className={`badge-emblem badge-emblem--${tier}${muted ? ' is-muted' : ''}`}
      width={size}
      height={Math.round(size * 1.12)}
      viewBox="0 0 100 112"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={colors.light} />
          <stop offset="0.55" stopColor={colors.mid} />
          <stop offset="1" stopColor={colors.dark} />
        </linearGradient>
        <linearGradient id={`${id}-r`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={colors.dark} />
          <stop offset="1" stopColor={colors.mid} />
        </linearGradient>
      </defs>
      {tier === 'shield' ? (
        <>
          <path
            d="M50 4l40 14v32c0 27-18 45-40 58C28 95 10 77 10 50V18z"
            fill={fill}
            stroke={colors.dark}
            strokeWidth="2"
          />
          <path
            d="M50 14l31 11v25c0 21-14 36-31 46-17-10-31-25-31-46V25z"
            fill={ring}
            opacity="0.9"
          />
          {iconBox(50, 52, 1.55)}
        </>
      ) : tier === 'certificate' ? (
        <>
          <path d="M33 66l-11 40 14-7 8 12 8-39z" fill={colors.dark} />
          <path d="M67 66l11 40-14-7-8 12-8-39z" fill={colors.mid} />
          <polygon
            points={scallop(50, 46, 42, 36, 18)}
            fill={fill}
            stroke={colors.dark}
            strokeWidth="1.5"
          />
          <circle cx="50" cy="46" r="28" fill={ring} />
          <circle
            cx="50"
            cy="46"
            r="24"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.45"
            strokeWidth="1.2"
          />
          {iconBox(50, 46, 1.35)}
        </>
      ) : tier === 'medal' ? (
        <>
          <path d="M30 2h16l10 34H40z" fill={colors.dark} />
          <path d="M70 2H54L44 36h16z" fill={colors.mid} />
          <circle cx="50" cy="68" r="38" fill={fill} stroke={colors.dark} strokeWidth="2" />
          <circle cx="50" cy="68" r="29" fill={ring} />
          {iconBox(50, 68, 1.4)}
        </>
      ) : (
        <>
          <polygon
            points={scallop(50, 54, 46, 41, 16)}
            fill={fill}
            stroke={colors.dark}
            strokeWidth="1.5"
          />
          <circle cx="50" cy="54" r="33" fill={ring} />
          <circle
            cx="50"
            cy="54"
            r="29"
            fill="none"
            stroke="#fff"
            strokeOpacity="0.4"
            strokeWidth="1.2"
          />
          {iconBox(50, 54, 1.5)}
        </>
      )}
    </svg>
  );
}
