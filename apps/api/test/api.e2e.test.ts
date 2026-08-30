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
});
