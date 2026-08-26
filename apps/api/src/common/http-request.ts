/** Shared helpers so guards/interceptors work on Express (and stay Fastify-tolerant). */

export function requestRoutePath(request: {
  routeOptions?: { url?: string };
  route?: { path?: string };
  url?: string;
}): string {
  return request.routeOptions?.url ?? request.route?.path ?? request.url?.split('?')[0] ?? '';
}

export function requestIdOf(request: { id?: string; headers?: Record<string, unknown> }): string {
  if (typeof request.id === 'string' && request.id) return request.id;
  const header = request.headers?.['x-request-id'];
  return typeof header === 'string' ? header : 'unknown';
}
