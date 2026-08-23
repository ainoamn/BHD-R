'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { CurrencyCode } from '@bhd-r/contracts';
import { browserMutation } from '@/lib/api';
import { formatMoney, toMinorUnits } from '@/lib/format';
import type { PortalRole } from '@/lib/types';
import type { OperationsSection } from './operations-workspace';

type DataRow = Record<string, unknown>;

interface OptionRow {
  id: string;
  name?: string;
  nameAr?: string;
  nameEn?: string;
  code?: string;
  title?: string;
  invoiceNumber?: string;
  key?: string;
  version?: number;
  currency?: string;
  outstandingMinor?: string;
  status?: string;
}

export interface OperationsContext {
  properties?: OptionRow[];
  units?: Array<OptionRow & { propertyId?: string }>;
  parties?: OptionRow[];
  users?: OptionRow[];
  vendors?: OptionRow[];
  maintenanceTickets?: OptionRow[];
  leases?: OptionRow[];
  invoices?: OptionRow[];
  contractTemplates?: OptionRow[];
  ledgerAccounts?: OptionRow[];
}

interface Column {
  key: string;
  ar: string;
  en: string;
  format?: 'status' | 'money' | 'date' | 'count' | 'kind';
  fallbackKeys?: string[];
}

interface SectionDefinition {
  titleAr: string;
  titleEn: string;
  introAr: string;
  introEn: string;
  createAr?: string;
  createEn?: string;
  columns: Column[];
  flow: Array<{ value: string; ar: string; en: string }>;
  moneyKey?: string;
}

