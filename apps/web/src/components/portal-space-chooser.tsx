'use client';

import { Logo } from '@bhd-r/ui';
import { Link, useRouter } from '@/i18n/navigation';
import {
  managerPortalOf,
  persistPortalSpacePref,
} from '@/lib/portal-space-pref';
import type { PortalRole } from '@/lib/types';

/**
 * Full-screen pick between owner/developer workspace and tenant workspace
 * when the account holds both roles (shown at /portal).
 */
export function PortalSpaceChooser({
  locale,
  portals,
  preferred,
}: {
  locale: 'ar' | 'en';
  portals: PortalRole[];
  preferred: PortalRole | null;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const manager = managerPortalOf(portals);
  const hasTenant = portals.includes('tenant');
  const hasPlatform = portals.includes('platform');

  function enter(portal: PortalRole) {
    persistPortalSpacePref(portal);
    router.push(`/${portal}`);
  }

  return (
    <section className="space-chooser" dir={ar ? 'rtl' : 'ltr'}>
      <div className="space-chooser__card" role="dialog" aria-labelledby="space-chooser-title">
        <header className="space-chooser__head">
          <Logo descriptor={ar ? 'مساحتي' : 'Workspace'} />
          <h1 id="space-chooser-title">
            {ar ? 'أي مساحة تريد فتحها؟' : 'Which workspace do you want?'}
          </h1>
          <p>
            {ar
              ? 'يمكنك التبديل لاحقاً من الشريط أعلى الشاشة بين المالك والمستأجر.'
              : 'You can switch later between owner and tenant from the top bar.'}
          </p>
        </header>

        <div className="space-chooser__options">
          {manager ? (
            <button
              type="button"
              className={`space-chooser__option${
                preferred === manager ? ' space-chooser__option--preferred' : ''
              }`}
              onClick={() => enter(manager)}
            >
              <span className="space-chooser__mark" aria-hidden="true">
                {manager === 'developer' ? '◇' : '⌂'}
              </span>
              <strong>
                {manager === 'developer'
                  ? ar
                    ? 'نظام المطوّر'
                    : 'Developer system'
                  : ar
                    ? 'نظام المالك'
                    : 'Owner system'}
              </strong>
              <em>
                {manager === 'developer'
                  ? ar
                    ? 'إدارة المشاريع والوحدات والمبيعات.'
                    : 'Manage projects, units, and sales.'
                  : ar
                    ? 'عقاراتك، الحجوزات، العقود، التحصيل والصيانة.'
                    : 'Your properties, bookings, contracts, collections, and maintenance.'}
              </em>
            </button>
          ) : null}

          {hasTenant ? (
            <button
              type="button"
              className={`space-chooser__option${
                preferred === 'tenant' ? ' space-chooser__option--preferred' : ''
              }`}
              onClick={() => enter('tenant')}
            >
              <span className="space-chooser__mark" aria-hidden="true">
                ◎
              </span>
              <strong>{ar ? 'نظام المستأجر' : 'Tenant system'}</strong>
              <em>
                {ar
                  ? 'عقودك، الفواتير، الحجوزات، وطلبات الصيانة.'
                  : 'Your contracts, invoices, bookings, and maintenance requests.'}
              </em>
            </button>
          ) : null}
        </div>

        {preferred && (preferred === manager || preferred === 'tenant') ? (
          <p className="space-chooser__hint muted">
            {ar
              ? `آخر اختيار: ${preferred === 'tenant' ? 'المستأجر' : manager === 'developer' ? 'المطوّر' : 'المالك'}`
              : `Last choice: ${preferred === 'tenant' ? 'Tenant' : manager === 'developer' ? 'Developer' : 'Owner'}`}
          </p>
        ) : null}

        <div className="space-chooser__footer">
          {hasPlatform ? (
            <Link href="/platform" className="button button--quiet">
              {ar ? 'منصة الإدارة' : 'Platform admin'}
            </Link>
          ) : null}
          <Link href="/" className="button button--quiet">
            {ar ? 'الموقع العام' : 'Public site'}
          </Link>
        </div>
      </div>
    </section>
  );
}
