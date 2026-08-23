'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button, Card, CardContent, Field, SelectField, TextAreaField } from '@bhd-r/ui';
import { useTranslations } from 'next-intl';
import { browserMutation } from '@/lib/api';
import type { UnitOption } from '@/lib/types';

export function MaintenanceForm({ units }: { units: UnitOption[] }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const idempotencyKey = useRef(`maintenance-ticket:${crypto.randomUUID()}`);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage(null);
    const form = new FormData(formElement);
    try {
      await browserMutation('/v1/maintenance', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey.current },
        body: JSON.stringify({
          unitId: formText(form, 'unitId'),
          title: formText(form, 'title'),
          description: formText(form, 'description'),
          priority: formText(form, 'priority'),
          category: formText(form, 'category'),
        }),
      });
      idempotencyKey.current = `maintenance-ticket:${crypto.randomUUID()}`;
      setMessage({ type: 'success', text: t('Maintenance.success') });
      formElement.reset();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'request_failed',
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-shell">
      <header className="portal-topbar">
        <div>
          <h1>{t('Maintenance.new')}</h1>
          <p>{t('Common.maintenance')}</p>
        </div>
      </header>
      <Card>
        <CardContent>
          <form className="form-grid" onSubmit={(event) => void submit(event)}>
            <SelectField id="maintenance-unit" name="unitId" label={t('Maintenance.unit')} required>
              <option value="">—</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="maintenance-priority"
              name="priority"
              label={t('Maintenance.priority')}
              required
            >
              {['low', 'normal', 'high', 'urgent'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </SelectField>
            <SelectField
              id="maintenance-category"
              name="category"
              label={t('Maintenance.category')}
              required
            >
              {['plumbing', 'electricity', 'hvac', 'appliance', 'structural', 'other'].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </SelectField>
            <Field
              id="maintenance-title"
              name="title"
              label={t('Maintenance.title')}
              minLength={3}
              maxLength={160}
              required
            />
            <TextAreaField
              id="maintenance-description"
              name="description"
              label={t('Maintenance.description')}
              minLength={3}
              maxLength={5000}
              required
              className="span-2"
            />
            {message ? (
              <div
                className={`notice notice--${message.type} span-2`}
                role={message.type === 'error' ? 'alert' : 'status'}
              >
                {message.text}
              </div>
            ) : null}
            <div className="span-2">
              <Button type="submit" disabled={busy}>
                {busy ? t('Common.saving') : t('Maintenance.submit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