const definitions: Record<OperationsSection, SectionDefinition> = {
  properties: {
    titleAr: 'المحفظة العقارية',
    titleEn: 'Property portfolio',
    introAr: 'العقارات والوحدات وحالتها التشغيلية والإعلانية في سجل موحد.',
    introEn: 'Properties, units, operational availability and publishing in one register.',
    createAr: 'إضافة عقار متكامل',
    createEn: 'Add complete property',
    columns: [
      { key: 'nameAr', fallbackKeys: ['nameEn', 'name'], ar: 'العقار', en: 'Property' },
      { key: 'kind', ar: 'النوع', en: 'Kind', format: 'kind' },
      { key: 'units', ar: 'الوحدات', en: 'Units', format: 'count' },
      { key: 'defaultCurrency', ar: 'العملة', en: 'Currency' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
    flow: [
      { value: 'draft', ar: 'مسودة', en: 'Draft' },
      { value: 'active', ar: 'نشط', en: 'Active' },
      { value: 'inactive', ar: 'متوقف', en: 'Inactive' },
      { value: 'archived', ar: 'مؤرشف', en: 'Archived' },
    ],
  },
  requests: {
    titleAr: 'مركز الطلبات وخدمة العملاء',
    titleEn: 'Requests & customer service',
    introAr: 'استقبال الطلبات وربطها بالعقار أو الوحدة وإسنادها ومتابعة زمن إنجازها.',
    introEn: 'Receive, assign and track requests connected to properties and units.',
    createAr: 'طلب جديد',
    createEn: 'New request',
    columns: [
      { key: 'reference', ar: 'المرجع', en: 'Reference' },
      { key: 'subject', ar: 'الموضوع', en: 'Subject' },
      { key: 'type', ar: 'النوع', en: 'Type' },
      { key: 'priority', ar: 'الأولوية', en: 'Priority', format: 'status' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'dueAt', ar: 'الاستحقاق', en: 'Due', format: 'date' },
    ],
    flow: [
      { value: 'pending', ar: 'جديد', en: 'New' },
      { value: 'approved', ar: 'معتمد', en: 'Approved' },
      { value: 'in_progress', ar: 'قيد التنفيذ', en: 'In progress' },
      { value: 'completed', ar: 'مكتمل', en: 'Completed' },
    ],
  },
  bookings: {
    titleAr: 'الحجوزات والمعاينات',
    titleEn: 'Bookings & viewings',
    introAr: 'من طلب المعاينة والحجز المؤقت حتى التأكيد والتحويل إلى عقد إيجار.',
    introEn: 'From a viewing request and hold through confirmation and lease conversion.',
    createAr: 'حجز معاينة',
    createEn: 'Schedule viewing',
    columns: [
      { key: 'recordKind', ar: 'السجل', en: 'Record', format: 'kind' },
      { key: 'reference', fallbackKeys: ['id'], ar: 'المرجع', en: 'Reference' },
      { key: 'unitId', ar: 'الوحدة', en: 'Unit' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      {
        key: 'scheduledAt',
        fallbackKeys: ['preferredAt', 'expiresAt'],
        ar: 'الموعد/الانتهاء',
        en: 'Schedule/expiry',
        format: 'date',
      },
    ],
    flow: [
      { value: 'requested', ar: 'طلب معاينة', en: 'Requested' },
      { value: 'scheduled', ar: 'مجدول', en: 'Scheduled' },
      { value: 'pending', ar: 'حجز أولي', en: 'Pending' },
      { value: 'confirmed', ar: 'مؤكد', en: 'Confirmed' },
      { value: 'converted', ar: 'تحول لعقد', en: 'Converted' },
    ],
  },
  leasing: {
    titleAr: 'إدارة التأجير',
    titleEn: 'Leasing management',
    introAr: 'إنشاء عقود الإيجار وتفعيلها وتجديدها وإنهاؤها مع ربط المستأجر والفوترة.',
    introEn: 'Create, activate, renew and close leases linked to tenants and billing.',
    createAr: 'عقد إيجار جديد',
    createEn: 'New lease',
    columns: [
      { key: 'id', ar: 'العقد', en: 'Lease' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'startsOn', ar: 'البداية', en: 'Starts', format: 'date' },
      { key: 'endsOn', ar: 'النهاية', en: 'Ends', format: 'date' },
      { key: 'rentMinor', ar: 'الإيجار', en: 'Rent', format: 'money' },
    ],
    flow: [
      { value: 'draft', ar: 'مسودة', en: 'Draft' },
      { value: 'active', ar: 'نشط', en: 'Active' },
      { value: 'ended', ar: 'منتهٍ', en: 'Ended' },
      { value: 'terminated', ar: 'مفسوخ', en: 'Terminated' },
    ],
    moneyKey: 'rentMinor',
  },
  sales: {
    titleAr: 'مبيعات العقارات',
    titleEn: 'Property sales',
    introAr: 'مسار البيع من العميل المحتمل والمعاينة والعرض والتفاوض حتى الإغلاق والعمولة.',
    introEn: 'A sales pipeline from lead and viewing through offer, closing and commission.',
    createAr: 'صفقة بيع جديدة',
    createEn: 'New sales deal',
    columns: [
      { key: 'reference', ar: 'الصفقة', en: 'Deal' },
      { key: 'propertyId', ar: 'العقار', en: 'Property' },
      { key: 'status', ar: 'المرحلة', en: 'Stage', format: 'status' },
      { key: 'askingPriceMinor', ar: 'السعر المطلوب', en: 'Asking price', format: 'money' },
      { key: 'agreedPriceMinor', ar: 'السعر المتفق', en: 'Agreed price', format: 'money' },
      { key: 'expectedClosingOn', ar: 'الإغلاق المتوقع', en: 'Expected close', format: 'date' },
    ],
    flow: [
      { value: 'lead', ar: 'عميل محتمل', en: 'Lead' },
      { value: 'qualified', ar: 'مؤهل', en: 'Qualified' },
      { value: 'viewing', ar: 'معاينة', en: 'Viewing' },
      { value: 'offer', ar: 'عرض', en: 'Offer' },
      { value: 'negotiation', ar: 'تفاوض', en: 'Negotiation' },
      { value: 'reserved', ar: 'محجوز', en: 'Reserved' },
      { value: 'contracting', ar: 'تعاقد', en: 'Contracting' },
      { value: 'closed_won', ar: 'مغلقة بنجاح', en: 'Closed won' },
    ],
    moneyKey: 'askingPriceMinor',
  },
  contracts: {
    titleAr: 'العقود والتوقيع الإلكتروني',
    titleEn: 'Contracts & e-signatures',
    introAr: 'إعداد العقود وإرسالها ومتابعة توقيع أطرافها وحفظ دليل التوقيع والنسخة النهائية.',
    introEn: 'Prepare, send and track multi-party signatures and final evidence.',
    columns: [
      { key: 'id', ar: 'العقد', en: 'Contract' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'unitId', ar: 'الوحدة', en: 'Unit' },
      { key: 'sentAt', ar: 'تاريخ الإرسال', en: 'Sent', format: 'date' },
      { key: 'completedAt', ar: 'تاريخ الاكتمال', en: 'Completed', format: 'date' },
    ],
    flow: [
      { value: 'draft', ar: 'مسودة', en: 'Draft' },
      { value: 'sent', ar: 'مرسل', en: 'Sent' },
      { value: 'partially_signed', ar: 'توقيع جزئي', en: 'Partially signed' },
      { value: 'signed', ar: 'موقع', en: 'Signed' },
    ],
  },
  invoices: {
    titleAr: 'الفواتير والاستحقاقات',
    titleEn: 'Invoices & receivables',
    introAr: 'إصدار الفواتير ومتابعة الاستحقاق والتحصيل الجزئي والكامل والمتأخرات.',
    introEn: 'Issue invoices and track due, partial, paid and overdue balances.',
    createAr: 'إصدار فاتورة',
    createEn: 'Issue invoice',
    columns: [
      { key: 'invoiceNumber', ar: 'رقم الفاتورة', en: 'Invoice' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'totalMinor', ar: 'الإجمالي', en: 'Total', format: 'money' },
      { key: 'paidMinor', ar: 'المدفوع', en: 'Paid', format: 'money' },
      { key: 'dueOn', ar: 'الاستحقاق', en: 'Due', format: 'date' },
    ],
    flow: [
      { value: 'issued', ar: 'صادرة', en: 'Issued' },
      { value: 'partially_paid', ar: 'مدفوعة جزئياً', en: 'Part paid' },
      { value: 'paid', ar: 'مدفوعة', en: 'Paid' },
      { value: 'overdue', ar: 'متأخرة', en: 'Overdue' },
    ],
    moneyKey: 'totalMinor',
  },
  payments: {
    titleAr: 'المدفوعات والإيصالات',
    titleEn: 'Payments & receipts',
    introAr: 'تسجيل المدفوعات ومنع التكرار ومطابقتها مع الفواتير ومراجع البنوك والبوابات.',
    introEn: 'Record idempotent payments and reconcile them to invoices and provider references.',
    createAr: 'تسجيل دفعة',
    createEn: 'Record payment',
    columns: [
      { key: 'providerReference', ar: 'مرجع الدفع', en: 'Payment reference' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'amountMinor', ar: 'المبلغ', en: 'Amount', format: 'money' },
      { key: 'method', ar: 'الطريقة', en: 'Method', format: 'kind' },
      { key: 'receivedAt', ar: 'الاستلام', en: 'Received', format: 'date' },
    ],
    flow: [
      { value: 'pending', ar: 'معلقة', en: 'Pending' },
      { value: 'succeeded', ar: 'ناجحة', en: 'Succeeded' },
      { value: 'refunded', ar: 'مستردة', en: 'Refunded' },
      { value: 'failed', ar: 'فاشلة', en: 'Failed' },
    ],
    moneyKey: 'amountMinor',
  },
  accounting: {
    titleAr: 'المحاسبة والأستاذ العام',
    titleEn: 'Accounting & general ledger',
    introAr: 'دليل الحسابات والقيود المزدوجة وميزان المراجعة والترحيل والعكس بسجل تدقيق.',
    introEn: 'Chart of accounts, double-entry journals, posting, reversal and trial balance.',
    createAr: 'قيد يومية متوازن',
    createEn: 'Balanced journal',
    columns: [
      { key: 'reference', ar: 'القيد', en: 'Journal' },
      { key: 'occurredOn', ar: 'التاريخ', en: 'Date', format: 'date' },
      { key: 'description', ar: 'البيان', en: 'Description' },
      { key: 'debitMinor', ar: 'مدين', en: 'Debit', format: 'money' },
      { key: 'creditMinor', ar: 'دائن', en: 'Credit', format: 'money' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
    flow: [
      { value: 'draft', ar: 'مسودة', en: 'Draft' },
      { value: 'posted', ar: 'مرحّل', en: 'Posted' },
      { value: 'reversed', ar: 'معكوس', en: 'Reversed' },
    ],
    moneyKey: 'debitMinor',
  },
  expenses: {
    titleAr: 'المصروفات والموافقات',
    titleEn: 'Expenses & approvals',
    introAr: 'مصروفات العقارات والوحدات وأوامر العمل مع الضريبة والموافقة والدفع.',
    introEn: 'Property, unit and work-order expenses with tax, approval and payment.',
    createAr: 'مصروف جديد',
    createEn: 'New expense',
    columns: [
      { key: 'reference', ar: 'المرجع', en: 'Reference' },
      { key: 'description', ar: 'البيان', en: 'Description' },
      { key: 'category', ar: 'الفئة', en: 'Category', format: 'kind' },
      { key: 'amountMinor', ar: 'المبلغ', en: 'Amount', format: 'money' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'issuedOn', ar: 'التاريخ', en: 'Date', format: 'date' },
    ],
    flow: [
      { value: 'pending', ar: 'بانتظار الموافقة', en: 'Pending' },
      { value: 'approved', ar: 'معتمد', en: 'Approved' },
      { value: 'in_progress', ar: 'قيد الدفع', en: 'Processing' },
      { value: 'completed', ar: 'مدفوع', en: 'Paid' },
    ],
    moneyKey: 'amountMinor',
  },
  maintenance: {
    titleAr: 'بلاغات الصيانة',
    titleEn: 'Maintenance tickets',
    introAr: 'بلاغات المستأجرين والأعطال والأولوية وتأثير العطل على توفر الوحدة.',
    introEn: 'Tenant tickets, faults, priority and their effect on unit availability.',
    createAr: 'بلاغ صيانة',
    createEn: 'Maintenance ticket',
    columns: [
      { key: 'title', ar: 'البلاغ', en: 'Ticket' },
      { key: 'category', ar: 'الفئة', en: 'Category', format: 'kind' },
      { key: 'priority', ar: 'الأولوية', en: 'Priority', format: 'status' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'blocksAvailability', ar: 'يوقف العرض', en: 'Blocks listing', format: 'kind' },
      { key: 'createdAt', ar: 'تاريخ البلاغ', en: 'Opened', format: 'date' },
    ],
    flow: [
      { value: 'open', ar: 'مفتوح', en: 'Open' },
      { value: 'assigned', ar: 'مسند', en: 'Assigned' },
      { value: 'in_progress', ar: 'قيد التنفيذ', en: 'In progress' },
      { value: 'resolved', ar: 'تم الحل', en: 'Resolved' },
      { value: 'closed', ar: 'مغلق', en: 'Closed' },
    ],
  },
  'work-orders': {
    titleAr: 'أوامر العمل والموردون',
    titleEn: 'Work orders & vendors',
    introAr: 'تسعير واعتماد وجدولة وتنفيذ وفحص أعمال الصيانة مع مقارنة التكلفة.',
    introEn: 'Quote, approve, schedule, execute and verify maintenance work with cost control.',
    createAr: 'أمر عمل',
    createEn: 'New work order',
    columns: [
      { key: 'reference', ar: 'أمر العمل', en: 'Work order' },
      { key: 'scope', ar: 'النطاق', en: 'Scope' },
      { key: 'status', ar: 'المرحلة', en: 'Stage', format: 'status' },
      { key: 'estimateMinor', ar: 'التقدير', en: 'Estimate', format: 'money' },
      { key: 'actualMinor', ar: 'الفعلي', en: 'Actual', format: 'money' },
      { key: 'scheduledAt', ar: 'الموعد', en: 'Scheduled', format: 'date' },
    ],
    flow: [
      { value: 'draft', ar: 'مسودة', en: 'Draft' },
      { value: 'quoted', ar: 'مسعر', en: 'Quoted' },
      { value: 'awaiting_approval', ar: 'بانتظار الاعتماد', en: 'Awaiting approval' },
      { value: 'approved', ar: 'معتمد', en: 'Approved' },
      { value: 'scheduled', ar: 'مجدول', en: 'Scheduled' },
      { value: 'in_progress', ar: 'قيد التنفيذ', en: 'In progress' },
      { value: 'verified', ar: 'مفحوص ومغلق', en: 'Verified' },
    ],
    moneyKey: 'estimateMinor',
  },
  tasks: {
    titleAr: 'المهام وسير العمل',
    titleEn: 'Tasks & workflow',
    introAr: 'مهام مرتبطة بالعقار والعقد والطلب مع مسؤول وموعد وأولوية وقائمة تحقق.',
    introEn: 'Assigned, due and prioritized tasks linked to every operational record.',
    createAr: 'مهمة جديدة',
    createEn: 'New task',
    columns: [
      { key: 'reference', ar: 'المهمة', en: 'Task' },
      { key: 'title', ar: 'العنوان', en: 'Title' },
      { key: 'category', ar: 'الفئة', en: 'Category', format: 'kind' },
      { key: 'priority', ar: 'الأولوية', en: 'Priority', format: 'status' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'dueAt', ar: 'الاستحقاق', en: 'Due', format: 'date' },
    ],
    flow: [
      { value: 'pending', ar: 'جديدة', en: 'New' },
      { value: 'approved', ar: 'معتمدة', en: 'Approved' },
      { value: 'in_progress', ar: 'قيد التنفيذ', en: 'In progress' },
      { value: 'on_hold', ar: 'معلقة', en: 'On hold' },
      { value: 'completed', ar: 'مكتملة', en: 'Completed' },
    ],
  },
  legal: {
    titleAr: 'المحاماة والقضايا',
    titleEn: 'Legal cases',
    introAr: 'الإنذارات والقضايا والجلسات والتنفيذ والتسويات والمبالغ المستردة والمواعيد.',
    introEn: 'Notices, cases, hearings, enforcement, settlements, recovery and deadlines.',
    createAr: 'فتح ملف قانوني',
    createEn: 'Open legal case',
    columns: [
      { key: 'reference', ar: 'الملف', en: 'Case' },
      { key: 'title', ar: 'الموضوع', en: 'Subject' },
      { key: 'caseType', ar: 'النوع', en: 'Type', format: 'kind' },
      { key: 'status', ar: 'المرحلة', en: 'Stage', format: 'status' },
      { key: 'claimAmountMinor', ar: 'المطالبة', en: 'Claim', format: 'money' },
      { key: 'nextHearingAt', ar: 'الجلسة القادمة', en: 'Next hearing', format: 'date' },
    ],
    flow: [
      { value: 'assessment', ar: 'تقييم', en: 'Assessment' },
      { value: 'notice', ar: 'إنذار', en: 'Notice' },
      { value: 'filed', ar: 'مرفوعة', en: 'Filed' },
      { value: 'hearing', ar: 'جلسات', en: 'Hearing' },
      { value: 'judgment', ar: 'حكم', en: 'Judgment' },
      { value: 'enforcement', ar: 'تنفيذ', en: 'Enforcement' },
      { value: 'closed', ar: 'مغلقة', en: 'Closed' },
    ],
    moneyKey: 'claimAmountMinor',
  },
  approvals: {
    titleAr: 'مركز الاعتمادات',
    titleEn: 'Approval center',
    introAr: 'قرارات موحدة للمصروفات وأوامر العمل والعروض والاستثناءات مع دليل القرار.',
    introEn: 'Central decisions for expenses, work orders, offers and exceptions.',
    columns: [
      { key: 'reference', ar: 'الطلب', en: 'Request' },
      { key: 'subject', ar: 'الموضوع', en: 'Subject' },
      { key: 'type', ar: 'النوع', en: 'Type', format: 'kind' },
      { key: 'status', ar: 'القرار', en: 'Decision', format: 'status' },
      { key: 'createdAt', ar: 'الطلب', en: 'Requested', format: 'date' },
      { key: 'decidedAt', ar: 'البت', en: 'Decided', format: 'date' },
    ],
    flow: [
      { value: 'pending', ar: 'بانتظار القرار', en: 'Pending' },
      { value: 'approved', ar: 'معتمد', en: 'Approved' },
      { value: 'rejected', ar: 'مرفوض', en: 'Rejected' },
    ],
  },
  reports: {
    titleAr: 'التقارير ومؤشرات الأداء',
    titleEn: 'Reports & performance',
    introAr: 'تقارير الإشغال والتحصيل والمتأخرات والمبيعات والصيانة والقضايا والمحاسبة.',
    introEn: 'Occupancy, collection, arrears, sales, maintenance, legal and accounting reports.',
    createAr: 'إنشاء تقرير',
    createEn: 'Generate report',
    columns: [
      { key: 'type', ar: 'التقرير', en: 'Report', format: 'kind' },
      { key: 'format', ar: 'الصيغة', en: 'Format' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'createdAt', ar: 'الطلب', en: 'Requested', format: 'date' },
      { key: 'expiresAt', ar: 'انتهاء الملف', en: 'Expires', format: 'date' },
    ],
    flow: [
      { value: 'queued', ar: 'في الطابور', en: 'Queued' },
      { value: 'processing', ar: 'قيد الإنشاء', en: 'Processing' },
      { value: 'ready', ar: 'جاهز', en: 'Ready' },
      { value: 'failed', ar: 'تعذر', en: 'Failed' },
    ],
  },
  team: {
    titleAr: 'الفريق والممثلون',
    titleEn: 'Team & representatives',
    introAr: 'المشرفون والممثلون والأدوار والصلاحيات المفوضة لإدارة المحفظة.',
    introEn: 'Supervisors, representatives, roles and delegated portfolio permissions.',
    columns: [
      { key: 'displayName', fallbackKeys: ['name', 'userId'], ar: 'المستخدم', en: 'User' },
      { key: 'roleKey', ar: 'الدور', en: 'Role', format: 'kind' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'createdAt', ar: 'منذ', en: 'Since', format: 'date' },
    ],
    flow: [
      { value: 'active', ar: 'نشط', en: 'Active' },
      { value: 'inactive', ar: 'موقوف', en: 'Inactive' },
    ],
  },
};

function scalar(row: DataRow, column: Column): unknown {
  const keys = [column.key, ...(column.fallbackKeys ?? [])];
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function labelForOption(option: OptionRow, locale: 'ar' | 'en'): string {
  return (
    (locale === 'ar' ? option.nameAr : option.nameEn) ??
    option.name ??
    option.title ??
    option.invoiceNumber ??
    option.code ??
    option.key ??
    option.id
  );
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optional(value: string): string | undefined {
  return value || undefined;
}

function toIsoDateTime(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function moneyFromRecord(row: DataRow, key: string, locale: 'ar' | 'en'): string {
  const value = row[key];
  if (value === undefined || value === null || value === '') return '—';
  const currency = typeof row.currency === 'string' ? row.currency : 'OMR';
  return formatMoney(String(value), currency, locale);
}

function statusTone(status: string): string {
  if (
    [
      'active',
      'approved',
      'completed',
      'closed_won',
      'paid',
      'posted',
      'ready',
      'verified',
      'signed',
      'succeeded',
    ].includes(status)
  )
    return 'positive';
  if (
    ['urgent', 'overdue', 'failed', 'rejected', 'cancelled', 'terminated', 'closed_lost'].includes(
      status,
    )
  )
    return 'negative';
  if (
    [
      'pending',
      'draft',
      'on_hold',
      'awaiting_approval',
      'partially_paid',
      'partially_signed',
    ].includes(status)
  )
    return 'warning';
  return 'neutral';
}

function displayCell(
  row: DataRow,
  column: Column,
  locale: 'ar' | 'en',
  context: OperationsContext,
): ReactNode {
  const value = scalar(row, column);
  if (value === null) return '—';
  if (column.format === 'count') return Array.isArray(value) ? value.length : String(value);
  if (column.format === 'money') return moneyFromRecord(row, column.key, locale);
  if (column.format === 'date') {
    const date = new Date(String(value));
    return Number.isNaN(date.valueOf())
      ? String(value)
      : new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
          dateStyle: 'medium',
        }).format(date);
  }
  if (column.format === 'status') {
    const status = String(value);
    return (
      <span className={`ops-status ops-status--${statusTone(status)}`}>
        {status.replaceAll('_', ' ')}
      </span>
    );
  }
  if (typeof value === 'boolean')
    return value ? (locale === 'ar' ? 'نعم' : 'Yes') : locale === 'ar' ? 'لا' : 'No';
  if (column.key.endsWith('Id')) {
    const sources = [
      ...(context.properties ?? []),
      ...(context.units ?? []),
      ...(context.parties ?? []),
      ...(context.users ?? []),
      ...(context.vendors ?? []),
      ...(context.maintenanceTickets ?? []),
      ...(context.leases ?? []),
    ];
    const match = sources.find((option) => option.id === String(value));
    return match ? labelForOption(match, locale) : String(value).slice(0, 8);
  }
  if (typeof value === 'object') return Array.isArray(value) ? String(value.length) : '—';
  return String(value).replaceAll('_', ' ');
}

function SelectOptions({
  name,
  label,
  options,
  locale,
  required = false,
}: {
  name: string;
  label: string;
  options: OptionRow[];
  locale: 'ar' | 'en';
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="select" name={name} required={required} defaultValue="">
        <option value="">{locale === 'ar' ? 'اختر…' : 'Select…'}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {labelForOption(option, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Input({
  name,
  label,
  type = 'text',
  required = false,
  defaultValue,
  min,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  min?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        min={min}
      />
    </label>
  );
}

function CurrencySelect({ locale }: { locale: 'ar' | 'en' }) {
  return (
    <label className="field">
      <span>{locale === 'ar' ? 'العملة' : 'Currency'}</span>
      <select className="select" name="currency" defaultValue="OMR">
        {['OMR', 'AED', 'SAR', 'BHD', 'KWD', 'QAR', 'USD'].map((currency) => (
          <option key={currency}>{currency}</option>
        ))}
      </select>
    </label>
  );
}

function PrioritySelect({ locale }: { locale: 'ar' | 'en' }) {
  return (
    <label className="field">
      <span>{locale === 'ar' ? 'الأولوية' : 'Priority'}</span>
      <select className="select" name="priority" defaultValue="normal">
        <option value="low">{locale === 'ar' ? 'منخفضة' : 'Low'}</option>
        <option value="normal">{locale === 'ar' ? 'عادية' : 'Normal'}</option>
        <option value="high">{locale === 'ar' ? 'عالية' : 'High'}</option>
        <option value="urgent">{locale === 'ar' ? 'عاجلة' : 'Urgent'}</option>
      </select>
    </label>
  );
}

function CreateFields({
  section,
  locale,
  context,
}: {
  section: OperationsSection;
  locale: 'ar' | 'en';
  context: OperationsContext;
}) {
  const ar = locale === 'ar';
  const today = new Date().toISOString().slice(0, 10);
  const inOneMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  switch (section) {
    case 'requests':
      return (
        <>
          <Input name="subject" label={ar ? 'موضوع الطلب' : 'Request subject'} required />
          <Input
            name="type"
            label={ar ? 'نوع الطلب' : 'Request type'}
            required
            defaultValue="customer_service"
          />
          <PrioritySelect locale={locale} />
          <SelectOptions
            name="propertyId"
            label={ar ? 'العقار' : 'Property'}
            options={context.properties ?? []}
            locale={locale}
          />
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة' : 'Unit'}
            options={context.units ?? []}
            locale={locale}
          />
          <Input name="dueAt" label={ar ? 'موعد الاستحقاق' : 'Due date'} type="datetime-local" />
          <label className="field span-2">
            <span>{ar ? 'التفاصيل' : 'Details'}</span>
            <textarea className="textarea" name="description" />
          </label>
        </>
      );
    case 'tasks':
      return (
        <>
          <Input name="title" label={ar ? 'عنوان المهمة' : 'Task title'} required />
          <Input
            name="category"
            label={ar ? 'الفئة' : 'Category'}
            required
            defaultValue="operations"
          />
          <PrioritySelect locale={locale} />
          <SelectOptions
            name="assignedToUserId"
            label={ar ? 'المسؤول' : 'Assignee'}
            options={context.users ?? []}
            locale={locale}
          />
          <SelectOptions
            name="propertyId"
            label={ar ? 'العقار' : 'Property'}
            options={context.properties ?? []}
            locale={locale}
          />
          <Input name="dueAt" label={ar ? 'موعد الإنجاز' : 'Due'} type="datetime-local" />
          <label className="field span-2">
            <span>{ar ? 'الوصف' : 'Description'}</span>
            <textarea className="textarea" name="description" />
          </label>
        </>
      );
    case 'bookings':
      return (
        <>
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة' : 'Unit'}
            options={context.units ?? []}
            locale={locale}
            required
          />
          <SelectOptions
            name="prospectPartyId"
            label={ar ? 'العميل المحتمل' : 'Prospect'}
            options={context.parties ?? []}
            locale={locale}
            required
          />
          <Input
            name="scheduledAt"
            label={ar ? 'موعد المعاينة' : 'Viewing time'}
            type="datetime-local"
            required
          />
          <Input name="channel" label={ar ? 'المصدر' : 'Channel'} defaultValue="website" required />
          <label className="field span-2">
            <span>{ar ? 'ملاحظات' : 'Notes'}</span>
            <textarea className="textarea" name="notes" />
          </label>
        </>
      );
    case 'leasing':
      return (
        <>
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة' : 'Unit'}
            options={context.units ?? []}
            locale={locale}
            required
          />
          <SelectOptions
            name="ownerPartyId"
            label={ar ? 'المالك' : 'Owner'}
            options={context.parties ?? []}
            locale={locale}
            required
          />
          <SelectOptions
            name="tenantPartyId"
            label={ar ? 'المستأجر' : 'Tenant'}
            options={context.parties ?? []}
            locale={locale}
            required
          />
          <SelectOptions
            name="templateVersionId"
            label={ar ? 'قالب العقد' : 'Contract template'}
            options={context.contractTemplates ?? []}
            locale={locale}
            required
          />
          <Input
            name="startsOn"
            label={ar ? 'تاريخ البداية' : 'Starts'}
            type="date"
            required
            defaultValue={today}
          />
          <Input
            name="endsOn"
            label={ar ? 'تاريخ النهاية' : 'Ends'}
            type="date"
            required
            defaultValue={inOneMonth}
          />
          <Input name="rent" label={ar ? 'الإيجار' : 'Rent'} type="number" min="0" required />
          <Input name="deposit" label={ar ? 'التأمين' : 'Deposit'} type="number" min="0" />
          <Input
            name="billingDay"
            label={ar ? 'يوم الفوترة' : 'Billing day'}
            type="number"
            min="1"
            defaultValue="1"
            required
          />
          <CurrencySelect locale={locale} />
        </>
      );
    case 'sales':
      return (
        <>
          <SelectOptions
            name="propertyId"
            label={ar ? 'العقار' : 'Property'}
            options={context.properties ?? []}
            locale={locale}
            required
          />
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة' : 'Unit'}
            options={context.units ?? []}
            locale={locale}
          />
          <SelectOptions
            name="sellerPartyId"
            label={ar ? 'البائع' : 'Seller'}
            options={context.parties ?? []}
            locale={locale}
            required
          />
          <SelectOptions
            name="buyerPartyId"
            label={ar ? 'المشتري المحتمل' : 'Buyer'}
            options={context.parties ?? []}
            locale={locale}
          />
          <Input
            name="askingPrice"
            label={ar ? 'السعر المطلوب' : 'Asking price'}
            type="number"
            min="0"
            required
          />
          <Input name="commission" label={ar ? 'العمولة' : 'Commission'} type="number" min="0" />
          <CurrencySelect locale={locale} />
          <Input
            name="expectedClosingOn"
            label={ar ? 'الإغلاق المتوقع' : 'Expected close'}
            type="date"
          />
        </>
      );
    case 'invoices':
      return (
        <>
          <SelectOptions
            name="leaseId"
            label={ar ? 'عقد الإيجار' : 'Lease'}
            options={context.leases ?? []}
            locale={locale}
            required
          />
          <Input
            name="description"
            label={ar ? 'بيان الفاتورة' : 'Invoice line'}
            required
            defaultValue={ar ? 'إيجار العقار' : 'Property rent'}
          />
          <Input name="amount" label={ar ? 'المبلغ' : 'Amount'} type="number" min="0" required />
          <CurrencySelect locale={locale} />
          <Input
            name="issuedOn"
            label={ar ? 'تاريخ الإصدار' : 'Issue date'}
            type="date"
            defaultValue={today}
            required
          />
          <Input
            name="dueOn"
            label={ar ? 'تاريخ الاستحقاق' : 'Due date'}
            type="date"
            defaultValue={inOneMonth}
            required
          />
          <Input
            name="taxRate"
            label={ar ? 'الضريبة %' : 'Tax %'}
            type="number"
            min="0"
            defaultValue="0"
          />
        </>
      );
    case 'payments':
      return (
        <>
          <SelectOptions
            name="invoiceId"
            label={ar ? 'الفاتورة' : 'Invoice'}
            options={context.invoices ?? []}
            locale={locale}
            required
          />
          <Input name="amount" label={ar ? 'المبلغ' : 'Amount'} type="number" min="0" required />
          <CurrencySelect locale={locale} />
          <label className="field">
            <span>{ar ? 'طريقة الدفع' : 'Payment method'}</span>
            <select className="select" name="method" defaultValue="bank_transfer">
              <option value="bank_transfer">{ar ? 'تحويل بنكي' : 'Bank transfer'}</option>
              <option value="card">{ar ? 'بطاقة' : 'Card'}</option>
              <option value="cash">{ar ? 'نقداً' : 'Cash'}</option>
              <option value="cheque">{ar ? 'شيك' : 'Cheque'}</option>
            </select>
          </label>
          <Input
            name="provider"
            label={ar ? 'مزود الدفع' : 'Provider'}
            defaultValue="manual"
            required
          />
          <Input
            name="providerReference"
            label={ar ? 'مرجع الدفع' : 'Provider reference'}
            required
          />
          <Input
            name="receivedAt"
            label={ar ? 'وقت الاستلام' : 'Received at'}
            type="datetime-local"
            required
          />
        </>
      );
    case 'accounting':
      return (
        <>
          <Input
            name="occurredOn"
            label={ar ? 'تاريخ القيد' : 'Journal date'}
            type="date"
            defaultValue={today}
            required
          />
          <Input name="description" label={ar ? 'بيان القيد' : 'Description'} required />
          <SelectOptions
            name="debitAccountId"
            label={ar ? 'الحساب المدين' : 'Debit account'}
            options={context.ledgerAccounts ?? []}
            locale={locale}
            required
          />
          <SelectOptions
            name="creditAccountId"
            label={ar ? 'الحساب الدائن' : 'Credit account'}
            options={context.ledgerAccounts ?? []}
            locale={locale}
            required
          />
          <Input name="amount" label={ar ? 'المبلغ' : 'Amount'} type="number" min="0" required />
          <CurrencySelect locale={locale} />
        </>
      );
    case 'expenses':
      return (
        <>
          <Input name="description" label={ar ? 'بيان المصروف' : 'Description'} required />
          <Input
            name="category"
            label={ar ? 'الفئة' : 'Category'}
            defaultValue="operations"
            required
          />
          <Input name="amount" label={ar ? 'المبلغ' : 'Amount'} type="number" min="0" required />
          <Input name="tax" label={ar ? 'الضريبة' : 'Tax'} type="number" min="0" defaultValue="0" />
          <CurrencySelect locale={locale} />
          <Input
            name="issuedOn"
            label={ar ? 'تاريخ المصروف' : 'Expense date'}
            type="date"
            defaultValue={today}
            required
          />
          <SelectOptions
            name="propertyId"
            label={ar ? 'العقار' : 'Property'}
            options={context.properties ?? []}
            locale={locale}
          />
          <SelectOptions
            name="vendorId"
            label={ar ? 'المورد' : 'Vendor'}
            options={context.vendors ?? []}
            locale={locale}
          />
        </>
      );
    case 'maintenance':
      return (
        <>
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة' : 'Unit'}
            options={context.units ?? []}
            locale={locale}
            required
          />
          <Input name="title" label={ar ? 'عنوان البلاغ' : 'Ticket title'} required />
          <label className="field">
            <span>{ar ? 'التصنيف' : 'Category'}</span>
            <select className="select" name="category" defaultValue="other">
              {['plumbing', 'electricity', 'hvac', 'appliance', 'structural', 'other'].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </label>
          <PrioritySelect locale={locale} />
          <label className="field span-2">
            <span>{ar ? 'وصف المشكلة' : 'Issue description'}</span>
            <textarea className="textarea" name="description" required />
          </label>
        </>
      );
    case 'work-orders':
      return (
        <>
          <SelectOptions
            name="ticketId"
            label={ar ? 'بلاغ الصيانة' : 'Maintenance ticket'}
            options={context.maintenanceTickets ?? []}
            locale={locale}
            required
          />
          <SelectOptions
            name="vendorId"
            label={ar ? 'المورد' : 'Vendor'}
            options={context.vendors ?? []}
            locale={locale}
          />
          <Input
            name="estimate"
            label={ar ? 'التكلفة التقديرية' : 'Estimate'}
            type="number"
            min="0"
          />
          <CurrencySelect locale={locale} />
          <Input
            name="scheduledAt"
            label={ar ? 'موعد التنفيذ' : 'Schedule'}
            type="datetime-local"
          />
          <label className="field span-2">
            <span>{ar ? 'نطاق العمل' : 'Scope of work'}</span>
            <textarea className="textarea" name="scope" required />
          </label>
        </>
      );
    case 'legal':
      return (
        <>
          <Input name="title" label={ar ? 'موضوع الملف' : 'Case subject'} required />
          <Input
            name="caseType"
            label={ar ? 'نوع القضية' : 'Case type'}
            defaultValue="collection"
            required
          />
          <Input name="caseNumber" label={ar ? 'رقم القضية' : 'Case number'} />
          <Input name="court" label={ar ? 'المحكمة' : 'Court'} />
          <SelectOptions
            name="counterpartyId"
            label={ar ? 'الطرف المقابل' : 'Counterparty'}
            options={context.parties ?? []}
            locale={locale}
          />
          <SelectOptions
            name="lawyerPartyId"
            label={ar ? 'المحامي' : 'Lawyer'}
            options={context.parties ?? []}
            locale={locale}
          />
          <Input
            name="claimAmount"
            label={ar ? 'مبلغ المطالبة' : 'Claim amount'}
            type="number"
            min="0"
            defaultValue="0"
          />
          <CurrencySelect locale={locale} />
          <Input
            name="openedOn"
            label={ar ? 'تاريخ الفتح' : 'Opened on'}
            type="date"
            defaultValue={today}
            required
          />
          <Input
            name="nextHearingAt"
            label={ar ? 'الجلسة القادمة' : 'Next hearing'}
            type="datetime-local"
          />
          <label className="field span-2">
            <span>{ar ? 'التفاصيل' : 'Details'}</span>
            <textarea className="textarea" name="description" />
          </label>
        </>
      );
    case 'reports':
      return (
        <>
          <label className="field">
            <span>{ar ? 'نوع التقرير' : 'Report type'}</span>
            <select className="select" name="type" defaultValue="portfolio">
              {[
                'portfolio',
                'occupancy',
                'rent_roll',
                'income',
                'arrears',
                'maintenance',
                'sales_pipeline',
                'legal_cases',
                'task_performance',
                'requests',
                'trial_balance',
                'general_ledger',
                'expenses',
              ].map((value) => (
                <option key={value}>{value.replaceAll('_', ' ')}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{ar ? 'الصيغة' : 'Format'}</span>
            <select className="select" name="format" defaultValue="xlsx">
              <option>xlsx</option>
              <option>pdf</option>
              <option>csv</option>
            </select>
          </label>
        </>
      );
    default:
      return null;
  }
}

const creatable = new Set<OperationsSection>([
  'requests',
  'bookings',
  'leasing',
  'sales',
  'invoices',
  'payments',
  'accounting',
  'expenses',
  'maintenance',
  'work-orders',
  'tasks',
  'legal',
  'reports',
]);

function creationRequest(section: OperationsSection, form: FormData) {
  const currency = (text(form.get('currency')) || 'OMR') as CurrencyCode;
  const amount = (name: string) => toMinorUnits(text(form.get(name)) || '0', currency);
  switch (section) {
    case 'requests':
      return {
        path: '/v1/operations/requests',
        body: {
          subject: text(form.get('subject')),
          type: text(form.get('type')),
          priority: text(form.get('priority')),
          description: optional(text(form.get('description'))),
          propertyId: optional(text(form.get('propertyId'))),
          unitId: optional(text(form.get('unitId'))),
          dueAt: toIsoDateTime(text(form.get('dueAt'))),
        },
      };
    case 'tasks':
      return {
        path: '/v1/operations/tasks',
        body: {
          title: text(form.get('title')),
          category: text(form.get('category')),
          priority: text(form.get('priority')),
          description: optional(text(form.get('description'))),
          assignedToUserId: optional(text(form.get('assignedToUserId'))),
          propertyId: optional(text(form.get('propertyId'))),
          dueAt: toIsoDateTime(text(form.get('dueAt'))),
        },
      };
    case 'bookings':
      return {
        path: '/v1/operations/viewings',
        body: {
          unitId: text(form.get('unitId')),
          prospectPartyId: text(form.get('prospectPartyId')),
          channel: text(form.get('channel')),
          scheduledAt: toIsoDateTime(text(form.get('scheduledAt'))),
          notes: optional(text(form.get('notes'))),
        },
      };
    case 'leasing':
      return {
        path: '/v1/leasing/leases',
        body: {
          unitId: text(form.get('unitId')),
          ownerPartyId: text(form.get('ownerPartyId')),
          tenantPartyId: text(form.get('tenantPartyId')),
          templateVersionId: text(form.get('templateVersionId')),
          startsOn: text(form.get('startsOn')),
          endsOn: text(form.get('endsOn')),
          rent: { amountMinor: amount('rent'), currency },
          ...(text(form.get('deposit'))
            ? { deposit: { amountMinor: amount('deposit'), currency } }
            : {}),
          billingDay: Number(text(form.get('billingDay'))),
        },
      };
    case 'sales':
      return {
        path: '/v1/operations/sales',
        body: {
          propertyId: text(form.get('propertyId')),
          unitId: optional(text(form.get('unitId'))),
          sellerPartyId: text(form.get('sellerPartyId')),
          buyerPartyId: optional(text(form.get('buyerPartyId'))),
          askingPriceMinor: amount('askingPrice'),
          commissionMinor: amount('commission'),
          currency,
          expectedClosingOn: optional(text(form.get('expectedClosingOn'))),
        },
      };
    case 'invoices':
      return {
        path: '/v1/finance/invoices',
        body: {
          leaseId: text(form.get('leaseId')),
          issuedOn: text(form.get('issuedOn')),
          dueOn: text(form.get('dueOn')),
          lines: [
            {
              description: text(form.get('description')),
              quantity: '1',
              unitAmount: { amountMinor: amount('amount'), currency },
              taxRateBasisPoints: Math.round(Number(text(form.get('taxRate')) || '0') * 100),
            },
          ],
        },
      };
    case 'payments':
      return {
        path: '/v1/finance/payments',
        body: {
          invoiceId: text(form.get('invoiceId')),
          amount: { amountMinor: amount('amount'), currency },
          provider: text(form.get('provider')),
          providerReference: text(form.get('providerReference')),
          receivedAt: toIsoDateTime(text(form.get('receivedAt'))),
          method: text(form.get('method')),
        },
      };
    case 'accounting': {
      const value = amount('amount');
      return {
        path: '/v1/accounting/journals',
        body: {
          occurredOn: text(form.get('occurredOn')),
          description: text(form.get('description')),
          lines: [
            {
              accountId: text(form.get('debitAccountId')),
              debitMinor: value,
              creditMinor: '0',
              currency,
            },
            {
              accountId: text(form.get('creditAccountId')),
              debitMinor: '0',
              creditMinor: value,
              currency,
            },
          ],
        },
      };
    }
    case 'expenses':
      return {
        path: '/v1/accounting/expenses',
        body: {
          description: text(form.get('description')),
          category: text(form.get('category')),
          amountMinor: amount('amount'),
          taxMinor: amount('tax'),
          currency,
          issuedOn: text(form.get('issuedOn')),
          propertyId: optional(text(form.get('propertyId'))),
          vendorId: optional(text(form.get('vendorId'))),
        },
      };
    case 'maintenance':
      return {
        path: '/v1/maintenance',
        body: {
          unitId: text(form.get('unitId')),
          title: text(form.get('title')),
          description: text(form.get('description')),
          category: text(form.get('category')),
          priority: text(form.get('priority')),
        },
      };
    case 'work-orders':
      return {
        path: '/v1/operations/work-orders',
        body: {
          ticketId: text(form.get('ticketId')),
          vendorId: optional(text(form.get('vendorId'))),
          scope: text(form.get('scope')),
          estimateMinor: amount('estimate'),
          currency,
          scheduledAt: toIsoDateTime(text(form.get('scheduledAt'))),
        },
      };
    case 'legal':
      return {
        path: '/v1/operations/legal-cases',
        body: {
          title: text(form.get('title')),
          caseType: text(form.get('caseType')),
          caseNumber: optional(text(form.get('caseNumber'))),
          court: optional(text(form.get('court'))),
          counterpartyId: optional(text(form.get('counterpartyId'))),
          lawyerPartyId: optional(text(form.get('lawyerPartyId'))),
          claimAmountMinor: amount('claimAmount'),
          currency,
          openedOn: text(form.get('openedOn')),
          nextHearingAt: toIsoDateTime(text(form.get('nextHearingAt'))),
          description: optional(text(form.get('description'))),
        },
      };
    case 'reports':
      return {
        path: '/v1/reports',
        body: {
          type: text(form.get('type')),
          format: text(form.get('format')),
          filters: {},
        },
      };
    default:
      throw new Error('create_not_supported');
  }
}

function nextAction(section: OperationsSection, row: DataRow) {
  const status = String(row.status ?? '');
  const id = String(row.id ?? '');
  if (!id) return null;
  const statusProgression: Partial<Record<OperationsSection, Record<string, string>>> = {
    requests: {
      draft: 'pending',
      pending: 'approved',
      approved: 'in_progress',
      in_progress: 'completed',
    },
    tasks: {
      draft: 'pending',
      pending: 'approved',
      approved: 'in_progress',
      in_progress: 'completed',
    },
    sales: {
      lead: 'qualified',
      qualified: 'viewing',
      viewing: 'offer',
      offer: 'negotiation',
      negotiation: 'reserved',
      reserved: 'contracting',
      contracting: 'closed_won',
    },
    expenses: {
      draft: 'pending',
      pending: 'approved',
      approved: 'in_progress',
      in_progress: 'completed',
    },
    maintenance: {
      open: 'assigned',
      assigned: 'in_progress',
      in_progress: 'resolved',
      resolved: 'closed',
    },
    'work-orders': {
      draft: 'quoted',
      quoted: 'awaiting_approval',
      awaiting_approval: 'approved',
      approved: 'scheduled',
      scheduled: 'in_progress',
      in_progress: 'completed',
      completed: 'verified',
    },
    legal: {
      assessment: 'notice',
      notice: 'filed',
      filed: 'hearing',
      hearing: 'judgment',
      judgment: 'enforcement',
      enforcement: 'settled',
      settled: 'closed',
    },
  };
  const next = statusProgression[section]?.[status];
  if (next) {
    const endpoint: Partial<Record<OperationsSection, string>> = {
      requests: `/v1/operations/requests/${id}`,
      tasks: `/v1/operations/tasks/${id}`,
      sales: `/v1/operations/sales/${id}`,
      expenses: `/v1/accounting/expenses/${id}`,
      maintenance: `/v1/maintenance/${id}`,
      'work-orders': `/v1/operations/work-orders/${id}`,
      legal: `/v1/operations/legal-cases/${id}`,
    };
    return { path: endpoint[section]!, method: 'PATCH', body: { status: next }, next };
  }
  if (section === 'accounting' && status === 'draft')
    return { path: `/v1/accounting/journals/${id}/post`, method: 'POST', body: {}, next: 'posted' };
  if (section === 'contracts' && status === 'draft')
    return { path: `/v1/leasing/contracts/${id}/send`, method: 'POST', body: {}, next: 'sent' };
  if (section === 'leasing' && status === 'draft')
    return {
      path: `/v1/leasing/leases/${id}`,
      method: 'PATCH',
      body: { action: 'activate' },
      next: 'active',
    };
  if (section === 'approvals' && status === 'pending')
    return {
      path: `/v1/operations/approvals/${id}`,
      method: 'PATCH',
      body: { decision: 'approved' },
      next: 'approved',
    };
  if (section === 'bookings') {
    const kind = String(row.recordKind ?? '');
    if (kind === 'reservation' && status === 'pending')
      return {
        path: `/v1/leasing/reservations/${id}`,
        method: 'PATCH',
        body: { status: 'confirmed' },
        next: 'confirmed',
      };
    if (kind === 'viewing' && status === 'requested')
      return {
        path: `/v1/operations/viewings/${id}`,
        method: 'PATCH',
        body: { status: 'scheduled' },
        next: 'scheduled',
      };
  }
  return null;
}

export function OperationsConsole({
  portal,
  section,
  locale,
  records,
  summary,
  secondary,
  context,
}: {
  portal: PortalRole;
  section: OperationsSection;
  locale: 'ar' | 'en';
  records: DataRow[];
  summary: DataRow;
  secondary: DataRow[];
  context: OperationsContext;
}) {
  const router = useRouter();
  const definition = definitions[section];
  const ar = locale === 'ar';
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return records.filter((row) => {
      if (statusFilter && String(row.status ?? '') !== statusFilter) return false;
      if (!normalized) return true;
      return JSON.stringify(row).toLocaleLowerCase().includes(normalized);
    });
  }, [query, records, statusFilter]);
  const openCount = records.filter(
    (row) =>
      ![
        'completed',
        'closed',
        'closed_won',
        'paid',
        'posted',
        'ready',
        'verified',
        'signed',
        'ended',
        'cancelled',
        'rejected',
      ].includes(String(row.status ?? '')),
  ).length;
  const completedCount = Math.max(0, records.length - openCount);
  const amountTotal = definition.moneyKey
    ? records.reduce((total, row) => total + BigInt(String(row[definition.moneyKey!] ?? '0')), 0n)
    : 0n;

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const request = creationRequest(section, new FormData(event.currentTarget));
      await browserMutation(request.path, {
        method: 'POST',
        body: JSON.stringify(request.body),
      });
      setShowCreate(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function advance(row: DataRow) {
    const action = nextAction(section, row);
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await browserMutation(action.path, {
        method: action.method,
        body: JSON.stringify(action.body),
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  const canCreate = creatable.has(section) && !(portal === 'tenant' && section !== 'requests');
  return (
    <div className={`ops-workspace ops-workspace--${section}`}>
      <header className="ops-header">
        <div>
          <span className="ops-kicker">BHD R · {portal.toUpperCase()}</span>
          <h1>{ar ? definition.titleAr : definition.titleEn}</h1>
          <p>{ar ? definition.introAr : definition.introEn}</p>
        </div>
        <div className="ops-header__actions">
          {section === 'properties' ? (
            <a className="button button--primary" href={`/${locale}/${portal}/properties/new`}>
              ＋ {ar ? definition.createAr : definition.createEn}
            </a>
          ) : null}
          {section === 'accounting' && !context.ledgerAccounts?.length ? (
            <button
              className="button button--quiet"
              type="button"
              disabled={busy}
              onClick={() =>
                void browserMutation('/v1/accounting/accounts/bootstrap', {
                  method: 'POST',
                  body: '{}',
                }).then(() => router.refresh())
              }
            >
              {ar ? 'تهيئة دليل الحسابات' : 'Initialize chart of accounts'}
            </button>
          ) : null}
          {canCreate ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => setShowCreate(true)}
            >
              ＋ {ar ? definition.createAr : definition.createEn}
            </button>
          ) : null}
        </div>
      </header>

      <section className="ops-metrics" aria-label={ar ? 'المؤشرات' : 'Metrics'}>
        <article>
          <span>{ar ? 'إجمالي السجلات' : 'Total records'}</span>
          <strong>{records.length}</strong>
          <small>{ar ? 'ضمن المؤسسة الحالية' : 'Current organization'}</small>
        </article>
        <article>
          <span>{ar ? 'قيد المتابعة' : 'In progress'}</span>
          <strong>{openCount}</strong>
          <small>{ar ? 'تحتاج إجراء أو متابعة' : 'Needs action or follow-up'}</small>
        </article>
        <article>
          <span>{ar ? 'مكتمل/مغلق' : 'Completed/closed'}</span>
          <strong>{completedCount}</strong>
          <small>{ar ? 'محفوظة في سجل العمل' : 'Retained in workflow history'}</small>
        </article>
        <article className="ops-metric--accent">
          <span>
            {definition.moneyKey
              ? ar
                ? 'القيمة المسجلة'
                : 'Recorded value'
              : ar
                ? 'مؤشر إضافي'
                : 'Additional indicator'}
          </span>
          <strong>
            {definition.moneyKey
              ? formatMoney(amountTotal.toString(), String(records[0]?.currency ?? 'OMR'), locale)
              : String(summary.pendingApprovals ?? summary.draftJournals ?? secondary.length ?? 0)}
          </strong>
          <small>{ar ? 'محدث من البيانات التشغيلية' : 'Updated from operational data'}</small>
        </article>
      </section>

      <section className="ops-flow" aria-label={ar ? 'مراحل العمل' : 'Workflow stages'}>
        {definition.flow.map((stage, index) => {
          const count = records.filter((row) => String(row.status ?? '') === stage.value).length;
          return (
            <article key={stage.value}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{ar ? stage.ar : stage.en}</strong>
                <small>
                  {count} {ar ? 'سجل' : 'records'}
                </small>
              </div>
            </article>
          );
        })}
      </section>

      <section className="ops-panel">
        <div className="ops-toolbar">
          <label className="ops-search">
            <span className="sr-only">{ar ? 'بحث' : 'Search'}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                ar ? 'ابحث بالاسم أو المرجع أو الحالة…' : 'Search name, reference or status…'
              }
            />
          </label>
          <label>
            <span className="sr-only">{ar ? 'تصفية الحالة' : 'Filter status'}</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">{ar ? 'كل الحالات' : 'All statuses'}</option>
              {definition.flow.map((stage) => (
                <option key={stage.value} value={stage.value}>
                  {ar ? stage.ar : stage.en}
                </option>
              ))}
            </select>
          </label>
          <span className="ops-result-count">
            {filtered.length} {ar ? 'نتيجة' : 'results'}
          </span>
        </div>
        {error ? (
          <div className="notice notice--error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="data-table-wrap">
          <table className="data-table ops-table">
            <thead>
              <tr>
                {definition.columns.map((column) => (
                  <th key={column.key}>{ar ? column.ar : column.en}</th>
                ))}
                <th>{ar ? 'الإجراء التالي' : 'Next action'}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, index) => {
                const action = nextAction(section, row);
                return (
                  <tr key={String(row.id ?? row.reference ?? index)}>
                    {definition.columns.map((column) => (
                      <td key={column.key}>{displayCell(row, column, locale, context)}</td>
                    ))}
                    <td>
                      {action ? (
                        <button
                          className="ops-action"
                          type="button"
                          disabled={busy}
                          onClick={() => void advance(row)}
                        >
                          {ar
                            ? `نقل إلى ${action.next.replaceAll('_', ' ')}`
                            : `Move to ${action.next.replaceAll('_', ' ')}`}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length ? (
                <tr>
                  <td colSpan={definition.columns.length + 1}>
                    <div className="ops-empty">
                      <span>R</span>
                      <strong>{ar ? 'لا توجد سجلات مطابقة' : 'No matching records'}</strong>
                      <p>
                        {ar
                          ? 'أنشئ أول سجل أو غيّر التصفية.'
                          : 'Create the first record or change the filters.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate ? (
        <div
          className="ops-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCreate(false);
          }}
        >
          <section
            className="ops-modal__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ops-create-title"
          >
            <header>
              <div>
                <span className="ops-kicker">BHD R WORKFLOW</span>
                <h2 id="ops-create-title">{ar ? definition.createAr : definition.createEn}</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                aria-label={ar ? 'إغلاق' : 'Close'}
              >
                ×
              </button>
            </header>
            <form onSubmit={(event) => void submitCreate(event)}>
              <div className="form-grid">
                <CreateFields section={section} locale={locale} context={context} />
              </div>
              {error ? (
                <div className="notice notice--error" role="alert">
                  {error}
                </div>
              ) : null}
              <div className="form-actions">
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => setShowCreate(false)}
                >
                  {ar ? 'إلغاء' : 'Cancel'}
                </button>
                <button className="button button--primary" type="submit" disabled={busy}>
                  {busy
                    ? ar
                      ? 'جارٍ الحفظ…'
                      : 'Saving…'
                    : ar
                      ? 'حفظ وبدء سير العمل'
                      : 'Save & start workflow'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
