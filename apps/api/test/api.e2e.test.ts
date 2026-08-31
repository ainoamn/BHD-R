import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('API runtime boundaries (Express)', () => {
  let app: NestExpressApplication;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const serverAdapter = express();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({
        asSystem: async () => {
          throw new Error('database_not_used_in_boundary_tests');
        },
        withinTenant: async () => {
          throw new Error('database_not_used_in_boundary_tests');
        },
        asPublic: async () => {
          throw new Error('database_not_used_in_boundary_tests');
        },
        asWebhookConsumer: async () => {
          throw new Error('database_not_used_in_boundary_tests');
        },
      })
      .compile();
    app = module.createNestApplication<NestExpressApplication>(
      new ExpressAdapter(serverAdapter),
      { rawBody: true },
    );
    app.useLogger(false);
    await app.init();
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server_address_unavailable');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the liveness endpoint from the assembled application', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      service: 'bhd-r-api',
    });
  });

  it('denies protected API routes by default without authentication', async () => {
    const response = await fetch(`${baseUrl}/v1/finance/invoices`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'Authentication is required' },
    });
  });

  it('preserves the raw webhook body and rejects an invalid signature before database work', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await fetch(`${baseUrl}/v1/webhooks/payments/test-provider`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-event-id': 'runtime-regression-event',
        'x-bhd-signature': `t=${timestamp},v1=${'0'.repeat(64)}`,
      },
      body: JSON.stringify({ event: 'payment.settled' }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'Invalid webhook signature' },
    });
  });

  it('rejects a signed reservation_deposit webhook with an invalid payload shape', async () => {
    const { createHmac } = await import('node:crypto');
    const secret = process.env.PAYMENT_WEBHOOK_SECRET?.trim() || 'development-webhook-secret';
    const body = JSON.stringify({
      kind: 'reservation_deposit',
      organizationId: '00000000-0000-4000-8000-000000000001',
      // missing checkoutSessionReference / money fields
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const response = await fetch(`${baseUrl}/v1/webhooks/payments/test-provider`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-event-id': `runtime-reservation-shape-${timestamp}`,
        'x-bhd-signature': `t=${timestamp},v1=${signature}`,
      },
      body,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a signed stay_booking webhook with an invalid payload shape', async () => {
    const { createHmac } = await import('node:crypto');
    const secret = process.env.PAYMENT_WEBHOOK_SECRET?.trim() || 'development-webhook-secret';
    const body = JSON.stringify({
      kind: 'stay_booking',
      organizationId: '00000000-0000-4000-8000-000000000001',
      // missing paymentIntentId / money fields
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const response = await fetch(`${baseUrl}/v1/webhooks/payments/test-provider`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-event-id': `runtime-stay-booking-shape-${timestamp}`,
        'x-bhd-signature': `t=${timestamp},v1=${signature}`,
      },
      body,
    });
    expect(response.status).toBe(400);
  });

  it('hides public stays search while the platform flag is off', async () => {
    const response = await fetch(`${baseUrl}/v1/public/stays/search?locale=ar&adults=1`);
    expect(response.status).toBe(404);
  });

  it('hides public stay quote/hold/booking while the platform flag is off', async () => {
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': 'e2e-stays-quote-hold-pay-01',
    };
    const quote = await fetch(`${baseUrl}/v1/public/stays/demo-listing/quotes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        checkInOn: '2030-01-10',
        checkOutOn: '2030-01-12',
        adults: 1,
      }),
    });
    expect(quote.status).toBe(404);

    const availability = await fetch(
      `${baseUrl}/v1/public/stays/demo-listing/availability?checkInOn=2030-01-10&checkOutOn=2030-01-12&adults=1`,
    );
    expect(availability.status).toBe(404);

    const hold = await fetch(`${baseUrl}/v1/public/stays/holds`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ quoteId: '00000000-0000-4000-8000-000000000099' }),
    });
    expect(hold.status).toBe(404);

    const booking = await fetch(`${baseUrl}/v1/public/stays/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ holdId: '00000000-0000-4000-8000-000000000098' }),
    });
    expect(booking.status).toBe(404);
  });

  it('hides guest stay trips and public booking lookup while the platform flag is off', async () => {
    const lookup = await fetch(
      `${baseUrl}/v1/public/stays/bookings/lookup?referenceCode=ST-DEADBEEF`,
    );
    expect(lookup.status).toBe(404);

    const guestList = await fetch(`${baseUrl}/v1/guest/stays/bookings`);
    expect([401, 404]).toContain(guestList.status);
  });

  it('hides stays performance reports while the platform flag is off', async () => {
    const response = await fetch(
      `${baseUrl}/v1/stays/reports/performance?fromOn=2026-08-01&toOn=2026-08-31`,
    );
    expect([401, 404]).toContain(response.status);
  });

  it('hides stay payment-session create while the platform flag is off', async () => {
    const response = await fetch(`${baseUrl}/v1/public/stays/payment-sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'e2e-stay-pay-session-01',
      },
      body: JSON.stringify({
        paymentIntentId: '00000000-0000-4000-8000-000000000097',
        locale: 'ar',
        returnPath: '/ar/guest/stays',
      }),
    });
    expect(response.status).toBe(404);
  });

  it('requires auth for ops stay bookings list while the platform flag is off', async () => {
    const response = await fetch(`${baseUrl}/v1/stays/bookings`);
    expect([401, 404]).toContain(response.status);
  });
});
