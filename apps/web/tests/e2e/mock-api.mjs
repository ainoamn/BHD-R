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
  listingPurpose: 'rent',
  rent: { amountMinor: '450000', currency: 'OMR' },
  salePrice: null,
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

const ids = {
  property: '00000000-0000-4000-8000-000000000011',
  unit: '00000000-0000-4000-8000-000000000010',
  party: '00000000-0000-4000-8000-000000000003',
  user: '00000000-0000-4000-8000-000000000002',
  vendor: '00000000-0000-4000-8000-000000000020',
  lease: '00000000-0000-4000-8000-000000000030',
  invoice: '00000000-0000-4000-8000-000000000040',
  account: '00000000-0000-4000-8000-000000000050',
};

const context = {
  properties: [{ id: ids.property, nameAr: 'دار القرم', nameEn: 'Qurum Residence' }],
  units: [{ id: ids.unit, propertyId: ids.property, code: 'U-102', nameAr: 'الوحدة ١٠٢' }],
  parties: [{ id: ids.party, nameAr: 'أحمد البلوشي', nameEn: 'Ahmed Al Balushi' }],
  users: [{ id: ids.user, name: 'مدير المحفظة' }],
  vendors: [{ id: ids.vendor, nameAr: 'حلول مسقط للصيانة', nameEn: 'Muscat Maintenance' }],
  maintenanceTickets: [],
  leases: [{ id: ids.lease, title: 'LR-2026-001' }],
  invoices: [
    {
      id: ids.invoice,
      invoiceNumber: 'INV-2026-0001',
      currency: 'OMR',
      outstandingMinor: '275000',
    },
  ],
  contractTemplates: [],
  ledgerAccounts: [
    { id: ids.account, code: '1100', nameAr: 'البنك', nameEn: 'Bank', currency: 'OMR' },
    {
      id: '00000000-0000-4000-8000-000000000051',
      code: '4100',
      nameAr: 'إيراد الإيجار',
      nameEn: 'Rental income',
      currency: 'OMR',
    },
  ],
};

