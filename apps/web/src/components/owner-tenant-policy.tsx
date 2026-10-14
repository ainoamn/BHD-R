'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import type { TenantPolicyProperty } from '@/lib/tenant-policy-neon';
import type { MaintenanceWithArrears, TenantPolicy } from '@/lib/tenant-policy-shared';
import { tenantRequestErrorText } from '@/lib/tenant-requests-shared';

type PropertyRule = MaintenanceWithArrears | 'inherit';

/**
 * Whether tenants who owe rent or bills may still send ordinary maintenance requests: one rule
 * for the organization, with exceptions per property. Urgent safety requests are always open.
 */
export function OwnerTenantPolicy({
  locale,
  access,
  policy,
  properties,
}: {
  locale: 'ar' | 'en';
  access: 'organization' | 'own_properties';
  policy: TenantPolicy;
  properties: TenantPolicyProperty[];
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [orgRule, setOrgRule] = useState<MaintenanceWithArrears>(policy.maintenanceWithArrears);
  const [rules, setRules] = useState<Record<string, PropertyRule>>(() =>
    Object.fromEntries(properties.map((item) => [item.id, item.rule ?? 'inherit'])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const label = (rule: MaintenanceWithArrears) =>
    rule === 'block'
      ? ar
        ? 'لا يستطيع — يُطلب منه تسوية المتأخرات أولاً'
        : 'Cannot — must settle arrears first'
      : ar
        ? 'يستطيع تقديم طلبات الصيانة'
        : 'Can send maintenance requests';

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const changed = Object.fromEntries(
        properties
          .filter((item) => (item.rule ?? 'inherit') !== rules[item.id])
          .map((item) => {
            const rule = rules[item.id];
            return [item.id, rule === 'inherit' || !rule ? null : rule];
          }),
      );
      await browserNextMutation('/api/owner/tenant-policy', {
        method: 'POST',
        body: JSON.stringify({
          ...(access === 'organization' ? { maintenanceWithArrears: orgRule } : {}),
          properties: changed,
        }),
      });
      setSaved(true);
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="owner-policy">
      <h2>
        {ar
          ? 'طلبات الصيانة للمستأجر الذي عليه متأخرات'
          : 'Maintenance requests from tenants with arrears'}
      </h2>
      <p className="muted">
        {ar
          ? 'المتأخرات تشمل الإيجارات وفواتير الكهرباء والماء وتكاليف الصيانة والتلف غير المسددة بعد موعدها. عند اختيار «لا يستطيع» يرى المستأجر متأخراته ويُطلب منه تسويتها أولاً، ثم تُفتح له طلبات الصيانة. يبقى بإمكانه دائماً تقديم طلب مستعجل يخص المبنى أو سلامته أو سلامة القاطنين، وتتحقق الإدارة من صحته.'
          : 'Arrears include rent, electricity and water bills, maintenance and damage costs left unpaid past their date. With “cannot”, the tenant sees their arrears and is asked to settle them first; maintenance requests then open. They can always send an urgent request about the building or people’s safety, which management verifies.'}
      </p>
      {access === 'organization' ? (
        <fieldset className="owner-policy__org">
          <legend>{ar ? 'القاعدة العامة للمنشأة' : 'Organization rule'}</legend>
          {(['allow', 'block'] as const).map((rule) => (
            <label key={rule} className="tenant-request-form__check">
              <input
                type="radio"
                name="org-rule"
                checked={orgRule === rule}
                onChange={() => setOrgRule(rule)}
              />
              <span>{label(rule)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {properties.length ? (
        <div className="data-table-wrap tenant-table-wrap">
          <table className="data-table data-table--stack tenant-table">
            <thead>
              <tr>
                <th>{ar ? 'العقار' : 'Property'}</th>
                <th>{ar ? 'القاعدة' : 'Rule'}</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((item) => (
                <tr key={item.id}>
                  <td data-label={ar ? 'العقار' : 'Property'}>
                    {ar ? item.nameAr : item.nameEn || item.nameAr}
                  </td>
                  <td data-label={ar ? 'القاعدة' : 'Rule'}>
                    <select
                      className="input"
                      value={rules[item.id] ?? 'inherit'}
                      onChange={(event) =>
                        setRules((current) => ({
                          ...current,
                          [item.id]: event.target.value as PropertyRule,
                        }))
                      }
                    >
                      <option value="inherit">
                        {ar
                          ? `حسب القاعدة العامة (${orgRule === 'block' ? 'لا يستطيع' : 'يستطيع'})`
                          : `Organization rule (${orgRule === 'block' ? 'cannot' : 'can'})`}
                      </option>
                      <option value="allow">{label('allow')}</option>
                      <option value="block">{label('block')}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="notice notice--success" role="status">
          {ar
            ? 'حُفظت الإعدادات وتسري فوراً على طلبات المستأجرين.'
            : 'Saved; it applies to tenant requests at once.'}
        </p>
      ) : null}
      <div className="tenant-request-form__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ الإعدادات' : 'Save settings'}
        </button>
      </div>
    </section>
  );
}
