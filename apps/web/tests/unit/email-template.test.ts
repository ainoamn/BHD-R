import { describe, expect, it } from 'vitest';
import {
  BRANDED_MARK,
  COMPANY_NAME_AR,
  renderBrandedEmail,
  wrapLegacyEmail,
} from '@/lib/email-template';
import { closureProofMissing, type RequestMedia } from '@/lib/tenant-requests-shared';

const options = { origin: 'https://r.example.test', seed: 'seed-1' };

describe('branded email', () => {
  it('carries the logo, the company, the recipient and every detail', () => {
    const { html, text } = renderBrandedEmail(
      {
        tone: 'maintenance',
        recipientName: 'سالم',
        title: 'تم إصلاح المشكلة',
        details: [{ label: 'رقم الطلب', value: 'REQ-42' }],
        cta: { label: 'فتح الطلب', url: 'https://r.example.test/ar/tenant/requests' },
      },
      options,
    );
    expect(html).toContain(BRANDED_MARK);
    expect(html).toContain('https://r.example.test/brand/bhd-email-logo.png');
    expect(html).toContain(COMPANY_NAME_AR);
    expect(html).toContain('سالم');
    expect(html).toContain('REQ-42');
    expect(html).toContain('dir="rtl"');
    expect(text).toContain('REQ-42');
    expect(text).toContain('https://r.example.test/ar/tenant/requests');
  });

  it('escapes what users typed', () => {
    const { html } = renderBrandedEmail(
      { tone: 'request', recipientName: '<b>x</b>', title: 'a & b' },
      options,
    );
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('a &amp; b');
  });

  it('wraps a plain email once and keeps replacement patterns literal', () => {
    const wrapped = wrapLegacyEmail({ subject: 'Hello', text: 'Pay $& now\nthanks' }, options);
    expect(wrapped).toContain(BRANDED_MARK);
    expect(wrapped).toContain('Pay $&amp; now<br>thanks');
    expect(wrapLegacyEmail({ subject: 'Hello', text: '', html: wrapped }, options)).toBe(wrapped);
  });
});

describe('maintenance closure proof', () => {
  const item = (
    stage: RequestMedia['stage'],
    by: RequestMedia['by'],
    kind: RequestMedia['kind'] = 'photo',
  ): RequestMedia => ({ id: stage + by, kind, stage, by, name: null, at: '' });

  it('needs a team after-photo and a team selfie', () => {
    expect(closureProofMissing([])).toEqual(['after', 'selfie']);
    expect(closureProofMissing([item('after', 'tenant'), item('selfie', 'team', 'video')])).toEqual(
      ['after', 'selfie'],
    );
    expect(closureProofMissing([item('after', 'team')])).toEqual(['selfie']);
    expect(closureProofMissing([item('after', 'team'), item('selfie', 'team')])).toEqual([]);
  });
});
