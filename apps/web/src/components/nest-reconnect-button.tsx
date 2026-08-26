'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Wakes Nest (Render) then refreshes the current portal section. */
export function NestReconnectButton({ locale }: { locale: 'ar' | 'en' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const ar = locale === 'ar';

  async function reconnect() {
    setBusy(true);
    setHint(ar ? 'جاري إيقاظ Nest… قد يستغرق حتى دقيقة.' : 'Waking Nest… may take up to a minute.');
    try {
      const warm = await fetch('/api/warm', { cache: 'no-store' });
      const payload = (await warm.json().catch(() => null)) as {
        ok?: boolean;
        status?: number;
        ms?: number;
      } | null;
      if (payload?.ok) {
        setHint(ar ? 'Nest جاهز — جاري تحديث الصفحة…' : 'Nest is ready — refreshing…');
        router.refresh();
        return;
      }
      setHint(
        ar
          ? `Nest ما زال غير جاهز (${payload?.status ?? warm.status}، ~${payload?.ms ?? '?'}ms). امسح فلتر Logs (Clear query) → Manual Deploy → انتظر Live ثم أعد المحاولة. الخطة المجانية قد تستغرق دقيقة+.`
          : `Nest still down (${payload?.status ?? warm.status}, ~${payload?.ms ?? '?'}ms). Clear Logs query → Manual Deploy → wait Live, then retry. Free tier may need 1+ min.`,
      );
    } catch {
      setHint(
        ar
          ? 'تعذر الاتصال. تحقق من Render وأن الخدمة Live.'
          : 'Could not reach warm endpoint. Check Render is Live.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-api-banner__actions">
      <button type="button" className="button button--primary" disabled={busy} onClick={() => void reconnect()}>
        {busy ? (ar ? 'جارٍ…' : 'Working…') : ar ? 'إعادة الاتصال بـ Nest' : 'Reconnect to Nest'}
      </button>
      <a className="button button--quiet" href="https://bhd-r.onrender.com/healthz" target="_blank" rel="noreferrer">
        /healthz
      </a>
      {hint ? <p className="ops-api-banner__note">{hint}</p> : null}
    </div>
  );
}
