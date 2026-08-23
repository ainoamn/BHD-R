import { isAppLocale, messages } from '@bhd-r/i18n';
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ requestLocale }) => {
  const candidate = (await requestLocale) ?? 'ar';
  const locale = isAppLocale(candidate) ? candidate : 'ar';
  return { locale, messages: messages[locale] };
});
