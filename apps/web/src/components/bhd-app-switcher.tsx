'use client';

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { browserNextMutation } from '@/lib/api';
import {
  accountHandle,
  accountMeta,
  type AuthProvider,
  type RosterAccount,
} from '@/lib/bhd/account-roster-shared';
import {
  BHD_APPS,
  hopOrigins,
  launchUrlForApp,
  type BhdApp,
} from '@/lib/bhd/apps';
import { roleLabel, type OrganizationChoice } from '@/lib/team-shared';
import type { Viewer } from '@/lib/types';

type Panel = 'apps' | 'account' | null;

type SwitcherPerson = {
  sub?: string;
  name: string;
  email: string;
  username?: string | null;
  phone?: string | null;
  picture: string | null;
  providers?: AuthProvider[];
};

const IDENTITY_ORIGIN = 'https://id.bhd-om.com';

const PROVIDER_LABEL: Record<AuthProvider, { mark: string; ar: string; en: string }> = {
  password: { mark: '●', ar: 'تسجيل عادي', en: 'Password' },
  google: { mark: 'G', ar: 'جوجل', en: 'Google' },
  facebook: { mark: 'f', ar: 'فيسبوك', en: 'Facebook' },
  whatsapp: { mark: 'WA', ar: 'واتساب', en: 'WhatsApp' },
};

function isCurrentApp(app: BhdApp, pageOrigin: string): boolean {
  const here = pageOrigin.replace(/\/$/, '');
  if (app.id === 'bhd-r' || app.clientId === 'bhd-r') {
    return (
      here === 'https://r.bhd-om.com' ||
      here.endsWith('.vercel.app') ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(here)
    );
  }
  return Boolean(app.origin) && here === app.origin.replace(/\/$/, '');
}

/** BHD-ACCOUNT-SWITCHER §5 — warm product origins and workspace documents. */
function hintHop(url: string) {
  if (!url || typeof document === 'undefined') return;
  if (url.startsWith('/')) {
    if (!document.head.querySelector(`link[data-bhd-prefetch="${url}"]`)) {
      const prefetch = document.createElement('link');
      prefetch.rel = 'prefetch';
      prefetch.as = 'document';
      prefetch.href = url;
      prefetch.setAttribute('data-bhd-prefetch', url);
      document.head.appendChild(prefetch);
    }
    return;
  }
  try {
    const origin = new URL(url, window.location.origin).origin;
    if (!document.head.querySelector(`link[data-bhd-hop="${origin}"]`)) {
      const pre = document.createElement('link');
      pre.rel = 'preconnect';
      pre.href = origin;
      pre.setAttribute('data-bhd-hop', origin);
      document.head.appendChild(pre);
    }
    if (!document.head.querySelector(`link[data-bhd-prefetch="${url}"]`)) {
      const prefetch = document.createElement('link');
      prefetch.rel = 'prefetch';
      prefetch.as = 'document';
      prefetch.href = url;
      prefetch.setAttribute('data-bhd-prefetch', url);
      document.head.appendChild(prefetch);
    }
  } catch {
    /* ignore bad urls */
  }
}

function openApp(app: BhdApp, pageOrigin: string, push: (href: string) => void) {
  const url = launchUrlForApp(app, pageOrigin);
  if (url.startsWith('/')) {
    push(url);
    return;
  }
  try {
    const target = new URL(url);
    if (target.origin === window.location.origin) {
      push(`${target.pathname}${target.search}${target.hash}`);
      return;
    }
  } catch {
    /* fall through */
  }
  window.location.assign(url);
}

function rosterFromIdentityAccounts(
  items: Array<{
    id?: string;
    email?: string;
    name?: string;
    username?: string | null;
    phone?: string | null;
    picture?: string | null;
    providers?: AuthProvider[];
  }>,
): RosterAccount[] {
  return items
    .filter((item) => typeof item.id === 'string' && item.id.length >= 8)
    .map((item) => ({
      sub: item.id!,
      name: item.name || item.email || 'BHD',
      email: (item.email || '').toLowerCase(),
      username: item.username || null,
      phone: item.phone || null,
      picture: item.picture || null,
      providers: item.providers?.length ? item.providers : (['password'] as AuthProvider[]),
    }));
}

function toPerson(account: RosterAccount): SwitcherPerson {
  return {
    sub: account.sub,
    name: account.name,
    email: account.email,
    username: account.username,
    phone: account.phone,
    picture: account.picture,
    providers: account.providers,
  };
}

