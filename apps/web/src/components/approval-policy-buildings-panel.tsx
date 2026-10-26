'use client';

import { useMemo, useState } from 'react';
import { ApprovalPolicyCard, type ApprovalPolicyKindState } from '@/components/approval-policy-card';
import { Link } from '@/i18n/navigation';
import {
  CONTRACT_APPROVAL_KINDS,
  DEFAULT_APPROVAL_POLICY_BY_KIND,
  contractApprovalKindLabel,
  type ApprovalPolicy,
  type ApprovalPolicyBuildingRow,
  type ApprovalPolicySource,
  type ContractApprovalKind,
} from '@/lib/approval-policy';

type BundleResponse = {
  kinds: Array<{
    kind: ContractApprovalKind;
    own: { policy: ApprovalPolicy; delegate: { name: string | null } | null } | null;
    inherited: { source: ApprovalPolicySource; policy: ApprovalPolicy };
  }>;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}|\u0640/gu, '')
    .replace(/\u0671/g, '\u0627')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick a building and customize approval / e-sign / viewing automation without
 * leaving الضبط — buildings without a save keep the organization defaults.
 */
export function ApprovalPolicyBuildingsPanel({
  locale,
  portal,
  buildings: initialBuildings,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  buildings: ApprovalPolicyBuildingRow[];
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const [buildings, setBuildings] = useState(initialBuildings);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'custom' | 'inherited'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kinds, setKinds] = useState<ApprovalPolicyKindState[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = normalize(query);
    return buildings.filter((row) => {
      const custom = row.overrideKinds.length > 0;
      if (filter === 'custom' && !custom) return false;
      if (filter === 'inherited' && custom) return false;
      if (!needle) return true;
      return (
        normalize(row.nameAr).includes(needle) || normalize(row.nameEn).includes(needle)
      );
    });
  }, [buildings, filter, query]);

  const selected = buildings.find((row) => row.id === selectedId) ?? null;

  async function selectBuilding(propertyId: string) {
    if (propertyId === selectedId && kinds) return;
    setSelectedId(propertyId);
    setBusy(true);
    setError(null);
    setKinds(null);
    try {
      const response = await fetch(
        `/api/owner/approval-policy?propertyId=${encodeURIComponent(propertyId)}`,
        { headers: { accept: 'application/json' }, credentials: 'same-origin' },
      );
      const data = (await response.json()) as BundleResponse & { error?: { code?: string } };
      if (!response.ok) {
        setError(t('تعذّر تحميل إعدادات هذا المبنى.', 'Could not load this building’s settings.'));
        return;
      }
      const next: ApprovalPolicyKindState[] = CONTRACT_APPROVAL_KINDS.map((kind) => {
        const row = data.kinds?.find((item) => item.kind === kind);
        return {
          kind,
          initialPolicy: row?.own?.policy ?? null,
          delegateName: row?.own?.delegate?.name ?? null,
          inherited: row?.inherited ?? {
            source: 'default',
            policy: DEFAULT_APPROVAL_POLICY_BY_KIND[kind],
          },
        };
      });
      setKinds(next);
      setBuildings((rows) =>
        rows.map((row) =>
          row.id === propertyId
            ? {
                ...row,
                overrideKinds: next
                  .filter((item) => item.initialPolicy)
                  .map((item) => item.kind),
              }
            : row,
        ),
      );
    } catch {
      setError(t('تعذّر الاتصال.', 'Could not connect.'));
    } finally {
      setBusy(false);
    }
  }

  function markOverride(kind: ContractApprovalKind, hasOwn: boolean) {
    if (!selectedId) return;
    setBuildings((rows) =>
      rows.map((row) => {
        if (row.id !== selectedId) return row;
        const set = new Set(row.overrideKinds);
        if (hasOwn) set.add(kind);
        else set.delete(kind);
        return { ...row, overrideKinds: [...set] };
      }),
    );
  }

  return (
    <section className="approval-buildings" aria-labelledby="approval-buildings-title">
      <header className="approval-buildings__head">
        <div>
          <h2 id="approval-buildings-title">
            {t('إعدادات خاصة لكل مبنى', 'Per-building settings')}
          </h2>
          <p className="muted">
            {t(
              'الإعدادات العامة أعلاه تطبَّق على كل المباني. اختر مبنىً هنا إذا أردت حجوزات تلقائية وعقوداً يدوية ومعاينات مؤتمتة — أو أي مزيج مختلف عن الباقي.',
              'The general settings above apply to every building. Pick one here if you want automatic bookings, manual contracts, and automated viewings — or any mix that differs from the rest.',
            )}
          </p>
        </div>
      </header>

      {buildings.length === 0 ? (
        <p className="muted">
          {t('أضف مبنىً أولاً لتخصيص اعتماده.', 'Add a building first to customize its approvals.')}
        </p>
      ) : (
        <>
          <div className="approval-buildings__toolbar">
            <input
              className="input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('ابحث عن مبنى…', 'Search buildings…')}
              aria-label={t('بحث المباني', 'Search buildings')}
            />
            <div className="approval-buildings__filters" role="group">
              {(
                [
                  ['all', ar ? 'الكل' : 'All'],
                  ['custom', ar ? 'مخصّصة' : 'Custom'],
                  ['inherited', ar ? 'تتبع العامة' : 'Follow general'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`button ${filter === value ? 'button--primary' : 'button--quiet'}`}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ul className="approval-buildings__list">
            {filtered.map((row) => {
              const custom = row.overrideKinds.length > 0;
              const active = row.id === selectedId;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`approval-buildings__item${active ? ' approval-buildings__item--on' : ''}`}
                    onClick={() => void selectBuilding(row.id)}
                  >
                    <strong>{ar ? row.nameAr : row.nameEn || row.nameAr}</strong>
                    <span
                      className={`approval-buildings__badge${
                        custom ? ' approval-buildings__badge--custom' : ''
                      }`}
                    >
                      {custom
                        ? t(
                            `مخصّص: ${row.overrideKinds.map((kind) => contractApprovalKindLabel(kind, true)).join(' · ')}`,
                            `Custom: ${row.overrideKinds.map((kind) => contractApprovalKindLabel(kind, false)).join(' · ')}`,
                          )
                        : t('يتبع الإعدادات العامة', 'Follows general settings')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {filtered.length === 0 ? (
            <p className="muted">{t('لا نتائج.', 'No matches.')}</p>
          ) : null}

          {selected ? (
            <div className="approval-buildings__editor">
              <div className="approval-buildings__editor-head">
                <h3>
                  {t('ضبط:', 'Settings for:')}{' '}
                  {ar ? selected.nameAr : selected.nameEn || selected.nameAr}
                </h3>
                <Link
                  href={`/${portal}/properties/${selected.id}/terms`}
                  className="button button--quiet"
                >
                  {t('صفحة شروط العقار', 'Property terms page')}
                </Link>
              </div>
              {busy ? (
                <p className="muted" role="status">
                  {t('جارٍ التحميل…', 'Loading…')}
                </p>
              ) : null}
              {error ? (
                <p className="notice notice--error" role="alert">
                  {error}
                </p>
              ) : null}
              {kinds && !busy ? (
                <ApprovalPolicyCard
                  key={selected.id}
                  locale={locale}
                  propertyId={selected.id}
                  kinds={kinds}
                  onOverrideChange={markOverride}
                />
              ) : null}
            </div>
          ) : (
            <p className="approval-buildings__hint muted">
              {t(
                'اختر مبنىً من القائمة لتعديل حجوزاته وعقوده ومعايناته بشكل مستقل.',
                'Select a building from the list to change its bookings, contracts, and viewings independently.',
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
