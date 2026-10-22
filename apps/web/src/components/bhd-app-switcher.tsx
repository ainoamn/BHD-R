'use client';

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { browserNextMutation } from '@/lib/api';
import {
  accountHandle,
  accountMeta,
  asProviders,
  type AuthProvider,
  type RosterAccount,
} from '@/lib/bhd/account-roster-shared';
import {
  BHD_APPS,
  hopOrigins,
  launchUrlForApp,
  type BhdApp,
} from '@/lib/bhd/apps';
import { BhdAppIcon } from '@/components/bhd/bhd-app-icon';
import {
  addAccountUrl,
  applyAccountIsolation,
  identityFetch,
  identityMe,
} from '@/lib/identity/client';
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

/** BHD-ACCOUNT-SWITCHER §5 — warm product origins (preconnect only; avoid cross-origin document prefetch storms). */
function hintHop(urlOrOrigin: string) {
  if (!urlOrOrigin || typeof document === 'undefined') return;
  try {
    const origin = urlOrOrigin.startsWith('/')
      ? window.location.origin
      : new URL(urlOrOrigin, window.location.origin).origin;
    if (document.head.querySelector(`link[data-bhd-hop="${origin}"]`)) return;
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = origin;
    pre.crossOrigin = 'anonymous';
    pre.setAttribute('data-bhd-hop', origin);
    document.head.appendChild(pre);
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
    email?: string | null;
    name?: string | null;
    username?: string | null;
    phone?: string | null;
    picture?: string | null;
    providers?: AuthProvider[] | string[];
  }>,
): RosterAccount[] {
  return items
    .filter((item) => typeof item.id === 'string' && item.id.length >= 8)
    .map((item) => {
      const providers = asProviders(item.providers);
      return {
        sub: item.id!,
        name: item.name || item.email || 'BHD',
        email: (item.email || '').toLowerCase(),
        username: item.username || null,
        phone: item.phone || null,
        picture: item.picture || null,
        providers: providers.length ? providers : (['password'] as AuthProvider[]),
      };
    });
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

/** Circular photo only — provider badge sits beside the email (BHD-ACCOUNT-SWITCHER §1). */
function Face({ user, large = false }: { user: SwitcherPerson; large?: boolean }) {
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
      <Face user={user} large={large} />
      <span className="bhd-switcher-who">
        <span className="bhd-switcher-who__line">
          <strong dir="ltr">{accountHandle(user)}</strong>
          <ProviderMarks providers={user.providers || []} ar={ar} />
        </span>
        {meta.length ? <small dir="ltr">{meta.join(' · ')}</small> : null}
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

  // Accounts list from identity host directly (BHD-ACCOUNT-SWITCHER §2.1).
  useEffect(() => {
    if (panel !== 'account') return;
    let live = true;
    void identityMe()
      .then((payload) => {
        if (!live || !payload) return;
        if (Array.isArray(payload.accounts)) {
          setAccounts(rosterFromIdentityAccounts(payload.accounts));
        }
        if (payload.user?.id) setCurrentSub(payload.user.id);
      })
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

  /** Only entry that may open `/login?add=1` — never used for switch. */
  const addAccount = () => {
    window.location.assign(
      addAccountUrl(`${window.location.pathname}${window.location.search}` || `/${locale}/portal`),
    );
  };

  /**
   * Switch active identity account, then rebind this product via SSO start so
   * every page shows the new account’s data only (BHD-ACCOUNT-SWITCHER §2).
   * Must not open `/login?add=1`.
   */
  const switchTo = async (sub: string) => {
    if (!sub || sub === currentSub || switchBusy) return;
    setSwitchBusy(sub);
    try {
      const response = await identityFetch('/api/auth/switch', {
        method: 'POST',
        body: JSON.stringify({ sub }),
      });
      if (!response.ok) {
        setSwitchBusy(null);
        return;
      }
      // Drop prior product session/data — start issues cookies for the new sub.
      applyAccountIsolation(
        `${window.location.pathname}${window.location.search}${window.location.hash}` ||
          `/${locale}/portal`,
      );
    } catch {
      setSwitchBusy(null);
    }
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
                  <BhdAppIcon id={app.id} title={ar ? app.nameAr : app.nameEn} />
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
                {ar ? 'تحكم الموقع والنظام' : 'Site & system control'}
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
