// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import proxy from '@/proxy';

function requestFor(url: string, host: string, method = 'GET'): NextRequest {
  return new NextRequest(url, { method, headers: { host } });
}

describe('proxy canonical host', () => {
  it('sends baitak SSO start to r.bhd-om.com so the bhd-r redirect_uri is registered', () => {
    const response = proxy(
      requestFor(
        'https://baitak.bhd-om.com/api/auth/bhd/start?returnTo=/ar/portal',
        'baitak.bhd-om.com',
      ),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'https://r.bhd-om.com/api/auth/bhd/start?returnTo=/ar/portal',
    );
  });

  it('preserves page paths and query on alias hosts', () => {
    const response = proxy(
      requestFor('https://baitak.bhd-om.com/ar/properties?type=villa', 'baitak.bhd-om.com'),
    );
    expect(response.headers.get('location')).toBe('https://r.bhd-om.com/ar/properties?type=villa');
  });

  it('passes API routes through untouched on the canonical host', () => {
    const response = proxy(
      requestFor('https://r.bhd-om.com/api/auth/bhd/start', 'r.bhd-om.com'),
    );
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
