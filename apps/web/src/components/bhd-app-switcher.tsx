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
import { hopOrigins, launchUrlForApp, type BhdApp } from '@/lib/bhd/apps';
import { BhdAppIcon } from '@/components/bhd/bhd-app-icon';
import {
  accountBoundPath,
  addAccountUrl,
  applyAccountIsolation,
  claimProductSessionForActiveAu,
  currentReturnPath,
  ensureAuInUrl,
  identityMe,
  paintPrivacyVeil,
  signalPrivacyVeilReady,
  switchWindowAccount,
} from '@/lib/identity/client';
import { readActiveAu, setActiveAu, tokenForAccount } from '@/lib/identity/window-session';
import { useBhdCatalog } from '@/lib/identity/use-bhd-catalog';
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

/** صورة جوجل دائرية مضغوطة — نفس أسلوب خمسات/حسوب. */
function googleAvatarSrc(picture: string | null | undefined) {
  if (!picture) return undefined;
  try {
    if (!picture.includes('googleusercontent.com')) return picture;
    if (/=s\d+/.test(picture)) return picture.replace(/=s\d+(-c)?/, '=s96-c');
    return `${picture}${picture.includes('?') ? '&' : '?'}sz=96`;
  } catch {
    return picture;
  }
}

/** Circular photo only — provider badge sits beside the email (BHD-ACCOUNT-SWITCHER §1). */
function Face({ user, large = false }: { user: SwitcherPerson; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = googleAvatarSrc(user.picture);
  const show = Boolean(src) && !broken;
  const initial = (user.name || user.email || 'B').trim().slice(0, 1).toUpperCase();
  return (
    <span className={large ? 'bhd-switcher-face is-large' : 'bhd-switcher-face'}>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
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
  const catalogApps = useBhdCatalog();
  const apps = catalogApps.filter((app) => app.enabled && app.id !== 'account');
  const [origin, setOrigin] = useState('');
  const [siteAdmin, setSiteAdmin] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<RosterAccount[]>([]);
  const [currentSub, setCurrentSub] = useState<string | null>(null);
  const [switchBusy, setSwitchBusy] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    hopOrigins(catalogApps).forEach((item) => hintHop(item));
  }, [catalogApps]);

  useEffect(() => {
    if (panel !== 'apps' || !origin) return;
    catalogApps.forEach((app) => {
      if (!app.enabled) return;
      hintHop(launchUrlForApp(app, origin));
    });
  }, [panel, origin, catalogApps]);

  useEffect(() => {
    let live = true;
    const applyMe = (payload: {
      currentSub?: string | null;
      accounts?: RosterAccount[];
      email?: string;
      displayName?: string;
      username?: string | null;
    } | null) => {
      if (!live || !payload) return;
      if (Array.isArray(payload.accounts) && payload.accounts.length) {
        setAccounts(payload.accounts);
      }
      const au = readActiveAu();
      const cookieSub = (payload.currentSub || '').trim();
      // Keep chip + panel on one face: prefer live cookie when ?au= cannot be claimed.
      if (au && cookieSub && au !== cookieSub) {
        void claimProductSessionForActiveAu()
          .then((claimed) => {
            if (!live) return;
            if (claimed.ok) {
              setCurrentSub(readActiveAu() || au);
              return;
            }
            setActiveAu(cookieSub);
            ensureAuInUrl(cookieSub);
            setCurrentSub(cookieSub);
          })
          .catch(() => {
            if (!live) return;
            setActiveAu(cookieSub);
            ensureAuInUrl(cookieSub);
            setCurrentSub(cookieSub);
          });
        return;
      }
      setCurrentSub(au || cookieSub || null);
    };

    void fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => applyMe(payload))
      .catch(() => undefined);

    // Enrich from identity with this tab's Bearer token (phone/picture for ?au=).
    void identityMe()
      .then((payload) => {
        if (!live || !payload) return;
        if (Array.isArray(payload.accounts)) {
          setAccounts(rosterFromIdentityAccounts(payload.accounts));
        }
      })
      .catch(() => undefined);

    const onRebound = () => {
      void fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => applyMe(payload))
        .catch(() => undefined);
      void identityMe()
        .then((payload) => {
          if (!payload?.accounts) return;
          setAccounts(rosterFromIdentityAccounts(payload.accounts));
        })
        .catch(() => undefined);
    };
    window.addEventListener('bhd:account-rebound', onRebound);
    return () => {
      live = false;
      window.removeEventListener('bhd:account-rebound', onRebound);
    };
  }, []);

  const tabAu = currentSub || (typeof window !== 'undefined' ? readActiveAu() : '') || null;
  const current =
    (tabAu && accounts.find((item) => item.sub === tabAu)) ||
    (!tabAu ? accounts[0] || null : null);
  // Shared product cookie may belong to another tab — never flash that SSR viewer under ?au=.
  const viewerEmail = viewer.email?.trim().toLowerCase() || '';
  const viewerMatchesTab =
    Boolean(tabAu) &&
    Boolean(viewerEmail) &&
    accounts.some((item) => item.sub === tabAu && item.email === viewerEmail);
  const activePerson: SwitcherPerson | null = current
    ? toPerson(current)
    : !tabAu
      ? {
          name: viewer.displayName,
          email: viewer.email || '',
          username: viewer.username || null,
          phone: null,
          picture: null,
          providers: ['password'],
        }
      : viewerMatchesTab
        ? {
            name: viewer.displayName,
            email: viewer.email || '',
            username: viewer.username || null,
            phone: null,
            picture: null,
            providers: ['password'],
          }
        : null;
  const otherAccounts = accounts.filter((item) => item.sub !== (tabAu || current?.sub));
  const avatarInitial = (activePerson?.name || activePerson?.email || 'B')
    .trim()
    .slice(0, 1)
    .toUpperCase();
  const avatarSrc = googleAvatarSrc(activePerson?.picture);
  const showAvatarPicture = Boolean(avatarSrc) && !avatarBroken;

  useEffect(() => {
    setAvatarBroken(false);
  }, [activePerson?.picture]);

  // Refresh identity roster when the account panel opens.
  useEffect(() => {
    if (panel !== 'account') return;
    let live = true;
    void identityMe()
      .then((payload) => {
        if (!live || !payload) return;
        if (Array.isArray(payload.accounts)) {
          setAccounts(rosterFromIdentityAccounts(payload.accounts));
        }
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
    paintPrivacyVeil();
    const goStart = (nextSub: string) => {
      const returnTo = accountBoundPath(currentReturnPath(), nextSub);
      window.location.assign(
        `/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}`,
      );
    };
    try {
      const switched = await switchWindowAccount(sub);
      if (switched.ok) {
        const nextSub = switched.userId || sub;
        const token = switched.token || tokenForAccount(nextSub);
        if (token) {
          await applyAccountIsolation(token, {
            force: true,
            sub: nextSub,
          });
          return;
        }
        // Spec §2: identity switched but no access token — bind product via SSO start.
        goStart(nextSub);
        return;
      }
      // Fallback: product roster switch when identity cookie-only switch fails.
      try {
        await browserNextMutation('/api/auth/switch', {
          method: 'POST',
          body: JSON.stringify({ sub }),
        });
        goStart(sub);
        return;
      } catch {
        setSwitchBusy(null);
        signalPrivacyVeilReady();
      }
    } catch {
      setSwitchBusy(null);
      signalPrivacyVeilReady();
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
      {/* ترتيب خمسات/حسوب: الصورة ثم شبكة التطبيقات */}
      <button
        type="button"
        className="bhd-switcher-avatar"
        aria-label={ar ? 'الحساب' : 'Account'}
        aria-haspopup="dialog"
        aria-expanded={panel === 'account'}
        aria-controls={panel === 'account' ? accountId : undefined}
        onClick={() => setPanel((currentPanel) => (currentPanel === 'account' ? null : 'account'))}
      >
        {showAvatarPicture && avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarSrc}
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
              const pageOrigin =
                origin || (typeof window !== 'undefined' ? window.location.origin : '');
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
            {activePerson ? (
              <AccountRow user={activePerson} ar={ar} large />
            ) : (
              <span className="bhd-switcher-person bhd-switcher-person--pending" aria-busy="true">
                <span className="bhd-switcher-face is-large">
                  <span aria-hidden="true">…</span>
                </span>
                <span className="bhd-switcher-who">
                  <span className="bhd-switcher-who__line">
                    <strong>{ar ? 'جاري مزامنة الحساب…' : 'Syncing account…'}</strong>
                  </span>
                  <small>{ar ? 'عزل نافذة الحساب' : 'Per-tab account binding'}</small>
                </span>
              </span>
            )}
            <a
              className="bhd-switcher-manage"
              href={(() => {
                const sub = (tabAu || currentSub || readActiveAu() || '').trim();
                if (!sub) return 'https://id.bhd-om.com/account';
                return `https://id.bhd-om.com/auth/switch?sub=${encodeURIComponent(sub)}&next=${encodeURIComponent(`/account?au=${sub}`)}`;
              })()}
            >
              {ar ? 'إدارة الحساب' : 'Manage account'}
            </a>
            <Link
              className="bhd-switcher-manage"
              href={`/${locale}/portal`}
              onClick={() => setPanel(null)}
            >
              {ar ? 'مساحتي في BHD R' : 'My BHD R workspace'}
            </Link>
            <Link
              className="bhd-switcher-manage"
              href={`/${locale}/account`}
              onClick={() => setPanel(null)}
            >
              {ar ? 'صورتي وتوثيق حسابي ✓' : 'Picture & verification ✓'}
            </Link>
            {siteAdmin ? (
              <Link
                className="bhd-switcher-manage"
                href={`/${locale}/admin`}
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
