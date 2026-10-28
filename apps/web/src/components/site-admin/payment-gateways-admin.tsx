'use client';

import { useEffect, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import {
  PAYMENT_METHOD_IDS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_PROVIDERS,
  type PaymentMethodId,
} from '@/lib/payment-gateways-catalog';
import type { PaymentGatewaysView, PaymentProviderState } from '@/lib/site-control-shared';
import { adminErrorText, adminGet, type AdminNotice } from './admin-fetch';

type Draft = {
  active: boolean;
  endpoint: string;
  credentials: Record<string, string>;
};

function emptyDraft(row: PaymentProviderState): Draft {
  const def = PAYMENT_PROVIDERS.find((item) => item.id === row.id);
  return {
    active: row.active,
    endpoint: row.endpoint,
    credentials: Object.fromEntries(
      (def?.credentialFields ?? []).map((field) => [
        field.key,
        field.secret ? '' : (row.credentialsMasked[field.key] ?? ''),
      ]),
    ),
  };
}

/** Enable/disable payment gateways and methods; store keys so wiring activates on save. */
export function PaymentGatewaysAdmin({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [view, setView] = useState<PaymentGatewaysView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [methods, setMethods] = useState<Record<PaymentMethodId, boolean> | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    adminGet<PaymentGatewaysView>('/api/site-admin/payments')
      .then((data) => {
        if (!live) return;
        setView(data);
        setMethods(data.methods);
        setDrafts(Object.fromEntries(data.providers.map((row) => [row.id, emptyDraft(row)])));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="notice notice--error" role="alert">
        {ar ? 'تعذّر تحميل بوابات الدفع.' : 'Could not load payment gateways.'}
      </p>
    );
  }
  if (!view || !methods) {
    return <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>;
  }

  async function saveProvider(providerId: string) {
    const draft = drafts[providerId];
    if (!draft) return;
    setBusy(providerId);
    setNotice(null);
    try {
      const data = await browserNextMutation<PaymentGatewaysView>('/api/site-admin/payments', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'provider',
          providerId,
          active: draft.active,
          endpoint: draft.endpoint,
          credentials: draft.credentials,
        }),
      });
      setView(data);
      setMethods(data.methods);
      setDrafts((current) => ({
        ...current,
        [providerId]: emptyDraft(data.providers.find((row) => row.id === providerId)!),
      }));
      setNotice({
        tone: 'success',
        text: ar ? 'حُفظت البوابة.' : 'Gateway saved.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الحفظ.', 'Could not save.'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function saveMethods() {
    setBusy('methods');
    setNotice(null);
    try {
      const data = await browserNextMutation<PaymentGatewaysView>('/api/site-admin/payments', {
        method: 'PUT',
        body: JSON.stringify({ action: 'methods', methods }),
      });
      setView(data);
      setMethods(data.methods);
      setNotice({
        tone: 'success',
        text: ar ? 'حُفظت طرق الدفع.' : 'Payment methods saved.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: adminErrorText(error, ar, 'تعذّر الحفظ.', 'Could not save.'),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sa-gateways">
      <header className="sa-section-head">
        <div>
          <h1>{ar ? 'بوابات وطرق الدفع' : 'Payment gateways & methods'}</h1>
          <p className="muted">
            {ar
              ? 'فعّل البوابة وأدخل المفاتيح — عند اكتمال الحقول تصبح جاهزة للاستخدام فوراً. بوابة التجربة تعمل دون مفاتيح خارجية.'
              : 'Enable a gateway and enter its keys — once required fields are complete it is ready. The sandbox works without external keys.'}
          </p>
        </div>
      </header>

      {notice ? (
        <p className={`notice notice--${notice.tone}`} role="status">
          {notice.text}
        </p>
      ) : null}

      <section className="sa-gateway-methods" aria-labelledby="sa-methods-title">
        <h2 id="sa-methods-title">{ar ? 'طرق الدفع' : 'Payment methods'}</h2>
        <div className="sa-scopes">
          {PAYMENT_METHOD_IDS.map((id) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={methods[id]}
                onChange={(event) =>
                  setMethods((current) =>
                    current ? { ...current, [id]: event.target.checked } : current,
                  )
                }
              />
              {ar ? PAYMENT_METHOD_LABELS[id].ar : PAYMENT_METHOD_LABELS[id].en}
            </label>
          ))}
        </div>
        <div className="sa-actions">
          <button
            type="button"
            className="button button--primary"
            disabled={busy === 'methods'}
            onClick={() => void saveMethods()}
          >
            {busy === 'methods'
              ? ar
                ? 'جارٍ الحفظ…'
                : 'Saving…'
              : ar
                ? 'حفظ الطرق'
                : 'Save methods'}
          </button>
        </div>
      </section>

      <div className="sa-gateway-grid">
        {PAYMENT_PROVIDERS.map((def) => {
          const row = view.providers.find((item) => item.id === def.id)!;
          const draft = drafts[def.id] ?? emptyDraft(row);
          const status = !draft.active
            ? ar
              ? 'مغلقة'
              : 'Off'
            : row.ready || (def.kind === 'sandbox' && draft.active)
              ? ar
                ? 'جاهزة'
                : 'Ready'
              : ar
                ? 'بانتظار المفاتيح'
                : 'Needs keys';
          return (
            <article
              key={def.id}
              className={`sa-gateway${draft.active ? '' : ' is-off'}${row.ready && draft.active ? ' is-ready' : ''}`}
            >
              <div className="sa-gateway__head">
                <div>
                  <h3>{ar ? def.nameAr : def.nameEn}</h3>
                  <p className="muted">{ar ? def.hintAr : def.hintEn}</p>
                </div>
                <span className={`sa-tag sa-tag--${row.ready && draft.active ? 'ok' : 'muted'}`}>
                  {status}
                </span>
              </div>

              <label className="sa-toggle">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [def.id]: { ...draft, active: event.target.checked },
                    }))
                  }
                />
                {ar ? 'مفعّلة' : 'Enabled'}
              </label>

              {def.kind === 'live' ? (
                <>
                  <label className="sa-field">
                    <span>{ar ? 'نقطة النهاية' : 'Endpoint'}</span>
                    <input
                      className="sa-input"
                      value={draft.endpoint}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [def.id]: { ...draft, endpoint: event.target.value },
                        }))
                      }
                    />
                  </label>
                  {def.credentialFields.map((field) => (
                    <label key={field.key} className="sa-field">
                      <span>
                        {ar ? field.labelAr : field.labelEn}
                        {field.optional ? (ar ? ' (اختياري)' : ' (optional)') : ''}
                        {row.credentialsStored && field.secret
                          ? ar
                            ? ' — اتركه فارغاً للإبقاء على المخزّن'
                            : ' — leave blank to keep stored'
                          : ''}
                      </span>
                      <input
                        className="sa-input sa-input--key"
                        type={field.secret ? 'password' : 'text'}
                        autoComplete="off"
                        placeholder={
                          field.secret && row.credentialsStored
                            ? row.credentialsMasked[field.key] || '••••••••'
                            : undefined
                        }
                        value={draft.credentials[field.key] ?? ''}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [def.id]: {
                              ...draft,
                              credentials: {
                                ...draft.credentials,
                                [field.key]: event.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </>
              ) : (
                <p className="muted">
                  {ar
                    ? 'لا تحتاج مفاتيح — تُستخدم لمدفوعات التجربة والإقامات حتى تربط بوابة حية.'
                    : 'No keys needed — used for pilot stay/invoice payments until a live gateway is linked.'}
                </p>
              )}

              <div className="sa-actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy === def.id}
                  onClick={() => void saveProvider(def.id)}
                >
                  {busy === def.id
                    ? ar
                      ? 'جارٍ الحفظ…'
                      : 'Saving…'
                    : ar
                      ? 'حفظ البوابة'
                      : 'Save gateway'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
