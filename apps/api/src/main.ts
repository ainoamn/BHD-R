import 'reflect-metadata';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { loadEnvironment } from '@bhd-r/config';
import { AppModule } from './app.module.js';
import { createInternalRequestId } from './common/request-id.js';
import { resolveCorsOrigin } from './common/web-origins.js';

function isPlatformHealthPath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0] ?? '';
  return path === '/healthz' || path === '/health/live' || path === '/health/ready';
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function proxyToNest(
  req: IncomingMessage,
  res: ServerResponse,
  nestPort: number,
): void {
  const headers = { ...req.headers, host: `127.0.0.1:${nestPort}` };
  const upstream = httpRequest(
    {
      hostname: '127.0.0.1',
      port: nestPort,
      path: req.url,
      method: req.method,
      headers,
      timeout: 120_000,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('timeout', () => {
    upstream.destroy();
    if (!res.headersSent) writeJson(res, 504, { error: 'nest_upstream_timeout' });
  });
  upstream.on('error', (error) => {
    console.error('BHD-R API proxy error', error);
    if (!res.headersSent) writeJson(res, 502, { error: 'nest_upstream_unreachable' });
  });
  req.pipe(upstream);
}

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  const onRender =
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_SERVICE_ID) ||
    Boolean(process.env.RENDER_EXTERNAL_URL);
  const publicPort = Number(process.env.PORT || (onRender ? 10_000 : environment.PORT || 4000));
  // Nest listens privately; public edge proxies to it (avoids Fastify+serverFactory hangs).
  const nestPort = Number(process.env.NEST_INTERNAL_PORT || publicPort + 1);
  if (!Number.isFinite(publicPort) || publicPort <= 0) {
    throw new Error(`Invalid PORT: ${String(process.env.PORT)}`);
  }

  let nestReady = false;

  const edge = createServer((req, res) => {
    if (isPlatformHealthPath(req.url)) {
      writeJson(res, 200, {
        status: 'ok',
        service: 'bhd-r-api',
        nestReady,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!nestReady) {
      writeJson(res, 503, { status: 'starting', service: 'bhd-r-api' });
      return;
    }
    proxyToNest(req, res, nestPort);
  });

  await new Promise<void>((resolve, reject) => {
    edge.once('error', reject);
    edge.listen(publicPort, '0.0.0.0', () => {
      console.log(`BHD-R API public edge listening`, edge.address());
      resolve();
    });
  });

  const adapter = new FastifyAdapter({
    trustProxy:
      Number.isInteger(trustedProxyHops) && trustedProxyHops > 0
        ? (trustedProxyHops as never)
        : false,
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
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity:
      environment.NODE_ENV === 'production'
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
        : false,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: false,
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
  fastify.get('/raw-ping', async () => ({ ok: true, via: 'nest-fastify' }));
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

  await app.listen(nestPort, '127.0.0.1');
  nestReady = true;
  console.log(`BHD-R API Nest listening on 127.0.0.1:${nestPort} (public ${publicPort})`);

  try {
    const ping = await fetch(`http://127.0.0.1:${nestPort}/raw-ping`, {
      signal: AbortSignal.timeout(5_000),
    });
    console.log(`BHD-R API internal /raw-ping → ${ping.status} ${await ping.text()}`);
  } catch (error) {
    console.error('BHD-R API internal /raw-ping failed', error);
  }
}

void bootstrap().catch((error) => {
  console.error('BHD-R API bootstrap failed', error);
  process.exit(1);
});