const rowsByPath = new Map([
  [
    '/v1/owner/properties',
    [
      {
        id: ids.property,
        nameAr: 'دار القرم',
        nameEn: 'Qurum Residence',
        kind: 'multi_unit',
        defaultCurrency: 'OMR',
        status: 'active',
        units: [listing],
      },
    ],
  ],
  ['/v1/developer/projects', []],
  [
    '/v1/operations/requests',
    [
      {
        id: 'req-1',
        reference: 'REQ-2026-0142',
        subject: 'تحديث بيانات المستأجر',
        type: 'customer_service',
        priority: 'normal',
        status: 'in_progress',
        dueAt: '2026-08-25T09:00:00.000Z',
      },
    ],
  ],
  [
    '/v1/operations/viewings',
    [
      {
        id: 'view-1',
        reference: 'VIEW-0041',
        unitId: ids.unit,
        status: 'scheduled',
        scheduledAt: '2026-08-26T14:30:00.000Z',
      },
    ],
  ],
  ['/v1/leasing/holds', []],
  ['/v1/leasing/reservations', []],
  [
    '/v1/leasing/leases',
    [
      {
        id: ids.lease,
        unitId: ids.unit,
        tenantPartyId: ids.party,
        status: 'active',
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        rentMinor: '450000',
        currency: 'OMR',
      },
    ],
  ],
  [
    '/v1/leasing/contracts',
    [
      {
        id: '00000000-0000-4000-8000-000000000031',
        unitId: ids.unit,
        status: 'partially_signed',
        sentAt: '2026-08-20T08:00:00.000Z',
      },
    ],
  ],
  [
    '/v1/operations/sales',
    [
      {
        id: 'sale-1',
        reference: 'SALE-2026-008',
        propertyId: ids.property,
        status: 'negotiation',
        askingPriceMinor: '125000000',
        agreedPriceMinor: '121000000',
        currency: 'OMR',
        expectedClosingOn: '2026-09-15',
      },
    ],
  ],
  [
    '/v1/finance/invoices',
    [
      {
        id: ids.invoice,
        invoiceNumber: 'INV-2026-0001',
        status: 'partially_paid',
        totalMinor: '450000',
        paidMinor: '175000',
        currency: 'OMR',
        dueOn: '2026-08-01',
      },
    ],
  ],
  [
    '/v1/finance/payments',
    [
      {
        id: 'payment-1',
        providerReference: 'BANK-90118',
        status: 'succeeded',
        amountMinor: '175000',
        currency: 'OMR',
        method: 'bank_transfer',
        receivedAt: '2026-08-18T10:20:00.000Z',
      },
    ],
  ],
  [
    '/v1/accounting/journals',
    [
      {
        id: 'journal-1',
        reference: 'JV-2026-0038',
        occurredOn: '2026-08-18',
        description: 'تحصيل إيجار أغسطس',
        debitMinor: '175000',
        creditMinor: '175000',
        currency: 'OMR',
        status: 'posted',
      },
    ],
  ],
  [
    '/v1/accounting/trial-balance',
    [
      {
        id: ids.account,
        code: '1100',
        nameAr: 'البنك',
        nameEn: 'Bank',
        debitMinor: '175000',
        creditMinor: '0',
        currency: 'OMR',
      },
    ],
  ],
  [
    '/v1/accounting/expenses',
    [
      {
        id: 'expense-1',
        reference: 'EXP-2026-0062',
        description: 'صيانة مضخة المياه',
        amountMinor: '85000',
        currency: 'OMR',
        status: 'approved',
        expenseDate: '2026-08-17',
      },
    ],
  ],
  [
    '/v1/maintenance',
    [
      {
        id: 'ticket-1',
        reference: 'MNT-2026-0091',
        title: 'ضعف ضغط المياه',
        priority: 'high',
        status: 'assigned',
        createdAt: '2026-08-21T06:45:00.000Z',
      },
    ],
  ],
  [
    '/v1/operations/work-orders',
    [
      {
        id: 'wo-1',
        reference: 'WO-2026-0077',
        title: 'استبدال مضخة المياه',
        vendorId: ids.vendor,
        estimatedCostMinor: '85000',
        currency: 'OMR',
        status: 'approved',
        scheduledFor: '2026-08-24T07:00:00.000Z',
      },
    ],
  ],
  [
    '/v1/operations/tasks',
    [
      {
        id: 'task-1',
        reference: 'TSK-2026-0108',
        title: 'مراجعة تجديد العقد',
        assigneeUserId: ids.user,
        priority: 'high',
        status: 'in_progress',
        dueAt: '2026-08-28T08:00:00.000Z',
      },
    ],
  ],
  [
    '/v1/operations/legal-cases',
    [
      {
        id: 'legal-1',
        reference: 'LEG-2026-0014',
        title: 'متابعة إشعار قانوني',
        caseType: 'notice',
        status: 'in_progress',
        nextHearingAt: '2026-09-02T06:00:00.000Z',
        claimedAmountMinor: '900000',
        currency: 'OMR',
      },
    ],
  ],
  [
    '/v1/operations/approvals',
    [
      {
        id: 'approval-1',
        reference: 'APR-2026-0045',
        subject: 'اعتماد عرض صيانة',
        entityType: 'work_order',
        status: 'pending',
        amountMinor: '85000',
        currency: 'OMR',
        requestedAt: '2026-08-22T07:00:00.000Z',
      },
    ],
  ],
  [
    '/v1/reports',
    [
      {
        id: 'report-1',
        type: 'portfolio_summary',
        format: 'pdf',
        status: 'completed',
        createdAt: '2026-08-22T05:30:00.000Z',
      },
    ],
  ],
  [
    '/v1/organizations/current/members',
    [
      {
        id: 'member-1',
        name: 'سالم الحارثي',
        email: 'salim@example.test',
        role: 'property_manager',
        status: 'active',
      },
    ],
  ],
]);

const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (path === '/health') {
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (path.startsWith('/v1/public/listings')) {
    response.end(
      JSON.stringify({ data: [listing], pagination: { nextCursor: null, hasMore: false } }),
    );
    return;
  }
  if (path === '/v1/me') {
    response.end(JSON.stringify(viewer));
    return;
  }
  if (/^\/v1\/(platform|owner|developer|tenant)\/overview$/.test(path)) {
    response.end(JSON.stringify(overview));
    return;
  }
  if (path === '/v1/auth/csrf') {
    response.end(JSON.stringify({ token: 'test-csrf-token' }));
    return;
  }
  if (path === '/v1/operations/context') {
    response.end(JSON.stringify(context));
    return;
  }
  if (path === '/v1/operations/sales/totals') {
    response.end(
      JSON.stringify({ openDeals: 4, pipelineMinor: '430000000', wonMinor: '121000000' }),
    );
    return;
  }
  if (path === '/v1/accounting/dashboard') {
    response.end(JSON.stringify({ postedJournals: 38, draftJournals: 2, expensesMinor: '485000' }));
    return;
  }
  if (path === '/v1/reports/operational-summary') {
    response.end(
      JSON.stringify({ activeLeases: 22, openTickets: 3, pendingApprovals: 1, overdueInvoices: 2 }),
    );
    return;
  }
  if (request.method !== 'GET' && path.startsWith('/v1/')) {
    request.resume();
    response.statusCode = 200;
    response.end(JSON.stringify({ id: crypto.randomUUID(), status: 'pending', ok: true }));
    return;
  }
  if (rowsByPath.has(path)) {
    response.end(JSON.stringify(rowsByPath.get(path)));
    return;
  }
  if (/^\/v1\/(platform|owner|developer|tenant)\//.test(path)) {
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
