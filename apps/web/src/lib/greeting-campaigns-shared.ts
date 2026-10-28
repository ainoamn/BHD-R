/** Scheduled AI greeting / occasion campaigns for the site console. */

export const GREETING_CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'cancelled',
] as const;
export type GreetingCampaignStatus = (typeof GREETING_CAMPAIGN_STATUSES)[number];

export const GREETING_ROLES = ['all', 'tenant', 'owner', 'staff'] as const;
export type GreetingRole = (typeof GREETING_ROLES)[number];

export const GREETING_GENDERS = ['male', 'female'] as const;
export type GreetingGender = (typeof GREETING_GENDERS)[number];

export const GREETING_AGES = ['youth', 'adult', 'senior'] as const;
export type GreetingAge = (typeof GREETING_AGES)[number];

/** Target filters — empty fields mean “no restriction on this axis”. */
export type GreetingAudience = {
  locales: Array<'ar' | 'en'>;
  roles: GreetingRole[];
  /** ISO country codes, plus `OM` and `expat` (any non-OM). */
  nationalities: string[];
  genders: GreetingGender[];
  ages: GreetingAge[];
};

export type GreetingDesignVersion = {
  id: string;
  createdAt: string;
  /** Admin note / change request that shaped this version. */
  promptNote: string | null;
  headlineAr: string;
  headlineEn: string;
  bodyAr: string;
  bodyEn: string;
  accent: string;
  accentSoft: string;
  motif: string;
  imagePrompt: string;
  /** Text-only SVG fallback when raster generation is unavailable. */
  svg: string;
  /** Photorealistic AI card (JPEG/PNG/WebP), preferred over `svg`. */
  imageMime: string | null;
  imageBase64: string | null;
};

export type GreetingCampaign = {
  id: string;
  occasion: string;
  /** Calendar date in Asia/Muscat (YYYY-MM-DD). */
  occasionDate: string;
  meaning: string;
  audience: GreetingAudience;
  status: GreetingCampaignStatus;
  /** When to dispatch (ISO). Defaults to occasion date 09:00 Muscat if scheduled without time. */
  scheduledAt: string | null;
  sentAt: string | null;
  sentCount: number;
  currentDesignId: string | null;
  designs: GreetingDesignVersion[];
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
};

export type GreetingCampaignsStore = {
  campaigns: GreetingCampaign[];
  updatedAt: string;
};

export type GreetingAudienceEstimate = {
  matched: number;
  sample: Array<{ name: string; email: string; locale: string }>;
};

export function emptyGreetingAudience(): GreetingAudience {
  return { locales: [], roles: [], nationalities: [], genders: [], ages: [] };
}

export function isGreetingAudience(value: unknown): value is GreetingAudience {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    Array.isArray(row.locales) &&
    Array.isArray(row.roles) &&
    Array.isArray(row.nationalities) &&
    Array.isArray(row.genders) &&
    Array.isArray(row.ages)
  );
}