function ProviderMarks({ providers, ar }: { providers: AuthProvider[]; ar: boolean }) {
  if (!providers.length) return null;
  return (
    <span className="bhd-switcher-providers">
      {providers.slice(0, 1).map((id) => {
        const item = PROVIDER_LABEL[id];
        return (
          <abbr
            key={id}
            className={`bhd-switcher-provider is-${id}`}
            title={ar ? item.ar : item.en}
            aria-label={ar ? item.ar : item.en}
          >
            {item.mark}
          </abbr>
        );
      })}
    </span>
  );
}

function Face({
  user,
  ar,
  large = false,
}: {
  user: SwitcherPerson;
  ar: boolean;
  large?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const show = Boolean(user.picture) && !broken;
  const initial = (user.name || user.email || 'B').trim().slice(0, 1).toUpperCase();
  return (
    <span className={large ? 'bhd-switcher-face is-large' : 'bhd-switcher-face'}>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.picture || undefined}
          alt=""
          width={large ? 56 : 40}
          height={large ? 56 : 40}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
      <ProviderMarks providers={user.providers || []} ar={ar} />
    </span>
  );
}

function AccountRow({
  user,
  ar,
  large = false,
}: {
  user: SwitcherPerson;
  ar: boolean;
  large?: boolean;
}) {
  const meta = accountMeta(user);
  return (
    <span className="bhd-switcher-person">
      <Face user={user} ar={ar} large={large} />
      <span className="bhd-switcher-who">
        <strong dir="ltr">{accountHandle(user)}</strong>
        {meta.length ? (
          <small dir="ltr">{meta.join(' · ')}</small>
        ) : null}
      </span>
    </span>
  );
}

/** Shown only when the account works in more than one organization (own + employer teams). */
function OrganizationSwitcher({ ar, locale }: { ar: boolean; locale: 'ar' | 'en' }) {
  const [choices, setChoices] = useState<OrganizationChoice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/organization', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { organizations?: OrganizationChoice[] } | null) => {
        if (!cancelled && payload?.organizations) setChoices(payload.organizations);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (choices.length < 2) return null;

  const choose = async (organizationId: string) => {
    setBusy(organizationId);
    setFailed(false);
    try {
      await browserNextMutation('/api/auth/organization', {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      });
      window.location.assign(`/${locale}/portal`);
    } catch {
      setFailed(true);
      setBusy(null);
    }
  };

  return (
    <div className="bhd-switcher-orgs">
      <small>{ar ? 'المنشأة التي تعمل عليها' : 'Working in'}</small>
      {choices.map((choice) => (
        <button
          key={choice.organizationId}
          type="button"
          className={choice.current ? 'bhd-switcher-org is-current' : 'bhd-switcher-org'}
          aria-current={choice.current || undefined}
          disabled={choice.current || busy !== null}
          onClick={() => void choose(choice.organizationId)}
        >
          <span>{ar ? choice.nameAr : choice.nameEn}</span>
          <small>
            {busy === choice.organizationId
              ? ar
                ? 'جارٍ التبديل…'
                : 'Switching…'
              : roleLabel(choice.role, ar)}
          </small>
        </button>
      ))}
      {failed ? (
        <small className="bhd-switcher-orgs__error">
          {ar ? 'تعذر التبديل، أعد المحاولة.' : 'Could not switch; try again.'}
        </small>
      ) : null}
    </div>
  );
}

