import { defaultLocale, locales } from '@bhd-r/i18n';
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({ locales, defaultLocale, localePrefix: 'always' });
