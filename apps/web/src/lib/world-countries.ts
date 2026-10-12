/**
 * Every country (ISO 3166-1 alpha-2) with its international dialling code. Names come from
 * `Intl.DisplayNames`, so Arabic and English stay correct without a hand-kept translation table.
 */
const DIAL_CODES =
  'AF93 AX358 AL355 DZ213 AS1 AD376 AO244 AI1 AG1 AR54 AM374 AW297 AU61 AT43 AZ994 BS1 BH973 BD880 ' +
  'BB1 BY375 BE32 BZ501 BJ229 BM1 BT975 BO591 BA387 BW267 BR55 IO246 VG1 BN673 BG359 BF226 BI257 ' +
  'KH855 CM237 CA1 CV238 BQ599 KY1 CF236 TD235 CL56 CN86 CX61 CC61 CO57 KM269 CG242 CD243 CK682 ' +
  'CR506 CI225 HR385 CU53 CW599 CY357 CZ420 DK45 DJ253 DM1 DO1 EC593 EG20 SV503 GQ240 ER291 EE372 ' +
  'SZ268 ET251 FK500 FO298 FJ679 FI358 FR33 GF594 PF689 GA241 GM220 GE995 DE49 GH233 GI350 GR30 ' +
  'GL299 GD1 GP590 GU1 GT502 GG44 GN224 GW245 GY592 HT509 HN504 HK852 HU36 IS354 IN91 ID62 IR98 ' +
  'IQ964 IE353 IM44 IT39 JM1 JP81 JE44 JO962 KZ7 KE254 KI686 XK383 KW965 KG996 LA856 LV371 LB961 ' +
  'LS266 LR231 LY218 LI423 LT370 LU352 MO853 MG261 MW265 MY60 MV960 ML223 MT356 MH692 MQ596 MR222 ' +
  'MU230 YT262 MX52 FM691 MD373 MC377 MN976 ME382 MS1 MA212 MZ258 MM95 NA264 NR674 NP977 NL31 ' +
  'NC687 NZ64 NI505 NE227 NG234 NU683 NF672 KP850 MK389 MP1 NO47 OM968 PK92 PW680 PS970 PA507 ' +
  'PG675 PY595 PE51 PH63 PL48 PT351 PR1 QA974 RE262 RO40 RU7 RW250 BL590 SH290 KN1 LC1 MF590 ' +
  'PM508 VC1 WS685 SM378 ST239 SA966 SN221 RS381 SC248 SL232 SG65 SX1 SK421 SI386 SB677 SO252 ' +
  'ZA27 KR82 SS211 ES34 LK94 SD249 SR597 SJ47 SE46 CH41 SY963 TW886 TJ992 TZ255 TH66 TL670 TG228 ' +
  'TK690 TO676 TT1 TN216 TR90 TM993 TC1 TV688 UG256 UA380 AE971 GB44 US1 UY598 UZ998 VU678 VA39 ' +
  'VE58 VN84 VI1 WF681 EH212 YE967 ZM260 ZW263';

export type WorldCountry = { code: string; dial: string; nameAr: string; nameEn: string };

/** Gulf first, then everyone else alphabetically in the reader's language. */
const PINNED = ['OM', 'AE', 'SA', 'QA', 'KW', 'BH'];

let cache: WorldCountry[] | null = null;

function displayName(names: Intl.DisplayNames | null, code: string): string {
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function worldCountries(): WorldCountry[] {
  if (cache) return cache;
  const make = (locale: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return null;
    }
  };
  const ar = make('ar');
  const en = make('en');
  cache = DIAL_CODES.split(' ').map((entry) => {
    const code = entry.slice(0, 2);
    return {
      code,
      dial: entry.slice(2),
      nameAr: displayName(ar, code),
      nameEn: displayName(en, code),
    };
  });
  return cache;
}

export function sortedCountries(locale: 'ar' | 'en'): WorldCountry[] {
  const key = locale === 'ar' ? 'nameAr' : 'nameEn';
  const pinned = PINNED.map((code) => worldCountries().find((row) => row.code === code)!);
  const rest = worldCountries()
    .filter((row) => !PINNED.includes(row.code))
    .sort((a, b) => a[key].localeCompare(b[key], locale));
  return [...pinned, ...rest];
}

export function countryByCode(code: string | null | undefined): WorldCountry | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return worldCountries().find((row) => row.code === upper) ?? null;
}

export function countryName(code: string | null | undefined, locale: 'ar' | 'en'): string {
  const row = countryByCode(code);
  if (!row) return code ?? '';
  return locale === 'ar' ? row.nameAr : row.nameEn;
}

export function isCountryCode(code: string): boolean {
  return countryByCode(code) !== null;
}

/** Turn a "+<dial> <number>" pair into E.164 digits with a leading plus. */
export function joinPhone(dial: string, local: string): string {
  const digits = local.replace(/\D/g, '').replace(/^0+/, '');
  return digits ? `+${dial}${digits}` : '';
}

/** Split a stored E.164 number back into the longest matching dial code and the local part. */
export function splitPhone(value: string, fallbackDial = '968'): { dial: string; local: string } {
  const digits = value.replace(/\D/g, '');
  if (!value.trim().startsWith('+') || !digits) return { dial: fallbackDial, local: digits };
  const dials = [...new Set(worldCountries().map((row) => row.dial))].sort(
    (a, b) => b.length - a.length,
  );
  const dial = dials.find((code) => digits.startsWith(code));
  return dial ? { dial, local: digits.slice(dial.length) } : { dial: fallbackDial, local: digits };
}

/** Older numbers were saved without a country code; 8 digits are an Omani local number. */
export function toInternationalPhone(
  value: string | null | undefined,
  defaultDial = '968',
): string {
  const trimmed = (value ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.length === 8) return `+${defaultDial}${digits}`;
  return `+${digits}`;
}

/** E.164: plus sign, 8–15 digits in total. */
export function isInternationalPhone(value: string): boolean {
  return /^\+\d{8,15}$/.test(value.trim());
}
