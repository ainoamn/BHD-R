/** Types for https://id.bhd-om.com/bhd-identity.js — do not reimplement session/window logic locally. */

export type BhdIdentityUser = {
  id?: string;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
  username?: string | null;
};

export type BhdIdentityMeBody = {
  user?: BhdIdentityUser | null;
  accounts?: BhdIdentityUser[];
  token?: string;
};

export type BhdIdentityResult = {
  ok: boolean;
  status: number;
  body: BhdIdentityMeBody;
};

export type BhdCatalogBody = {
  spec?: string;
  live?: boolean;
  apps?: Array<Record<string, unknown>>;
  hops?: string[];
};

export type BhdIdentityApi = {
  issuer: string;
  runtime: () => Promise<{ session?: { maxAgeSec?: number }; catalog?: BhdCatalogBody }>;
  catalog: () => Promise<BhdCatalogBody>;
  me: () => Promise<BhdIdentityResult>;
  isolate: () => Promise<void>;
  switchAccount: (sub: string) => Promise<BhdIdentityResult>;
  signOut: (all?: boolean) => Promise<BhdIdentityResult>;
  captureToken: (token?: string | null) => void;
  productStart: (returnTo?: string) => string;
};

declare global {
  interface Window {
    BhdIdentity?: BhdIdentityApi;
  }
}

/** Wait briefly for the deferred identity script (short timeout — page must not hang). */
export function loadBhdIdentity(timeoutMs = 1200): Promise<BhdIdentityApi | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.BhdIdentity) return Promise.resolve(window.BhdIdentity);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (window.BhdIdentity) {
        resolve(window.BhdIdentity);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(tick, 40);
    };
    tick();
  });
}
