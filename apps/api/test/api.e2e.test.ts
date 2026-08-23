import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('API runtime boundaries', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const adapter = new FastifyAdapter({ bodyLimit: 2 * 1024 * 1024 });
    await adapter.register(cookie as never);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(adapter, {
      rawBody: true,
    });
    app.useLogger(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the liveness endpoint from the assembled application', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'bhd-r-api' });
  });

  it('denies protected API routes by default without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/finance/invoices' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { message: 'Authentication is required' } });
  });

  it('preserves the raw webhook body and rejects an invalid signature before database work', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/payments/test-provider',
      headers: {
        'content-type': 'application/json',
        'x-event-id': 'runtime-regression-event',
        'x-bhd-signature': `t=${timestamp},v1=${'0'.repeat(64)}`,
      },
      payload: JSON.stringify({ event: 'payment.settled' }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { message: 'Invalid webhook signature' } });
  });
});
