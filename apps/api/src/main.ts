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

  // Render scans ONLY process.env.PORT. Listening on a different port →
  // "failed to detect open port N from PORT environment variable".
  // On Render set Environment PORT=10000 (Render default). Do not leave PORT=4000.
  const onRender =
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_SERVICE_ID) ||
    Boolean(process.env.RENDER_EXTERNAL_URL);
  const port = Number(process.env.PORT || (onRender ? 10_000 : environment.PORT || 4000));
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${String(process.env.PORT)}`);
  }
  if (onRender && process.env.PORT === '4000') {
    console.error(
      'BHD-R API FATAL CONFIG: Render PORT=4000. Open Render → Environment → set PORT=10000 → Save → Manual Deploy.',
    );
  }

  console.log(
    `BHD-R API binding host=0.0.0.0 port=${port} (env.PORT=${process.env.PORT ?? '<unset>'} onRender=${onRender})`,
  );

  await app.listen(port, '0.0.0.0');
  console.log(`BHD-R API listening`, app.getHttpServer()?.address?.());

  try {
    const probe = await Promise.race([
      fastify.inject({ method: 'GET', url: '/health/live' }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('inject_timeout_3s')), 3_000);
      }),
    ]);
    console.log(`BHD-R API inject /health/live → ${probe.statusCode} ${probe.body}`);
  } catch (error) {
    console.error('BHD-R API inject /health/live failed', error);
  }
}

void bootstrap();
