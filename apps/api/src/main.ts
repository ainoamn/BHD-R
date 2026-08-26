import 'reflect-metadata';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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

async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  const onRender =
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_SERVICE_ID) ||
    Boolean(process.env.RENDER_EXTERNAL_URL);
  const publicPort = Number(process.env.PORT || (onRender ? 10_000 : environment.PORT || 4000));
  if (!Number.isFinite(publicPort) || publicPort <= 0) {
    throw new Error(`Invalid PORT: ${String(process.env.PORT)}`);
  }

  let nestHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

  // Edge owns PORT so Render health checks stay green while Express/Nest boots.
  const edge = createServer((req, res) => {
    if (isEdgeHealthPath(req.url)) {
      writeJson(res, 200, {
        status: 'ok',
        service: 'bhd-r-api',
        nestReady: Boolean(nestHandler),
        dispatch: 'express',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!nestHandler) {
      writeJson(res, 503, { status: 'starting', service: 'bhd-r-api' });
      return;
    }
    nestHandler(req, res);
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

  // Cookie + helmet before routes. Nest registers JSON body parsers when rawBody is enabled.
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

  await app.init();
  nestHandler = server as unknown as (req: IncomingMessage, res: ServerResponse) => void;
  console.log(`BHD-R API Nest Express ready (public ${publicPort})`);
}

void bootstrap().catch((error) => {
  console.error('BHD-R API bootstrap failed', error);
  process.exit(1);
});
