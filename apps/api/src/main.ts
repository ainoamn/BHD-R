import 'reflect-metadata';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { loadEnvironment } from '@bhd-r/config';
import { AppModule } from './app.module.js';
import { createInternalRequestId } from './common/request-id.js';
import { resolveCorsOrigin } from './common/web-origins.js';

function isEdgeHealthPath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0] ?? '';
  return path === '/healthz';
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function proxyToNest(req: IncomingMessage, res: ServerResponse, nestPort: number): void {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers[key] = value;
  }
  headers.host = `127.0.0.1:${nestPort}`;

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
      const out: Record<string, string | number | string[] | undefined> = { ...up.headers };
      delete out['transfer-encoding'];
      delete out.connection;
      res.writeHead(up.statusCode ?? 502, out);
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
  if (req.method === 'GET' || req.method === 'HEAD') {
    upstream.end();
  } else {
    req.pipe(upstream);
  }
}

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  const onRender =
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_SERVICE_ID) ||
    Boolean(process.env.RENDER_EXTERNAL_URL);
  const publicPort = Number(process.env.PORT || (onRender ? 10_000 : environment.PORT || 4000));
  const nestPort = Number(process.env.NEST_INTERNAL_PORT || publicPort + 1);
  if (!Number.isFinite(publicPort) || publicPort <= 0) {
    throw new Error(`Invalid PORT: ${String(process.env.PORT)}`);
  }

  let nestReady = false;

  const edge = createServer((req, res) => {
    if (isEdgeHealthPath(req.url)) {
      writeJson(res, 200, {
        status: 'ok',
        service: 'bhd-r-api',
        nestReady,
        dispatch: 'express-proxy',
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

  const server = express();
  server.disable('x-powered-by');
  if (Number.isInteger(trustedProxyHops) && trustedProxyHops > 0) {
    server.set('trust proxy', trustedProxyHops);
  }
  server.use((req, _res, next) => {
    req.id = createInternalRequestId();
    next();
  });
  server.get('/raw-ping', (_req, res) => {
    res.status(200).json({ ok: true, via: 'express' });
  });

  const adapter = new ExpressAdapter(server);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, adapter, {
    bufferLogs: false,
    rawBody: true,
  });

  app.use(cookieParser());
  app.use(
    helmet({
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
      hsts:
        environment.NODE_ENV === 'production'
          ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
          : false,
    }),
  );

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
  console.log(`BHD-R API Nest Express listening on 127.0.0.1:${nestPort} (public ${publicPort})`);

  try {
    const ping = await fetch(`http://127.0.0.1:${nestPort}/raw-ping`, {
      signal: AbortSignal.timeout(5_000),
    });
    console.log(`BHD-R API internal /raw-ping → ${ping.status} ${await ping.text()}`);
  } catch (error) {
    console.error('BHD-R API internal /raw-ping failed', error);
    throw error;
  }
}

void bootstrap().catch((error) => {
  console.error('BHD-R API bootstrap failed', error);
  process.exit(1);
});