export const GREETING_AUDIENCE_PRESETS: Array<{
  id: string;
  ar: string;
  en: string;
  apply: (audience: GreetingAudience) => GreetingAudience;
}> = [
  {
    id: 'all',
    ar: 'الكل',
    en: 'Everyone',
    apply: () => emptyGreetingAudience(),
  },
  {
    id: 'ar',
    ar: 'العربية',
    en: 'Arabic locale',
    apply: (a) => ({ ...a, locales: uniq([...a.locales, 'ar']) }),
  },
  {
    id: 'en',
    ar: 'الإنجليزية',
    en: 'English locale',
    apply: (a) => ({ ...a, locales: uniq([...a.locales, 'en']) }),
  },
  {
    id: 'tenant',
    ar: 'المستأجرون',
    en: 'Tenants',
    apply: (a) => ({ ...a, roles: uniqRoles([...a.roles, 'tenant']) }),
  },
  {
    id: 'owner',
    ar: 'الملّاك',
    en: 'Owners',
    apply: (a) => ({ ...a, roles: uniqRoles([...a.roles, 'owner']) }),
  },
  {
    id: 'staff',
    ar: 'الفريق',
    en: 'Staff',
    apply: (a) => ({ ...a, roles: uniqRoles([...a.roles, 'staff']) }),
  },
  {
    id: 'omani',
    ar: 'العمانيون',
    en: 'Omani',
    apply: (a) => ({ ...a, nationalities: uniq([...a.nationalities, 'OM']) }),
  },
  {
    id: 'expat',
    ar: 'الوافدون',
    en: 'Expats',
    apply: (a) => ({ ...a, nationalities: uniq([...a.nationalities, 'expat']) }),
  },
  {
    id: 'male',
    ar: 'الرجال',
    en: 'Men',
    apply: (a) => ({ ...a, genders: uniqGenders([...a.genders, 'male']) }),
  },
  {
    id: 'female',
    ar: 'النساء',
    en: 'Women',
    apply: (a) => ({ ...a, genders: uniqGenders([...a.genders, 'female']) }),
  },
  {
    id: 'youth',
    ar: 'الشباب',
    en: 'Youth',
    apply: (a) => ({ ...a, ages: uniqAges([...a.ages, 'youth']) }),
  },
  {
    id: 'adult',
    ar: 'البالغون',
    en: 'Adults',
    apply: (a) => ({ ...a, ages: uniqAges([...a.ages, 'adult']) }),
  },
  {
    id: 'senior',
    ar: 'كبار السن',
    en: 'Seniors',
    apply: (a) => ({ ...a, ages: uniqAges([...a.ages, 'senior']) }),
  },
];

function uniq<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}
function uniqRoles(values: GreetingRole[]): GreetingRole[] {
  return uniq(values);
}
function uniqGenders(values: GreetingGender[]): GreetingGender[] {
  return uniq(values);
}
function uniqAges(values: GreetingAge[]): GreetingAge[] {
  return uniq(values);
}

export function audienceSummary(audience: GreetingAudience, ar: boolean): string {
  const parts: string[] = [];
  if (
    !audience.locales.length &&
    !audience.roles.length &&
    !audience.nationalities.length &&
    !audience.genders.length &&
    !audience.ages.length
  ) {
    return ar ? 'الكل' : 'Everyone';
  }
  if (audience.locales.length) {
    parts.push(
      audience.locales
        .map((l) => (l === 'ar' ? (ar ? 'عربي' : 'Arabic') : ar ? 'إنجليزي' : 'English'))
        .join('/'),
    );
  }
  if (audience.roles.length && !audience.roles.includes('all')) {
    const map: Record<string, [string, string]> = {
      tenant: ['مستأجرون', 'tenants'],
      owner: ['ملّاك', 'owners'],
      staff: ['فريق', 'staff'],
    };
    parts.push(audience.roles.map((r) => (ar ? map[r]?.[0] : map[r]?.[1]) ?? r).join('/'));
  }
  if (audience.nationalities.length) {
    parts.push(
      audience.nationalities
        .map((code) =>
          code === 'OM'
            ? ar
              ? 'عمانيون'
              : 'Omani'
            : code === 'expat'
              ? ar
                ? 'وافدون'
                : 'expats'
              : code,
        )
        .join('/'),
    );
  }
  if (audience.genders.length) {
    parts.push(
      audience.genders
        .map((g) => (g === 'male' ? (ar ? 'رجال' : 'men') : ar ? 'نساء' : 'women'))
        .join('/'),
    );
  }
  if (audience.ages.length) {
    const map: Record<GreetingAge, [string, string]> = {
      youth: ['شباب', 'youth'],
      adult: ['بالغون', 'adults'],
      senior: ['كبار', 'seniors'],
    };
    parts.push(audience.ages.map((a) => (ar ? map[a][0] : map[a][1])).join('/'));
  }
  return parts.join(' · ');
}
