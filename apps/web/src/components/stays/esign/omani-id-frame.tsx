/**
 * Alignment silhouettes for Omani civil ID (ID-1) + selfie.
 * Layout mirrors the real card: portrait on the left (front), chip + MRZ (back).
 * No personal data — translucent guides only.
 */

export function OmaniIdFrame({ side, className }: { side: 'front' | 'back'; className?: string }) {
  if (side === 'back') {
    return (
      <svg
        className={className}
        viewBox="0 0 856 540"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id="oman-id-back-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(244 247 250 / 0.22)" />
            <stop offset="100%" stopColor="rgb(220 230 236 / 0.18)" />
          </linearGradient>
        </defs>
        <rect
          x="10"
          y="10"
          width="836"
          height="520"
          rx="26"
          fill="url(#oman-id-back-bg)"
          stroke="#08a39f"
          strokeWidth="5"
        />
        {/* Contact chip — left, as on the real card back */}
        <rect
          x="48"
          y="150"
          width="118"
          height="92"
          rx="10"
          fill="rgb(212 175 55 / 0.55)"
          stroke="#c9a227"
          strokeWidth="2.5"
        />
        <rect x="66" y="168" width="82" height="56" rx="4" fill="rgb(255 255 255 / 0.18)" />
        <path
          d="M74 180 h66 M74 194 h66 M74 208 h66"
          stroke="#f4f0e8"
          strokeWidth="2"
          opacity="0.75"
        />
        {/* Header band */}
        <rect x="10" y="10" width="836" height="78" rx="26" fill="rgb(23 75 112 / 0.38)" />
        <rect x="10" y="56" width="836" height="32" fill="rgb(8 163 159 / 0.28)" />
        <text
          x="48"
          y="48"
          fontSize="22"
          fill="#f4f0e8"
          fontFamily="system-ui,sans-serif"
          fontWeight="700"
        >
          البطاقة الشخصية — الوجه الخلفي
        </text>
        <text x="48" y="78" fontSize="15" fill="#d7ebe8" fontFamily="system-ui,sans-serif">
          IDENTITY CARD — BACK · محاذاة الشريحة ومنطقة MRZ
        </text>
        {/* Name / address field blocks */}
        <rect x="200" y="120" width="580" height="36" rx="6" fill="rgb(255 255 255 / 0.2)" />
        <rect x="200" y="170" width="480" height="28" rx="6" fill="rgb(255 255 255 / 0.14)" />
        <rect x="200" y="214" width="520" height="28" rx="6" fill="rgb(255 255 255 / 0.12)" />
        <rect x="200" y="258" width="420" height="28" rx="6" fill="rgb(255 255 255 / 0.1)" />
        {/* MRZ zone */}
        <rect x="28" y="330" width="800" height="170" rx="12" fill="rgb(26 36 48 / 0.55)" />
        <text
          x="48"
          y="362"
          fontSize="16"
          fill="#9ec9c4"
          fontFamily="ui-monospace,monospace"
          opacity="0.9"
        >
          منطقة القراءة الآلية · MRZ
        </text>
        {[0, 1, 2].map((row) => (
          <g key={row}>
            {Array.from({ length: 30 }).map((_, i) => (
              <rect
                key={i}
                x={48 + i * 25}
                y={388 + row * 32}
                width={i % 4 === 0 ? 14 : i % 3 === 0 ? 10 : 7}
                height="18"
                rx="2"
                fill="#e8f2ef"
                opacity={0.45 + (i % 5) * 0.06}
              />
            ))}
          </g>
        ))}
        <CornerMarks />
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
      <defs>
        <linearGradient id="oman-id-front-bg" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="rgb(255 248 252 / 0.2)" />
          <stop offset="55%" stopColor="rgb(232 244 240 / 0.16)" />
          <stop offset="100%" stopColor="rgb(210 228 236 / 0.18)" />
        </linearGradient>
      </defs>
      <rect
        x="10"
        y="10"
        width="836"
        height="520"
        rx="26"
        fill="url(#oman-id-front-bg)"
        stroke="#08a39f"
        strokeWidth="5"
      />
      {/* Header */}
      <rect x="10" y="10" width="836" height="96" rx="26" fill="rgb(23 75 112 / 0.36)" />
      <rect x="10" y="78" width="836" height="28" fill="rgb(8 163 159 / 0.32)" />
      {/* Emblem placeholder — top right */}
      <circle cx="780" cy="52" r="26" fill="rgb(196 60 52 / 0.55)" />
      <path
        d="M780 38 v20 M770 48 h20"
        stroke="#f4f0e8"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <text
        x="428"
        y="48"
        textAnchor="middle"
        fontSize="26"
        fill="#f4f0e8"
        fontFamily="system-ui,sans-serif"
        fontWeight="700"
      >
        سلطنة عُمان
      </text>
      <text
        x="428"
        y="74"
        textAnchor="middle"
        fontSize="14"
        fill="#d7ebe8"
        fontFamily="system-ui,sans-serif"
        letterSpacing="1.2"
      >
        SULTANATE OF OMAN
      </text>
      <text
        x="48"
        y="98"
        fontSize="15"
        fill="#e8f2ef"
        fontFamily="system-ui,sans-serif"
        fontWeight="600"
      >
        البطاقة الشخصية · IDENTITY CARD — FRONT
      </text>
      {/* Portrait — LEFT (matches real Omani civil ID) */}
      <rect
        x="40"
        y="130"
        width="200"
        height="250"
        rx="12"
        fill="rgb(247 250 248 / 0.14)"
        stroke="#08a39f"
        strokeWidth="4"
        strokeDasharray="10 8"
      />
      <circle cx="140" cy="210" r="48" fill="rgb(197 213 208 / 0.4)" />
      <ellipse cx="140" cy="310" rx="68" ry="52" fill="rgb(197 213 208 / 0.32)" />
      <text
        x="140"
        y="392"
        textAnchor="middle"
        fontSize="15"
        fill="#e8f2ef"
        fontFamily="system-ui,sans-serif"
        opacity="0.9"
      >
        الصورة · PHOTO
      </text>
      {/* Signature under photo */}
      <rect
        x="40"
        y="410"
        width="200"
        height="70"
        rx="8"
        fill="rgb(255 255 255 / 0.12)"
        stroke="#a8b6c0"
        strokeWidth="2"
        strokeDasharray="6 5"
      />
      <text x="52" y="438" fontSize="13" fill="#c5d4ce" fontFamily="system-ui,sans-serif">
        SIGNATURE / التوقيع
      </text>
      <path
        d="M58 458 q28 -18 56 0 t56 4"
        fill="none"
        stroke="#e8f2ef"
        strokeWidth="2.5"
        opacity="0.65"
      />
      {/* Field column */}
      <rect x="270" y="130" width="300" height="26" rx="5" fill="rgb(255 255 255 / 0.22)" />
      <rect x="270" y="170" width="260" height="22" rx="5" fill="rgb(255 255 255 / 0.16)" />
      <rect x="270" y="206" width="280" height="22" rx="5" fill="rgb(255 255 255 / 0.16)" />
      <rect x="270" y="242" width="240" height="22" rx="5" fill="rgb(255 255 255 / 0.14)" />
      <rect x="270" y="278" width="250" height="22" rx="5" fill="rgb(255 255 255 / 0.14)" />
      <rect x="270" y="320" width="360" height="48" rx="8" fill="rgb(255 255 255 / 0.18)" />
      <text x="282" y="350" fontSize="16" fill="#e8f2ef" fontFamily="system-ui,sans-serif" opacity="0.85">
        الاسم · NAME
      </text>
      {/* Ghost circular seal on right */}
      <circle
        cx="720"
        cy="260"
        r="70"
        fill="rgb(8 163 159 / 0.08)"
        stroke="#08a39f"
        strokeWidth="2"
        strokeDasharray="6 6"
        opacity="0.7"
      />
      <circle cx="720" cy="240" r="22" fill="rgb(197 213 208 / 0.28)" />
      <ellipse cx="720" cy="285" rx="28" ry="22" fill="rgb(197 213 208 / 0.22)" />
      <CornerMarks />
    </svg>
  );
}

function CornerMarks() {
  return (
    <>
      <path
        d="M40 40 h70 M40 40 v70"
        stroke="#f4f0e8"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M816 40 h-70 M816 40 v70"
        stroke="#f4f0e8"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M40 500 h70 M40 500 v-70"
        stroke="#08a39f"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M816 500 h-70 M816 500 v-70"
        stroke="#08a39f"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
    </>
  );
}

/** Filled person silhouette for selfie alignment (passport-style head+shoulders). */
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
        fill="rgb(8 163 159 / 0.1)"
        stroke="#08a39f"
        strokeWidth="5"
        strokeDasharray="14 10"
      />
      {/* Soft vignette oval */}
      <ellipse
        cx="150"
        cy="185"
        rx="108"
        ry="148"
        fill="none"
        stroke="#f4f0e8"
        strokeWidth="2"
        opacity="0.35"
        strokeDasharray="8 7"
      />
      {/* Person silhouette */}
      <g fill="rgb(244 240 232 / 0.42)" stroke="#f4f0e8" strokeWidth="2.5">
        <circle cx="150" cy="132" r="52" />
        <path d="M62 340 C72 250 110 220 150 220 C190 220 228 250 238 340 Z" />
      </g>
      <text
        x="150"
        y="372"
        textAnchor="middle"
        fontSize="14"
        fill="#e8f2ef"
        fontFamily="system-ui,sans-serif"
        opacity="0.9"
      >
        ضع وجهك هنا · Face here
      </text>
      <path
        d="M30 30 h50 M30 30 v50"
        stroke="#08a39f"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M270 30 h-50 M270 30 v50"
        stroke="#08a39f"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M30 370 h50 M30 370 v-50"
        stroke="#08a39f"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M270 370 h-50 M270 370 v-50"
        stroke="#08a39f"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
