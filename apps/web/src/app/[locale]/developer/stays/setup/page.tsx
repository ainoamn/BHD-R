import { notFound } from 'next/navigation';
import { StaySetupWizard } from '@/components/stays/stay-setup-wizard';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { ApiError, apiFetch } from '@/lib/server-api';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ propertyId?: string }>;
}) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const { propertyId } = await searchParams;

  let apiAvailable = false;
  let apiHint: string | null = null;
  try {
    const health = await apiFetch<{ ok?: boolean }>('/v1/stays/inventory/health');
    apiAvailable = Boolean(health?.ok ?? health);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        apiHint =
          locale === 'ar'
            ? 'واجهة الإقامات على Nest ترفض المؤسسة (STAYS_ORG_ALLOWLIST). أعد نشر Nest من main بعد 0.4.20 أو ضع * في Render.'
            : 'Nest stays rejected this organization (STAYS_ORG_ALLOWLIST). Redeploy Nest from main (0.4.20+) or set * on Render.';
      } else if (error.status === 401) {
        apiHint =
          locale === 'ar'
            ? 'الجلسة غير مقبولة لدى Nest — سجّل الخروج ثم الدخول مجدداً.'
            : 'Nest rejected the session — sign out and sign in again.';
      } else if (error.status === 404) {
        apiHint =
          locale === 'ar'
            ? 'STAYS_PLATFORM_ENABLED ما زال مغلقاً على Render (Nest). فعّله وأعد النشر.'
            : 'STAYS_PLATFORM_ENABLED is still off on Render (Nest). Enable it and redeploy.';
      } else {
        apiHint =
          locale === 'ar'
            ? `تعذر الاتصال بواجهة الإقامات (Nest ${error.status}).`
            : `Stays API unreachable (Nest ${error.status}).`;
      }
    } else {
      apiHint =
        locale === 'ar'
          ? 'تعذر الوصول إلى Nest — تحقق من Render ثم أعد المحاولة.'
          : 'Could not reach Nest — check Render and retry.';
    }
  }

  return (
    <StaySetupWizard
      locale={locale}
      portal="developer"
      propertyId={propertyId ?? null}
      apiAvailable={apiAvailable}
      apiHint={apiHint}
    />
  );
}
