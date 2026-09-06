/** Abstract Omani civil-ID silhouette (ID-1). No personal data. Overlay-friendly translucency. */

export function OmaniIdFrame({
  side,
  className,
}: {
  side: 'front' | 'back';
  className?: string;
}) {
  if (side === 'back') {
    return (
      <svg
        className={className}
        viewBox="0 0 856 540"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <rect
          x="8"
          y="8"
          width="840"
          height="524"
          rx="28"
          fill="rgb(232 238 242 / 0.18)"
          stroke="#08a39f"
          strokeWidth="5"
        />
        <rect x="8" y="72" width="840" height="78" fill="rgb(26 36 48 / 0.55)" />
        <rect
          x="48"
          y="190"
          width="420"
          height="90"
          rx="10"
          fill="rgb(247 249 251 / 0.12)"
          stroke="#a8b6c0"
          strokeWidth="2"
          strokeDasharray="8 6"
        />
        <text x="58" y="248" fontSize="28" fill="#e8f2ef" fontFamily="system-ui,sans-serif" opacity="0.85">
          Signature / التوقيع
        </text>
        <rect
          x="48"
          y="320"
          width="760"
          height="160"
          rx="12"
          fill="rgb(244 247 249 / 0.12)"
          stroke="#b0bec7"
          strokeWidth="2"
        />
        {Array.from({ length: 28 }).map((_, i) => (
          <rect
            key={i}
            x={64 + i * 26}
            y="340"
            width={i % 3 === 0 ? 8 : i % 2 === 0 ? 5 : 3}
            height="120"
            fill="#e8f2ef"
            opacity="0.55"
          />
        ))}
        <path d="M40 40 h70 M40 40 v70" stroke="#08a39f" strokeWidth="7" strokeLinecap="round" fill="none" />
        <path d="M816 40 h-70 M816 40 v70" stroke="#08a39f" strokeWidth="7" strokeLinecap="round" fill="none" />
        <path d="M40 500 h70 M40 500 v-70" stroke="#08a39f" strokeWidth="7" strokeLinecap="round" fill="none" />
        <path d="M816 500 h-70 M816 500 v-70" stroke="#08a39f" strokeWidth="7" strokeLinecap="round" fill="none" />
      </svg>
    );
  }

  return (
    <svg
      className={className}
      viewBox="0 0 856 540"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <rect
        x="8"
        y="8"
        width="840"
        height="524"
        rx="28"
        fill="rgb(13 107 102 / 0.16)"
        stroke="#08a39f"
        strokeWidth="5"
      />
      <rect x="8" y="8" width="840" height="118" rx="28" fill="rgb(23 75 112 / 0.42)" />
      <rect x="8" y="90" width="840" height="36" fill="rgb(8 163 159 / 0.35)" />
      <circle cx="780" cy="62" r="28" fill="rgb(244 240 232 / 0.55)" />
      <circle cx="780" cy="62" r="18" fill="none" stroke="#f4f0e8" strokeWidth="3" />
      <text x="40" y="58" fontSize="26" fill="#f4f0e8" fontFamily="system-ui,sans-serif" fontWeight="700">
        سلطنة عُمان
      </text>
      <text x="40" y="92" fontSize="18" fill="#d7ebe8" fontFamily="system-ui,sans-serif">
        SULTANATE OF OMAN — بطاقة شخصية
      </text>
      <rect
        x="620"
        y="160"
        width="190"
        height="240"
        rx="12"
        fill="rgb(247 250 248 / 0.12)"
        stroke="#08a39f"
        strokeWidth="4"
        strokeDasharray="10 8"
      />
      <circle cx="715" cy="230" r="42" fill="rgb(197 213 208 / 0.35)" />
      <ellipse cx="715" cy="330" rx="58" ry="48" fill="rgb(197 213 208 / 0.28)" />
      <rect x="48" y="170" width="72" height="56" rx="8" fill="rgb(212 175 55 / 0.55)" stroke="#d4af37" strokeWidth="2" />
      <path d="M60 184 h48 M60 198 h48 M60 212 h48" stroke="#f4f0e8" strokeWidth="2" opacity="0.7" />
      <rect x="150" y="175" width="430" height="28" rx="6" fill="rgb(255 255 255 / 0.22)" />
      <rect x="150" y="220" width="380" height="22" rx="6" fill="rgb(255 255 255 / 0.16)" />
      <rect x="150" y="260" width="400" height="22" rx="6" fill="rgb(255 255 255 / 0.16)" />
      <rect x="150" y="300" width="300" height="22" rx="6" fill="rgb(255 255 255 / 0.14)" />
      <rect x="150" y="360" width="430" height="70" rx="10" fill="rgb(255 255 255 / 0.12)" />
      <path d="M40 40 h70 M40 40 v70" stroke="#f4f0e8" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M816 40 h-70 M816 40 v70" stroke="#f4f0e8" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M40 500 h70 M40 500 v-70" stroke="#08a39f" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M816 500 h-70 M816 500 v-70" stroke="#08a39f" strokeWidth="7" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function SelfiePortraitFrame({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 300 400"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <rect
        x="6"
        y="6"
        width="288"
        height="388"
        rx="22"
        fill="rgb(8 163 159 / 0.08)"
        stroke="#08a39f"
        strokeWidth="5"
        strokeDasharray="14 10"
      />
      <circle cx="150" cy="140" r="58" fill="none" stroke="#f4f0e8" strokeWidth="3" opacity="0.75" />
      <ellipse cx="150" cy="270" rx="78" ry="70" fill="none" stroke="#f4f0e8" strokeWidth="3" opacity="0.55" />
      <path d="M30 30 h50 M30 30 v50" stroke="#08a39f" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M270 30 h-50 M270 30 v50" stroke="#08a39f" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M30 370 h50 M30 370 v-50" stroke="#08a39f" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M270 370 h-50 M270 370 v-50" stroke="#08a39f" strokeWidth="5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
