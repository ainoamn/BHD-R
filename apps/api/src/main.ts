import 'reflect-metadata';
import {
  createServer,
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

const BODY_LIMIT = 26 * 1024 * 1024;

type EdgeDispatch = (req: IncomingMessage, res: ServerResponse) => void;

/** Minimal inject surface — avoids FastifyInstance type clashes across pnpm copies + cookie plugin. */
type InjectDispatcher = {
  inject: (opts: {
    method: string;
    url: string;
    headers?: Record<string, string | string[] | undefined>;
    remoteAddress?: string;
    payload?: Buffer;
  }) => Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | number | undefined>;
    body: string;
    rawPayload?: Buffer;
  }>;
};

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

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > BODY_LIMIT) {
      const error = new Error('payload_too_large') as Error & { statusCode: number };
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buf);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function dispatchViaInject(
  req: IncomingMessage,
  res: ServerResponse,
  fastify: InjectDispatcher,
): Promise<void> {
  try {
    const payload = await readRequestBody(req);
    const injectOpts: {
      method: string;
      url: string;
      headers: Record<string, string | string[] | undefined>;
      remoteAddress?: string;
      payload?: Buffer;
    } = {
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: req.headers as Record<string, string | string[] | undefined>,
    };
    if (req.socket.remoteAddress) injectOpts.remoteAddress = req.socket.remoteAddress;
    if (payload) injectOpts.payload = payload;

    const response = await fastify.inject(injectOpts);
    const outHeaders: Record<string, string | number | string[]> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      // Let Node derive length from the body we write.
      if (
        lower === 'transfer-encoding' ||
        lower === 'connection' ||
        lower === 'content-length' ||
        lower === 'keep-alive'
      ) {
        continue;
      }
      outHeaders[key] = value as string | number | string[];
    }
    const body = Buffer.isBuffer(response.rawPayload)
      ? response.rawPayload
      : Buffer.from(String(response.body ?? ''));
    outHeaders['content-length'] = body.length;
    res.writeHead(response.statusCode, outHeaders);
    res.end(body);
  } catch (error) {
    const status =
      typeof error === 'object' &&
      error &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 502;
    console.error('BHD-R API inject dispatch failed', error);
    if (!res.headersSent) {
      writeJson(res, status, {
        error: status === 413 ? 'payload_too_large' : 'nest_inject_failed',
      });
    }
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
  if (!Number.isFinite(publicPort) || publicPort <= 0) {
    throw new Error(`Invalid PORT: ${String(process.env.PORT)}`);
  }

  let edgeDispatch: EdgeDispatch | null = null;

  const edge = createServer((req, res) => {
    if (isEdgeHealthPath(req.url)) {
      writeJson(res, 200, {
        status: 'ok',
        service: 'bhd-r-api',
        nestReady: Boolean(edgeDispatch),
        dispatch: 'inject',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!edgeDispatch) {
      writeJson(res, 503, { status: 'starting', service: 'bhd-r-api' });
      return;
    }
    edgeDispatch(req, res);
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
    bodyLimit: BODY_LIMIT,
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
  fastify.get('/raw-ping', async () => ({ ok: true, via: 'nest-inject' }));
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

  // Do NOT call app.listen(): on Render, Fastify TCP accept works but HTTP handling hangs
  // (loopback fetch / proxy to :PORT+1 time out). inject() still works after ready().
  await fastify.ready();

  try {
    const ping = await fastify.inject({ method: 'GET', url: '/raw-ping' });
    console.log(`BHD-R API inject /raw-ping → ${ping.statusCode} ${ping.body}`);
    if (ping.statusCode !== 200) {
      throw new Error(`inject /raw-ping returned ${ping.statusCode}`);
    }
  } catch (error) {
    console.error('BHD-R API inject /raw-ping failed', error);
    throw error;
  }

  edgeDispatch = (req, res) => {
    void dispatchViaInject(req, res, fastify);
  };
  console.log(`BHD-R API Nest ready via inject dispatch (public ${publicPort})`);
}

void bootstrap().catch((error) => {
  console.error('BHD-R API bootstrap failed', error);
  process.exit(1);
});
