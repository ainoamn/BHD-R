import 'server-only';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readSessionClaimsFromCookies } from '@/lib/stay-setup-session';
import type { StaySetupPropertySummary } from '@/lib/stay-setup-neon';
import { loadStaySetupContextOnNeon } from '@/lib/stay-setup-neon';
import type { StaySetupContext } from '@bhd-r/contracts';
import { ApiError, apiFetch } from '@/lib/server-api';

export type { StaySetupPropertySummary };

export type StaySetupLoadResult = {
  context: StaySetupContext | null;
  propertySummary: StaySetupPropertySummary | null;
  /** True when Vercel can persist setup steps directly to Neon. */
  writeAvailable: boolean;
  apiAvailable: boolean;
  apiHint: string | null;
  source: 'nest' | 'neon' | 'none';
};

export async function loadStaySetupPageData(
  propertyId: string | null | undefined,
  locale: 'ar' | 'en',
): Promise<StaySetupLoadResult> {
  const writeAvailable = hasDatabaseUrl();
  let apiAvailable = false;
  let apiHint: string | null = null;

  if (!propertyId) {
    return {
      context: null,
      propertySummary: null,
      writeAvailable,
      apiAvailable,
      apiHint,
      source: 'none',
    };
  }

  if (writeAvailable) {
    try {
      const claims = await readSessionClaimsFromCookies();
      if (!claims?.organizationId) {
        return {
          context: null,
          propertySummary: null,
          writeAvailable,
          apiAvailable: false,
          apiHint:
            locale === 'ar'
              ? 'اختر مؤسسة أولاً أو سجّل الدخول.'
              : 'Select an organization or sign in.',
          source: 'none',
        };
      }
      const loaded = await loadStaySetupContextOnNeon(claims, propertyId);
      return {
        context: loaded.context,
        propertySummary: loaded.summary,
        writeAvailable: true,
        apiAvailable: true,
        apiHint: null,
        source: 'neon',
      };
    } catch (error) {
      const neonMsg = error instanceof Error ? error.message : 'neon_failed';
      apiHint =
        locale === 'ar'
          ? `تعذر تحميل بيانات العقار من قاعدة البيانات (${neonMsg}).`
          : `Could not load property from database (${neonMsg}).`;
    }
  }

  try {
    const health = await apiFetch<{ ok?: boolean }>('/v1/stays/inventory/health');
    apiAvailable = Boolean(health?.ok ?? health);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        apiHint =
          locale === 'ar'
            ? 'Nest يرفض المؤسسة (STAYS_ORG_ALLOWLIST). ضع * أو أعد نشر Nest 0.4.20+.'
            : 'Nest rejected this organization (STAYS_ORG_ALLOWLIST).';
      } else if (error.status === 401) {
        apiHint =
          locale === 'ar'
            ? 'الجلسة غير مقبولة لدى Nest — سجّل الخروج ثم الدخول.'
            : 'Nest rejected the session — sign out and back in.';
      } else if (error.status === 404) {
        apiHint =
          locale === 'ar'
            ? 'STAYS_PLATFORM_ENABLED مغلق على Render.'
            : 'STAYS_PLATFORM_ENABLED is off on Render.';
      } else if (!apiHint) {
        apiHint =
          locale === 'ar'
            ? `Nest غير جاهز (${error.status}).`
            : `Nest unavailable (${error.status}).`;
      }
    } else if (!apiHint) {
      apiHint = locale === 'ar' ? 'تعذر الوصول إلى Nest.' : 'Could not reach Nest.';
    }
  }

  try {
    const context = await apiFetch<StaySetupContext>(
      `/v1/stays/setup/context?propertyId=${encodeURIComponent(propertyId)}`,
    );
    return {
      context,
      propertySummary: null,
      writeAvailable,
      apiAvailable: true,
      apiHint: null,
      source: 'nest',
    };
  } catch (error) {
    const nestDetail =
      error instanceof ApiError
        ? `${error.status}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'unknown';

    if (!apiHint) {
      apiHint =
        locale === 'ar'
          ? `تعذر تحميل بيانات العقار — ${nestDetail}`
          : `Could not load property — ${nestDetail}`;
    }

    return {
      context: null,
      propertySummary: null,
      writeAvailable,
      apiAvailable,
      apiHint,
      source: 'none',
    };
  }
}
