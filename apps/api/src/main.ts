import 'reflect-metadata';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { loadEnvironment } from '@bhd-r/config';
import { AppModule } from './app.module.js';
import { createInternalRequestId } from './common/request-id.js';
import { resolveCorsOrigin } from './common/web-origins.js';

function isPlatformHealthPath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0] ?? '';
  return path === '/healthz' || path === '/health/live' || path === '/health/ready';
}

function writeHealthOk(res: ServerResponse): void {
  const body = JSON.stringify({
    status: 'ok',
    service: 'bhd-r-api',
    timestamp: new Date().toISOString(),
  });
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
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
      'BHD-R API FATAL CONFIG: Render PORT=4000. Set Environment PORT=10000 → Save → Manual Deploy.',
    );
  }

  /**
   * Render Free Docker health + Vercel /api/warm must not depend on Nest/DB.
   * Nest Fastify handlers were hanging on Render; answer health at the Node layer.
   */
  let nodeServer: Server | undefined;
  const fastify = Fastify({
    serverFactory(handler) {
      nodeServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (isPlatformHealthPath(req.url)) {
          writeHealthOk(res);
          return;
        }
        handler(req, res);
      });
      return nodeServer;
    },
    trustProxy:
      Number.isInteger(trustedProxyHops) && trustedProxyHops > 0
        ? (trustedProxyHops as unknown as boolean)
        : false,
    bodyLimit: 26 * 1024 * 1024,
    genReqId: createInternalRequestId,
  });

  await fastify.register(cookie as never);
  await fastify.register(helmet as never, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity:
      environment.NODE_ENV === 'production'
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
        : false,
  });

  // Native Fastify probe (does not use Nest). Helps diagnose Nest-vs-Fastify hangs.
  fastify.get('/raw-ping', async () => ({ ok: true, via: 'fastify-native' }));

  const adapter = new FastifyAdapter(fastify as never);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    rawBody: true,
  });
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

  console.log(
    `BHD-R API binding host=0.0.0.0 port=${port} (env.PORT=${process.env.PORT ?? '<unset>'} onRender=${onRender})`,
  );

  await app.listen(port, '0.0.0.0');
  console.log(`BHD-R API listening`, nodeServer?.address?.() ?? app.getHttpServer()?.address?.());

  try {
    const self = await Promise.race([
      fetch(`http://127.0.0.1:${port}/healthz`).then(async (response) => ({
        status: response.status,
        body: await response.text(),
      })),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('tcp_healthz_timeout_3s')), 3_000);
      }),
    ]);
    console.log(`BHD-R API TCP /healthz → ${self.status} ${self.body}`);
  } catch (error) {
    console.error('BHD-R API TCP /healthz failed', error);
  }
}

void bootstrap();
