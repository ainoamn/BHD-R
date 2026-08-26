import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { loadEnvironment } from '@bhd-r/config';
import { AppModule } from './app.module.js';
import { createInternalRequestId } from './common/request-id.js';
import { resolveCorsOrigin } from './common/web-origins.js';

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  const adapter = new FastifyAdapter({
    trustProxy:
      Number.isInteger(trustedProxyHops) && trustedProxyHops > 0 ? trustedProxyHops : false,
    // Property images/docs upload through Nest ingress (up to 25MB).
    bodyLimit: 26 * 1024 * 1024,
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
    // Allow browser CORS reads from the web origin (media ingress PUT).
    crossOriginResourcePolicy: { policy: 'cross-origin' },
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
  const fastify = app.getHttpAdapter().getInstance();
  const asBuffer = (_request: unknown, body: Buffer, done: (err: null, body: Buffer) => void) => {
    done(null, body);
  };
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, asBuffer);
  fastify.addContentTypeParser('application/pdf', { parseAs: 'buffer' }, asBuffer);
  fastify.addContentTypeParser('image/jpeg', { parseAs: 'buffer' }, asBuffer);
  fastify.addContentTypeParser('image/png', { parseAs: 'buffer' }, asBuffer);
  fastify.addContentTypeParser('image/webp', { parseAs: 'buffer' }, asBuffer);
  app.enableCors({
    origin: resolveCorsOrigin,
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
      'x-requested-with',
    ],
  });
  app.enableShutdownHooks();

  // Render's default public port is 10000. A dashboard PORT=4000 makes Node bind 4000 while
  // Render's scanner/proxy still expects 10000 → "No open HTTP ports" forever.
  const onRender =
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_SERVICE_ID) ||
    Boolean(process.env.RENDER_EXTERNAL_URL);
  const port = onRender ? 10_000 : Number(process.env.PORT || environment.PORT || 4000);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${String(process.env.PORT)}`);
  }
  if (onRender && process.env.PORT && process.env.PORT !== '10000') {
    console.warn(
      `BHD-R API: ignoring process.env.PORT=${process.env.PORT} on Render; forcing 10000`,
    );
  }
  if (onRender) {
    process.env.PORT = '10000';
  }

  console.log(
    `BHD-R API binding host=0.0.0.0 port=${port} (env.PORT=${process.env.PORT ?? '<unset>'} onRender=${onRender})`,
  );

  await app.listen(port, '0.0.0.0');
  console.log(`BHD-R API listening`, app.getHttpServer()?.address?.());

  const probe = await fastify.inject({ method: 'GET', url: '/health/live' });
  console.log(`BHD-R API inject /health/live → ${probe.statusCode} ${probe.body}`);
  if (probe.statusCode >= 400) {
    throw new Error(`Health inject failed: ${probe.statusCode}`);
  }
}

void bootstrap();
