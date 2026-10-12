import { describe, expect, it } from 'vitest';
import {
  greetingName,
  leaseCheckoutGreeting,
  stayCheckoutGreeting,
} from '@/lib/booking-step-greeting';

describe('booking step greetings', () => {
  it('greets by first name, tidying capitals and skipping placeholder names', () => {
    expect(greetingName('ABDUL HAMID AL RAWAHI')).toBe('Abdul');
    expect(greetingName('  عبدالحميد الرواحي ')).toBe('عبدالحميد');
    expect(greetingName('مستخدم BHD')).toBe('');
    expect(greetingName('BHD user')).toBe('');
    expect(greetingName(null)).toBe('');
  });

  it('picks a scene and a warm heading for every step', () => {
    const stay = stayCheckoutGreeting('stay', { ar: true, title: 'مبنى النور', name: '' });
    expect(stay.kind).toBe('stay');
    expect(stay.heading).toContain('مبنى النور');
    expect(stayCheckoutGreeting('guest', { ar: true, title: '', name: 'Abdul' }).heading).toContain(
      'Abdul',
    );
    expect(stayCheckoutGreeting('payment', { ar: false, title: '', name: '' }).kind).toBe(
      'payment',
    );
    expect(leaseCheckoutGreeting('terms', { ar: true, sale: true, name: '' }).heading).toContain(
      'عقارك الجديد',
    );
    expect(leaseCheckoutGreeting('details', { ar: true, sale: false, name: '' }).kind).toBe(
      'details',
    );
  });
});
