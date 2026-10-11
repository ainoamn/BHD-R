import { describe, expect, it } from 'vitest';
import {
  friendlyGuestName,
  stayGuestGreeting,
  stayJourneyInitialStep,
  stayJourneyScreens,
} from '@/lib/stay-guest-greeting';

const stageOf = (status: string, welcome = false) =>
  stayGuestGreeting({ status, ar: true, welcome, guestName: 'ABDUL HAMID' })?.stage;

describe('guest stay greeting', () => {
  it('follows the booking from request to farewell', () => {
    expect(stageOf('request_pending', true)).toBe('submitted');
    expect(stageOf('request_pending')).toBe('review');
    expect(stageOf('confirmed', true)).toBe('confirmed');
    expect(stageOf('checked_in')).toBe('checked_in');
    expect(stageOf('checked_out')).toBe('checked_out');
    expect(stageOf('rejected')).toBe('ended');
  });

  it('guides a new request through every step and greets by name', () => {
    const greeting = stayGuestGreeting({
      status: 'request_pending',
      ar: true,
      welcome: true,
      guestName: 'ABDUL HAMID AL RAWAHI',
    });
    expect(greeting?.headline).toContain('Abdul Hamid Al Rawahi');
    expect(greeting?.guide).toHaveLength(4);
  });

  it('opens only reached steps, each with its own screen', () => {
    const screens = (status: string) =>
      stayJourneyScreens({ status, ar: true, welcome: false, mode: 'request' }).map(
        (screen) => screen?.stage ?? null,
      );
    expect(screens('request_pending')).toEqual(['submitted', 'review', null, null]);
    expect(screens('confirmed')).toEqual(['submitted', 'confirmed', 'confirmed', null]);
    expect(screens('checked_in')).toEqual(['submitted', 'confirmed', 'checked_in', 'checked_in']);
    expect(screens('checked_out')).toEqual(['submitted', 'confirmed', 'checked_in', 'checked_out']);
    expect(stayJourneyInitialStep('request_pending', true)).toBe(0);
    expect(stayJourneyInitialStep('confirmed', true)).toBe(2);
    expect(stayJourneyInitialStep('checked_out', false)).toBe(3);
  });

  it('tidies all-caps names only', () => {
    expect(friendlyGuestName('ABDUL HAMID AL RAWAHI')).toBe('Abdul Hamid Al Rawahi');
    expect(friendlyGuestName('عبدالحميد')).toBe('عبدالحميد');
    expect(friendlyGuestName('McDonald')).toBe('McDonald');
    expect(friendlyGuestName('  ')).toBeNull();
  });
});
