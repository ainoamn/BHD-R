import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeaseContractForm, type LeaseContractPayload } from '@/components/lease-contract-form';
import type { PropertyRecordUnit } from '@/lib/property-records-neon';

const unit: PropertyRecordUnit = {
  id: 'faedb8bb-f2c8-4ec5-a37e-306d60b96213',
  code: 'U-01',
  rentMinor: '800000',
  salePriceMinor: null,
  depositMinor: null,
  currency: 'OMR',
  floor: '2',
  areaSquareMeters: '120',
  electricityMeter: 'E-1',
  waterMeter: 'W-1',
};

function renderForm(onSubmit = vi.fn()) {
  render(
    createElement(LeaseContractForm, {
      units: [unit],
      tenants: [
        {
          id: '2b1c3c5e-0d0a-4c35-9f0b-0f4c1b9a7d11',
          displayName: 'أحمد',
          type: 'person',
          email: 'a@example.com',
          phone: '+968900',
        },
      ],
      canSign: true,
      locale: 'ar',
      busy: false,
      onSubmit,
      onCancel: vi.fn(),
    }),
  );
  return onSubmit;
}

afterEach(cleanup);

describe('LeaseContractForm', () => {
  it('builds a 12-month cheque schedule from the unit rent and shows the summary', () => {
    renderForm();
    expect(screen.getAllByLabelText('رقم الشيك')).toHaveLength(12);
    expect(screen.getByText('١ إجمالي الإيجارات')).toBeInTheDocument();
    expect(screen.getByText('٥ إجمالي العقد')).toBeInTheDocument();
  });

  it('auto-numbers cheques and submits tenant + terms', () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText('استيراد المستأجر من دفتر العناوين'), {
      target: { value: '2b1c3c5e-0d0a-4c35-9f0b-0f4c1b9a7d11' },
    });
    const cheques = screen.getAllByLabelText('رقم الشيك');
    fireEvent.change(cheques[0]!, { target: { value: '000101' } });
    fireEvent.click(screen.getByText('ترقيم الشيكات تلقائياً من الشيك الأول'));
    const [, addAdjustment] = screen.getAllByText('＋ إضافة بند', { selector: 'button' });
    fireEvent.click(addAdjustment!);
    fireEvent.submit(screen.getByText('إنشاء عقد الإيجار').closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();

    const items = screen.getAllByPlaceholderText('البند (مثال: إنترنت، مواقف)');
    fireEvent.change(items[0]!, { target: { value: 'إنترنت' } });
    const amounts = screen.getAllByPlaceholderText('المبلغ');
    fireEvent.change(amounts[amounts.length - 1]!, { target: { value: '10' } });
    fireEvent.submit(screen.getByText('إنشاء عقد الإيجار').closest('form')!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]![0] as LeaseContractPayload;
    expect(payload.tenant.partyId).toBe('2b1c3c5e-0d0a-4c35-9f0b-0f4c1b9a7d11');
    expect(payload.tenant.nameAr).toBe('أحمد');
    expect(payload.terms.monthlyRent).toBe('800');
    expect(payload.terms.schedule).toHaveLength(12);
    expect(payload.terms.schedule[11]!.chequeNumber).toBe('000112');
    expect(payload.terms.adjustments).toEqual([
      expect.objectContaining({
        kind: 'add',
        title: 'إنترنت',
        amount: '10',
        recurrence: 'monthly',
      }),
    ]);
  });
});