export function BhdAppSwitcher({ viewer, locale }: { viewer: Viewer; locale: 'ar' | 'en' }) {
  const [panel, setPanel] = useState<Panel>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const appsId = useId();
  const accountId = useId();
  const router = useRouter();
  const ar = locale === 'ar';
  const apps = BHD_APPS.filter((app) => app.enabled);
  const [origin, setOrigin] = useState('');
  const [siteAdmin, setSiteAdmin] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<RosterAccount[]>([]);
  const [currentSub, setCurrentSub] = useState<string | null>(null);
  const [switchBusy, setSwitchBusy] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    hopOrigins().forEach((item) => hintHop(item));
  }, []);

  useEffect(() => {
    if (panel !== 'apps' || !origin) return;
    BHD_APPS.forEach((app) => {
      if (!app.enabled) return;
      hintHop(launchUrlForApp(app, origin));
    });
  }, [panel, origin]);

  const current =
    (currentSub && accounts.find((item) => item.sub === currentSub)) || accounts[0] || null;
  const activePerson: SwitcherPerson = current
    ? toPerson(current)
    : {
        name: viewer.displayName,
        email: viewer.email || '',
        username: viewer.username || null,
        phone: null,
        picture: null,
        providers: ['password'],
      };
  const otherAccounts = accounts.filter((item) => item.sub !== (currentSub || current?.sub));
  const avatarInitial = (activePerson.name || activePerson.email || 'B')
    .trim()
    .slice(0, 1)
    .toUpperCase();
  const showAvatarPicture = Boolean(activePerson.picture) && !avatarBroken;

  useEffect(() => {
    setAvatarBroken(false);
  }, [activePerson.picture]);

  useEffect(() => {
    if (panel !== 'account') return;
    let live = true;
    void fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          payload: {
            accounts?: RosterAccount[];
            currentSub?: string | null;
          } | null,
        ) => {
          if (!live || !payload) return;
          if (Array.isArray(payload.accounts)) setAccounts(payload.accounts);
          if (typeof payload.currentSub === 'string' || payload.currentSub === null) {
            setCurrentSub(payload.currentSub ?? null);
          }
        },
      )
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [panel]);

  useEffect(() => {
    if (panel !== 'account' || siteAdmin !== null) return;
    let live = true;
    fetch('/api/site-admin/access', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (payload: { access?: unknown } | null) => live && setSiteAdmin(Boolean(payload?.access)),
      )
      .catch(() => live && setSiteAdmin(false));
    return () => {
      live = false;
    };
  }, [panel, siteAdmin]);

  useEffect(() => {
    if (!panel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null);
    };
    const closeOnOutsideClick = (event: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('mousedown', closeOnOutsideClick);
    };
  }, [panel]);

  const addAccount = () => {
    const start = new URL('/api/auth/bhd/start', window.location.origin);
    start.searchParams.set('returnTo', `/${locale}/portal`);
    const login = new URL(`${IDENTITY_ORIGIN}/login`);
    login.searchParams.set('add', '1');
    login.searchParams.set('return_to', start.toString());
    window.location.assign(login.toString());
  };

  /** Instant header update — no reload (BHD-ACCOUNT-SWITCHER §5). */
  const switchTo = async (sub: string) => {
    if (!sub || sub === currentSub || switchBusy) return;
    const prior = accounts.find((item) => item.sub === sub);
    if (prior) {
      setCurrentSub(sub);
      setAccounts((list) => [prior, ...list.filter((item) => item.sub !== sub)]);
      setAvatarBroken(false);
    }
    setSwitchBusy(sub);
    try {
      await fetch(`${IDENTITY_ORIGIN}/api/auth/switch`, {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ sub }),
      })
        .then(async (response) => {
          if (!response.ok) return null;
          return response.json() as Promise<{
            user?: {
              id?: string;
              email?: string;
              name?: string;
              username?: string | null;
              phone?: string | null;
              picture?: string | null;
              providers?: AuthProvider[];
            };
            accounts?: Array<{
              id?: string;
              email?: string;
              name?: string;
              username?: string | null;
              phone?: string | null;
              picture?: string | null;
              providers?: AuthProvider[];
            }>;
          }>;
        })
        .then((payload) => {
          if (!payload?.accounts) return;
          const next = rosterFromIdentityAccounts(payload.accounts);
          if (next.length) setAccounts(next);
          if (payload.user?.id) setCurrentSub(payload.user.id);
        })
        .catch(() => undefined);

      const product = await browserNextMutation<{
        ok?: boolean;
        currentSub?: string;
        accounts?: RosterAccount[];
      }>('/api/auth/switch', {
        method: 'POST',
        body: JSON.stringify({ sub }),
      });
      if (Array.isArray(product.accounts)) setAccounts(product.accounts);
      if (product.currentSub) setCurrentSub(product.currentSub);
      setPanel(null);
      window.dispatchEvent(new CustomEvent('bhd-account-changed', { detail: { sub } }));
      router.refresh();
    } catch {
      setSwitchBusy(null);
      return;
    }
    setSwitchBusy(null);
  };

  const signOut = (all = false) => {
    const action = all
      ? `/api/auth/bhd/logout?locale=${locale}&all=1`
      : `/api/auth/bhd/logout?locale=${locale}`;
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    document.body.appendChild(form);
    form.submit();
  };

  const onAppClick = (app: BhdApp, event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!app.enabled) return;
    const pageOrigin = origin || window.location.origin;
    if (isCurrentApp(app, pageOrigin)) {
      setPanel(null);
      return;
    }
    openApp(app, pageOrigin, (href) => {
      setPanel(null);
      router.push(href);
    });
  };

  return (
    <div className="bhd-switcher-slot" ref={rootRef}>
      <button
        type="button"
        className="bhd-switcher-grid"
        aria-label={ar ? 'تطبيقات BHD' : 'BHD apps'}
        aria-haspopup="dialog"
        aria-expanded={panel === 'apps'}
        aria-controls={panel === 'apps' ? appsId : undefined}
        onClick={() => setPanel((currentPanel) => (currentPanel === 'apps' ? null : 'apps'))}
      >
        <span aria-hidden="true">
          {Array.from({ length: 9 }).map((_, index) => (
            <i key={index} />
          ))}
        </span>
      </button>
      <button
        type="button"
        className="bhd-switcher-avatar"
        aria-label={ar ? 'الحساب' : 'Account'}
        aria-haspopup="dialog"
        aria-expanded={panel === 'account'}
        aria-controls={panel === 'account' ? accountId : undefined}
        onClick={() => setPanel((currentPanel) => (currentPanel === 'account' ? null : 'account'))}
      >
        {showAvatarPicture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activePerson.picture || undefined}
            alt=""
            width={32}
            height={32}
            referrerPolicy="no-referrer"
            onError={() => setAvatarBroken(true)}
          />
        ) : (
          <span>{avatarInitial}</span>
        )}
      </button>

      {panel === 'apps' ? (
        <div
          className="bhd-switcher-card"
          id={appsId}
          role="dialog"
          aria-label={ar ? 'تطبيقات BHD' : 'BHD apps'}
        >
          <div className="bhd-switcher-card__head">
            <strong>{ar ? 'تطبيقات BHD' : 'BHD apps'}</strong>
            <small>{ar ? 'حساب واحد · منتجات مستقلة' : 'One account · independent products'}</small>
          </div>
          <div className="bhd-switcher-apps">
            {apps.map((app) => {
              const pageOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : '');
              const currentApp = pageOrigin ? isCurrentApp(app, pageOrigin) : false;
              const href = launchUrlForApp(app, pageOrigin || undefined);
              return (
                <a
                  key={app.id}
                  className={currentApp ? 'bhd-switcher-app is-current' : 'bhd-switcher-app'}
                  href={href}
                  aria-current={currentApp ? 'page' : undefined}
                  onClick={(event) => onAppClick(app, event)}
                >
                  <span
                    className="bhd-app-mark"
                    style={{ background: app.soft, color: app.accent }}
                  >
                    {app.mark}
                  </span>
                  <span>{ar ? app.nameAr : app.nameEn}</span>
                </a>
              );
            })}
          </div>
        </div>
      ) : null}

      {panel === 'account' ? (
        <div
          className="bhd-switcher-card bhd-switcher-account"
          id={accountId}
          role="dialog"
          aria-label={ar ? 'الحساب' : 'Account'}
        >
          <div className="bhd-switcher-account-now">
            <AccountRow user={activePerson} ar={ar} large />
            <a className="bhd-switcher-manage" href="https://id.bhd-om.com/account">
              {ar ? 'إدارة الحساب' : 'Manage account'}
            </a>
            <Link className="bhd-switcher-manage" href={`/${locale}/portal`} onClick={() => setPanel(null)}>
              {ar ? 'مساحتي في BHD R' : 'My BHD R workspace'}
            </Link>
            <Link className="bhd-switcher-manage" href={`/${locale}/account`} onClick={() => setPanel(null)}>
              {ar ? 'صورتي وتوثيق حسابي ✓' : 'Picture & verification ✓'}
            </Link>
            {siteAdmin ? (
              <Link
                className="bhd-switcher-manage"
                href={`/${locale}/site-admin`}
                onClick={() => setPanel(null)}
              >
                {ar ? 'إدارة الموقع' : 'Site admin'}
              </Link>
            ) : null}
            <OrganizationSwitcher ar={ar} locale={locale} />
          </div>

          <div className="bhd-switcher-account-list">
            {otherAccounts.map((account) => {
              const person = toPerson(account);
              const handle = accountHandle(person);
              return (
                <button
                  key={account.sub}
                  type="button"
                  className="bhd-switcher-account-choice"
                  aria-label={ar ? `تبديل إلى ${handle}` : `Switch to ${handle}`}
                  disabled={switchBusy !== null}
                  onClick={() => void switchTo(account.sub)}
                >
                  <AccountRow user={person} ar={ar} />
                </button>
              );
            })}
            <button type="button" className="bhd-switcher-account-choice" onClick={addAccount}>
              <span className="bhd-switcher-person">
                <span className="bhd-switcher-face is-action" aria-hidden="true">
                  <span>+</span>
                </span>
                <span className="bhd-switcher-who">
                  <strong>{ar ? 'إضافة حساب آخر' : 'Add another account'}</strong>
                </span>
              </span>
            </button>
          </div>

          <div className="bhd-switcher-account-foot">
            <button
              type="button"
              className="bhd-switcher-account-choice"
              onClick={() => signOut(false)}
            >
              {ar ? 'خروج من هذا الحساب' : 'Sign out of this account'}
            </button>
            <button
              type="button"
              className="bhd-switcher-account-choice"
              onClick={() => signOut(true)}
            >
              {ar ? 'خروج من كل الحسابات' : 'Sign out of all accounts'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
