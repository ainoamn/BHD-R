import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { loadEnvironment } from '@bhd-r/config';
import { AppModule } from './app.module.js';
import { createInternalRequestId } from './common/request-id.js';

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  const adapter = new FastifyAdapter({
    trustProxy:
      Number.isInteger(trustedProxyHops) && trustedProxyHops > 0 ? trustedProxyHops : false,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: createInternalRequestId,
  });
  await adapter.register(cookie as never);
  await adapter.register(helmet as never, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity:
      environment.NODE_ENV === 'production'
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
        : false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    rawBody: true,
  });
  app.enableCors({
    origin: [environment.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-api-key',
      'x-csrf-token',
      'x-organization-id',
      'idempotency-key',
      'x-request-id',
    ],
  });
  app.enableShutdownHooks();
  await app.listen({ port: environment.PORT, host: '0.0.0.0' });
}

void bootstrap();
