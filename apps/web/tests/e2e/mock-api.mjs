import { createServer } from 'node:http';

const listing = {
  id: '00000000-0000-4000-8000-000000000010',
  slug: 'qurum-residence-u-102',
  propertyId: '00000000-0000-4000-8000-000000000011',
  unitId: '00000000-0000-4000-8000-000000000010',
  propertyNameAr: 'دار القرم',
  propertyNameEn: 'Qurum Residence',
  unitNameAr: 'الوحدة ١٠٢',
  unitNameEn: 'Unit 102',
  category: 'apartment',
  governorate: 'Muscat',
  wilayat: 'Bawshar',
  bedrooms: 2,
  bathrooms: 2,
  areaSquareMeters: '118.5',
  rent: { amountMinor: '450000', currency: 'OMR' },
  coverImageUrl: null,
  available: true,
  publishedAt: '2026-08-01T00:00:00.000Z',
};
const viewer = {
  id: '00000000-0000-4000-8000-000000000002',
  username: 'bhd-r-test',
  email: 'test@bhd-om.example',
  partyId: '00000000-0000-4000-8000-000000000003',
  displayName: 'BHD R Test User',
  locale: 'ar',
  organizationId: '00000000-0000-4000-8000-000000000001',
  roles: ['platform_admin', 'organization_owner', 'developer_admin', 'tenant'],
  permissions: ['property.create'],
};
const overview = {
  occupancyPercent: 92,
  collectedMinor: '18250000',
  currency: 'OMR',
  openTickets: 3,
  expiringContracts: 2,
  recentActivity: [],
};

const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (request.url === '/health') {
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.url?.startsWith('/v1/public/listings')) {
    response.end(
      JSON.stringify({ data: [listing], pagination: { nextCursor: null, hasMore: false } }),
    );
    return;
  }
  if (request.url === '/v1/me') {
    response.end(JSON.stringify(viewer));
    return;
  }
  if (/^\/v1\/(platform|owner|developer|tenant)\/overview$/.test(request.url ?? '')) {
    response.end(JSON.stringify(overview));
    return;
  }
  if (request.url === '/v1/auth/csrf') {
    response.end(JSON.stringify({ token: 'test-csrf-token' }));
    return;
  }
  if (/^\/v1\/(platform|owner|developer|tenant)\//.test(request.url ?? '')) {
    response.end(JSON.stringify({ data: [] }));
    return;
  }
  response.statusCode = 404;
  response.end(
    JSON.stringify({ error: { code: 'not_found', message: 'Not found', requestId: 'e2e' } }),
  );
});

server.listen(4000, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
