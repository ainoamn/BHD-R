'use client';

import { useRef, type FormEvent, type ReactNode } from 'react';
import { useHomeLiveSearch } from '@/components/home/home-live-search';
import { useRouter } from '@/i18n/navigation';

/**
 * GET search form that navigates as soon as any control changes (debounced).
 * On the home page (inside HomeLiveSearchProvider) it filters in place instead.
 */
export function AutoSubmitSearchForm({
  action,
  className,
  role,
  'aria-label': ariaLabel,
  children,
  debounceMs = 80,
}: {
  action: string;
  className?: string;
  role?: string;
  'aria-label'?: string;
  children: ReactNode;
  debounceMs?: number;
}) {
  const router = useRouter();
  const liveHome = useHomeLiveSearch();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function collectParams(form: HTMLFormElement): URLSearchParams {
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) params.set(key, trimmed);
    }
    return params;
  }

  function navigateFrom(form: HTMLFormElement) {
    const params = collectParams(form);
    if (liveHome) {
      const purposeRaw = params.get('purpose');
      const purpose = purposeRaw === 'sale' ? 'sale' : 'rent';
      liveHome.setQuery({
        kind: 'property',
        purpose,
        ...(params.get('countryCode') ? { countryCode: params.get('countryCode')! } : {}),
        ...(params.get('governorate') ? { governorate: params.get('governorate')! } : {}),
        ...(params.get('category') ? { category: params.get('category')! } : {}),
        ...(params.get('bedrooms') ? { bedrooms: params.get('bedrooms')! } : {}),
        ...(params.get('currency') ? { currency: params.get('currency')! } : {}),
      });
      return;
    }
    const query = params.toString();
    const base = action.startsWith('/') ? action : `/${action}`;
    router.push(query ? `${base}?${query}` : base);
  }

  function schedule(form: HTMLFormElement) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => navigateFrom(form), debounceMs);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (timerRef.current) clearTimeout(timerRef.current);
    navigateFrom(event.currentTarget);
  }

  return (
    <form
      action={action}
      method="get"
      className={className}
      role={role}
      aria-label={ariaLabel}
      onChange={(event) => schedule(event.currentTarget)}
      onSubmit={onSubmit}
    >
      {children}
    </form>
  );
}
