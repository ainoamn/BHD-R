'use client';

import { useRef, type FormEvent, type ReactNode } from 'react';
import { useRouter } from '@/i18n/navigation';

/**
 * GET search form that navigates as soon as any control changes (debounced).
 * Keeps an explicit submit for keyboard / accessibility.
 */
export function AutoSubmitSearchForm({
  action,
  className,
  role,
  'aria-label': ariaLabel,
  children,
  debounceMs = 280,
}: {
  action: string;
  className?: string;
  role?: string;
  'aria-label'?: string;
  children: ReactNode;
  debounceMs?: number;
}) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function navigateFrom(form: HTMLFormElement) {
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) params.set(key, trimmed);
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
