import React, { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortalMainSlot } from '@/components/portal-main-slot';
import { PortalPage } from '@/components/portal-page';
import { PortalRoutePrefetch, portalPrefetchHref } from '@/components/portal-route-prefetch';
import { portalNavHrefs } from '@/lib/portal-nav-paths';

const nav = vi.hoisted(() => ({
  pathname: '/owner',
  prefetch: vi.fn<(href: string, options?: { onInvalidate?: () => void }) => void>(),
}));
const router = { prefetch: nav.prefetch };
vi.mock('@/i18n/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => router }));
vi.mock('@/lib/portal-ops-client-cache', () => ({
  OPS_WARM_DONE_EVENT: 'warm-done',
  warmOpsSection: vi.fn(async () => ({ records: [] })),
}));
vi.mock('@/components/operations-workspace-client', () => ({
  OperationsWorkspaceClient: ({ section }: { section: string }) => <input aria-label={section} />,
}));
function Form({ label }: { label: string }) {
  const [value, setValue] = useState('');
  return <input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} />;
}
function page(path: string, label = path) {
  return (
    <PortalMainSlot portal="owner" locale="en">
      <PortalPage key={path} path={path}>
        <Form label={label} />
      </PortalPage>
    </PortalMainSlot>
  );
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  nav.pathname = '/owner';
});

describe('persistent portal pages', () => {
  it('keeps the same input node and draft across detail, ops and edit routes', () => {
    nav.pathname = '/owner/properties/one/edit';
    const view = render(page(nav.pathname));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'unsaved property' } });
    nav.pathname = '/owner/invoices';
    view.rerender(page('/owner/properties/one/edit'));
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-label', 'invoices');
    nav.pathname = '/owner/stays/calendar';
    view.rerender(page(nav.pathname));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    nav.pathname = '/owner/properties/one/edit';
    view.rerender(page(nav.pathname));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveValue('unsaved property');
  });
  it('does not evict a draft after visiting more than twelve pages', () => {
    const view = render(page('/owner'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'draft' } });
    for (let index = 0; index < 15; index++) {
      nav.pathname = `/owner/properties/${index}`;
      view.rerender(page(nav.pathname));
    }
    nav.pathname = '/owner';
    view.rerender(page(nav.pathname));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveValue('draft');
  });
  it('merges refreshed content without remounting the form', () => {
    const view = render(page('/owner', 'before'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'draft' } });
    view.rerender(page('/owner', 'updated data'));
    expect(screen.getByRole('textbox', { name: 'updated data' })).toBe(input);
    expect(input).toHaveValue('draft');
  });
  it('does not label a late response as the currently selected page', () => {
    const view = render(page('/owner'));
    nav.pathname = '/owner/stays/calendar';
    view.rerender(page('/owner'));
    expect(screen.queryByRole('textbox')).toBeNull();
    view.rerender(page(nav.pathname));
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-label', nav.pathname);
  });
});

describe('background prefetch', () => {
  it('only accepts same-origin portal pages', () => {
    const origin = 'https://r.bhd-om.com';
    expect(portalPrefetchHref('/ar/owner/properties/123/edit', origin, 'owner')).toBe(
      '/owner/properties/123/edit',
    );
    for (const href of [
      'https://id.bhd-om.com/account',
      '/api/auth/logout',
      'javascript:alert(1)',
      '/owner-other',
      '/tenant',
    ]) {
      expect(portalPrefetchHref(href, origin, 'owner')).toBeNull();
    }
  });
  it('warms every sidebar route under StrictMode and discovers internal form links', async () => {
    vi.useFakeTimers();
    render(
      <StrictMode>
        <div className="portal-layout">
          <a href="/ar/owner/properties/123/edit">Edit</a>
          <PortalRoutePrefetch portal="owner" staysEnabled />
        </div>
      </StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    const hrefs = nav.prefetch.mock.calls.map((args) => args[0]);
    for (const href of portalNavHrefs('owner', true)) expect(hrefs).toContain(href);
    expect(hrefs).toContain('/owner/properties/123/edit');
    const count = hrefs.length;
    cleanup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(nav.prefetch).toHaveBeenCalledTimes(count);
  });
});
