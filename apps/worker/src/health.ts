import http from 'node:http';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { logger } from './logger.js';

export function startHealthServer(port: number, redis: Redis, pool: Pool): http.Server {
  const server = http.createServer((request, response) => {
    void handleHealthRequest(request, response, redis, pool);
  });
  server.listen(port, '0.0.0.0', () => logger.info({ port }, 'Worker health server listening'));
  return server;
}

async function handleHealthRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  redis: Redis,
  pool: Pool,
): Promise<void> {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  if (request.url === '/live') {
    response.writeHead(200).end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (request.url === '/ready') {
    try {
      await Promise.all([redis.ping(), pool.query('SELECT 1')]);
      response.writeHead(200).end(JSON.stringify({ status: 'ready' }));
    } catch {
      response.writeHead(503).end(JSON.stringify({ status: 'not-ready' }));
    }
    return;
  }
  response.writeHead(404).end(JSON.stringify({ code: 'NOT_FOUND' }));
}
