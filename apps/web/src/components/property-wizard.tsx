'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent, Field, SelectField, TextAreaField } from '@bhd-r/ui';
import { supportedCurrencyCodes, type CurrencyCode } from '@bhd-r/contracts';
import { countryPacks, type CountryPackCode } from '@bhd-r/country-packs';
import { useLocale, useTranslations } from 'next-intl';
import { browserMutation } from '@/lib/api';
import { toMinorUnits } from '@/lib/format';

interface UnitDraft {
  localId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  floor: string;
  bedrooms: string;
  bathrooms: string;
  area: string;
  rent: string;
  deposit: string;
  publishWhenAvailable: boolean;
}

interface CreatedPropertyBundle {
  id: string;
  units: Array<{ id: string }>;
}
interface UploadIntent {
  assetId: string;
  uploadUrl: string;
  requiredHeaders?: Record<string, string>;
}

const blankUnit = (index: number): UnitDraft => ({
  localId: crypto.randomUUID(),
  code: `U-${String(index).padStart(2, '0')}`,
  nameAr: '',
  nameEn: '',
  floor: '',
  bedrooms: '0',
  bathrooms: '1',
  area: '',
  rent: '',
  deposit: '',
  publishWhenAvailable: false,
});

export function PropertyWizard({
  ownerPartyId,
  portal,
}: {
  ownerPartyId: string;
  portal: 'owner' | 'developer';
}) {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<'single_unit' | 'multi_unit'>('single_unit');
  const [currency, setCurrency] = useState<CurrencyCode>('OMR');
  const [property, setProperty] = useState<{
    countryCode: CountryPackCode;
    category: string;
    nameAr: string;
    nameEn: string;
    descriptionAr: string;
    descriptionEn: string;
    governorate: string;
    wilayat: string;
    city: string;
    area: string;
    street: string;
  }>({
    countryCode: 'OM',
    category: 'apartment',
    nameAr: '',
    nameEn: '',
    descriptionAr: '',
    descriptionEn: '',
    governorate: '',
    wilayat: '',
    city: '',
    area: '',
    street: '',
  });
  const [units, setUnits] = useState<UnitDraft[]>([blankUnit(1)]);
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const bundleIdempotencyKey = useRef(`property-bundle:${crypto.randomUUID()}`);
  const steps = [
    t('PropertyForm.basics'),
    t('PropertyForm.units'),
    t('PropertyForm.media'),
    t('PropertyForm.review'),
  ];
  const validImages = useMemo(
    () =>
      images.every(
        (file) =>
          ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
          file.size <= 10 * 1024 * 1024,
      ),
    [images],
  );
  const countryPack = countryPacks[property.countryCode];

  function updateUnit(id: string, field: keyof UnitDraft, value: string | boolean) {
    setUnits((current) =>
      current.map((unit) => (unit.localId === id ? { ...unit, [field]: value } : unit)),
    );
  }
  function updateProperty(field: keyof typeof property, value: string) {
    setProperty((current) => ({ ...current, [field]: value }));
  }
  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 12);
    setImages(files);
    setError(
      files.every(
        (file) =>
          ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
          file.size <= 10 * 1024 * 1024,
      )
        ? null
        : t('PropertyForm.imageHelp'),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 3) {
      setStep((value) => value + 1);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const createdProperty = await browserMutation<CreatedPropertyBundle>(
        '/v1/portfolio/properties',
        {
          method: 'POST',
          headers: { 'idempotency-key': bundleIdempotencyKey.current },
          body: JSON.stringify({
            property: {
              ownerPartyId,
              kind,
              category: property.category,
              nameAr: property.nameAr,
              nameEn: property.nameEn,
              descriptionAr: property.descriptionAr || undefined,
              descriptionEn: property.descriptionEn || undefined,
              address: {
                countryCode: property.countryCode,
                governorate: property.governorate,
                wilayat: property.wilayat,
                city: property.city,
                area: property.area || undefined,
                street: property.street || undefined,
              },
              defaultCurrency: currency,
            },
            units: units.map((unit) => ({
              code: unit.code,
              nameAr: unit.nameAr,
              nameEn: unit.nameEn,
              floor: unit.floor || undefined,
              bedrooms: Number(unit.bedrooms),
              bathrooms: Number(unit.bathrooms),
              areaSquareMeters: unit.area || undefined,
              rent: { amountMinor: toMinorUnits(unit.rent, currency), currency },
              deposit: unit.deposit
                ? { amountMinor: toMinorUnits(unit.deposit, currency), currency }
                : undefined,
              publishWhenAvailable: unit.publishWhenAvailable,
            })),
          }),
        },
      );
      const mediaUnitId = createdProperty.units[0]?.id;
      if (images.length > 0 && !mediaUnitId) throw new Error('missing_media_unit');
      for (const file of images) {
        const unitId = mediaUnitId!;
        const intent = await browserMutation<UploadIntent>('/v1/media/upload-intents', {
          method: 'POST',
          body: JSON.stringify({
            purpose: 'property_image',
            unitId,
            mimeType: file.type,
            byteSize: file.size,
          }),
        });
        const safeUploadHeaders = Object.fromEntries(
          Object.entries(intent.requiredHeaders ?? {}).filter(
            ([name]) => name.toLowerCase() !== 'content-length',
          ),
        );
        const uploaded = await fetch(intent.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { ...safeUploadHeaders, 'content-type': file.type },
        });
        if (!uploaded.ok) throw new Error(`upload_failed:${file.name}`);
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        await browserMutation(`/v1/media/${intent.assetId}/complete`, {
          method: 'POST',
          headers: { 'idempotency-key': `media-complete:${intent.assetId}` },
          body: JSON.stringify({ sha256, unitId }),
        });
      }
      bundleIdempotencyKey.current = `property-bundle:${crypto.randomUUID()}`;
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-shell">
      <header className="portal-topbar">
        <div>
          <h1>{t('PropertyForm.title')}</h1>
          <p>{t('PropertyForm.intro')}</p>
        </div>
      </header>
      <ol className="steps">
        {steps.map((label, index) => (
          <li key={label} aria-current={step === index ? 'step' : undefined}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      <Card>
        <CardContent>
          <form onSubmit={(event) => void submit(event)}>
            {step === 0 ? (
              <div className="form-grid">
                <div className="field span-2">
                  <label>{t('PropertyForm.basics')}</label>
                  <div className="hero-actions">
                    <label className="checkbox-row">
                      <input
                        type="radio"
                        name="kind"
                        checked={kind === 'single_unit'}
                        onChange={() => {
                          setKind('single_unit');
                          setUnits((current) => [current[0] ?? blankUnit(1)]);
                        }}
                      />
                      {t('PropertyForm.single')}
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="radio"
                        name="kind"
                        checked={kind === 'multi_unit'}
                        onChange={() => setKind('multi_unit')}
                      />
                      {t('PropertyForm.multi')}
                    </label>
                  </div>
                </div>
                <SelectField
                  id="country"
                  label={locale === 'ar' ? 'الدولة' : 'Country'}
                  value={property.countryCode}
                  onChange={(event) => {
                    const code = event.target.value as CountryPackCode;
                    updateProperty('countryCode', code);
                    setCurrency(countryPacks[code].defaultCurrency);
                  }}
                  required
                >
                  {Object.values(countryPacks).map((pack) => (
                    <option key={pack.countryCode} value={pack.countryCode}>
                      {pack.name[locale]}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="category"
                  label={t('PropertyForm.category')}
                  value={property.category}
                  onChange={(event) => updateProperty('category', event.target.value)}
                  required
                >
                  {[
                    'apartment',
                    'villa',
                    'building',
                    'office',
                    'shop',
                    'warehouse',
                    'land',
                    'other',
                  ].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="currency"
                  name="currency"
                  label={t('Common.currency')}
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
                  required
                >
                  {supportedCurrencyCodes.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </SelectField>
                <Field
                  id="nameAr"
                  label={t('PropertyForm.nameAr')}
                  value={property.nameAr}
                  onChange={(event) => updateProperty('nameAr', event.target.value)}
                  minLength={2}
                  maxLength={160}
                  required
                />
                <Field
                  id="nameEn"
                  label={t('PropertyForm.nameEn')}
                  value={property.nameEn}
                  onChange={(event) => updateProperty('nameEn', event.target.value)}
                  minLength={2}
                  maxLength={160}
                  required
                  dir="ltr"
                />
                <TextAreaField
                  id="descriptionAr"
                  label={t('PropertyForm.descriptionAr')}
                  value={property.descriptionAr}
                  onChange={(event) => updateProperty('descriptionAr', event.target.value)}
                  maxLength={5000}
                />
                <TextAreaField
                  id="descriptionEn"
                  label={t('PropertyForm.descriptionEn')}
                  value={property.descriptionEn}
                  onChange={(event) => updateProperty('descriptionEn', event.target.value)}
                  maxLength={5000}
                  dir="ltr"
                />
                <Field
                  id="governorate"
                  label={countryPack.addressLevels[0]?.[locale] ?? t('PropertyForm.governorate')}
                  value={property.governorate}
                  onChange={(event) => updateProperty('governorate', event.target.value)}
                  required
                />
                <Field
                  id="wilayat"
                  label={countryPack.addressLevels[1]?.[locale] ?? t('PropertyForm.wilayat')}
                  value={property.wilayat}
                  onChange={(event) => updateProperty('wilayat', event.target.value)}
                  required
                />
                <Field
                  id="city"
                  label={countryPack.addressLevels[2]?.[locale] ?? t('PropertyForm.city')}
                  value={property.city}
                  onChange={(event) => updateProperty('city', event.target.value)}
                  required
                />
                <Field
                  id="area"
                  label={t('PropertyForm.area')}
                  value={property.area}
                  onChange={(event) => updateProperty('area', event.target.value)}
                />
                <Field
                  id="street"
                  label={t('PropertyForm.street')}
                  value={property.street}
                  onChange={(event) => updateProperty('street', event.target.value)}
                />
              </div>
            ) : null}
            {step === 1 ? (
              <div>
                {units.map((unit, index) => (
                  <fieldset className="unit-editor" key={unit.localId}>
                    <legend className="sr-only">
                      {t('PropertyForm.unit')} {index + 1}
                    </legend>
                    <div className="unit-editor__head">
                      <h3>
                        {t('PropertyForm.unit')} {index + 1}
                      </h3>
                      {kind === 'multi_unit' && units.length > 1 ? (
                        <Button
                          variant="danger"
                          onClick={() =>
                            setUnits((current) =>
                              current.filter((item) => item.localId !== unit.localId),
                            )
                          }
                        >
                          {t('PropertyForm.removeUnit')}
                        </Button>
                      ) : null}
                    </div>
                    <div className="form-grid">
                      <Field
                        id={`unit-code-${unit.localId}`}
                        label={t('PropertyForm.code')}
                        value={unit.code}
                        onChange={(event) => updateUnit(unit.localId, 'code', event.target.value)}
                        required
                      />
                      <Field
                        id={`unit-name-ar-${unit.localId}`}
                        label={t('PropertyForm.nameAr')}
                        value={unit.nameAr}
                        onChange={(event) => updateUnit(unit.localId, 'nameAr', event.target.value)}
                        required
                      />
                      <Field
                        id={`unit-name-en-${unit.localId}`}
                        label={t('PropertyForm.nameEn')}
                        value={unit.nameEn}
                        onChange={(event) => updateUnit(unit.localId, 'nameEn', event.target.value)}
                        required
                        dir="ltr"
                      />
                      <Field
                        id={`unit-floor-${unit.localId}`}
                        label={t('PropertyForm.floor')}
                        value={unit.floor}
                        onChange={(event) => updateUnit(unit.localId, 'floor', event.target.value)}
                      />
                      <Field
                        id={`unit-beds-${unit.localId}`}
                        type="number"
                        min={0}
                        max={50}
                        label={t('PropertyForm.bedrooms')}
                        value={unit.bedrooms}
                        onChange={(event) =>
                          updateUnit(unit.localId, 'bedrooms', event.target.value)
                        }
                        required
                      />
                      <Field
                        id={`unit-baths-${unit.localId}`}
                        type="number"
                        min={0}
                        max={50}
                        label={t('PropertyForm.bathrooms')}
                        value={unit.bathrooms}
                        onChange={(event) =>
                          updateUnit(unit.localId, 'bathrooms', event.target.value)
                        }
                        required
                      />
                      <Field
                        id={`unit-area-${unit.localId}`}
                        inputMode="decimal"
                        label={t('PropertyForm.area')}
                        value={unit.area}
                        onChange={(event) => updateUnit(unit.localId, 'area', event.target.value)}
                      />
                      <Field
                        id={`unit-rent-${unit.localId}`}
                        inputMode="decimal"
                        label={`${t('PropertyForm.rent')} (${currency})`}
                        value={unit.rent}
                        onChange={(event) => updateUnit(unit.localId, 'rent', event.target.value)}
                        required
                      />
                      <Field
                        id={`unit-deposit-${unit.localId}`}
                        inputMode="decimal"
                        label={`${t('PropertyForm.deposit')} (${currency})`}
                        value={unit.deposit}
                        onChange={(event) =>
                          updateUnit(unit.localId, 'deposit', event.target.value)
                        }
                      />
                      <label className="checkbox-row span-2">
                        <input
                          type="checkbox"
                          checked={unit.publishWhenAvailable}
                          onChange={(event) =>
                            updateUnit(unit.localId, 'publishWhenAvailable', event.target.checked)
                          }
                        />
                        {t('PropertyForm.publish')}
                      </label>
                    </div>
                  </fieldset>
                ))}
                {kind === 'multi_unit' ? (
                  <Button
                    variant="quiet"
                    onClick={() =>
                      setUnits((current) => [...current, blankUnit(current.length + 1)])
                    }
                  >
                    ＋ {t('PropertyForm.addUnit')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {step === 2 ? (
              <div className="upload-zone">
                <label htmlFor="property-images">
                  <strong>{t('PropertyForm.images')}</strong>
                  <p>{t('PropertyForm.imageHelp')}</p>
                </label>
                <input
                  id="property-images"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={selectImages}
                />
                <ul className="file-list">
                  {images.map((file) => (
                    <li key={`${file.name}-${file.lastModified}`}>
                      {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {step === 3 ? (
              <div>
                <h2>{t('PropertyForm.review')}</h2>
                <dl className="detail-facts">
                  <div>
                    <dt>{t('PropertyForm.basics')}</dt>
                    <dd>
                      {kind === 'single_unit' ? t('PropertyForm.single') : t('PropertyForm.multi')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('PropertyForm.units')}</dt>
                    <dd>{units.length}</dd>
                  </div>
                  <div>
                    <dt>{t('PropertyForm.media')}</dt>
                    <dd>{images.length}</dd>
                  </div>
                </dl>
                <p className="notice notice--info">{t('Property.watermark')}</p>
              </div>
            ) : null}
            {error ? (
              <div className="notice notice--error" role="alert">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="notice notice--success" role="status">
                {t('PropertyForm.success')}
              </div>
            ) : null}
            <div className="form-actions">
              {step > 0 ? (
                <Button
                  variant="quiet"
                  onClick={() => setStep((value) => value - 1)}
                  disabled={busy}
                >
                  {t('Common.back')}
                </Button>
              ) : (
                <span />
              )}
              {step < 3 ? (
                <Button type="submit" disabled={!validImages}>
                  {t('Common.continue')}
                </Button>
              ) : (
                <Button type="submit" disabled={busy || !validImages}>
                  {busy ? t('Common.saving') : t('PropertyForm.submit')}
                </Button>
              )}
            </div>
            <input type="hidden" name="portal" value={portal} />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
