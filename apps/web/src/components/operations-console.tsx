'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { CurrencyCode } from '@bhd-r/contracts';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { browserMutation, browserApiPath } from '@/lib/api';
import { formatMoney, toMinorUnits } from '@/lib/format';
import { invalidateOpsCache } from '@/lib/portal-ops-client-cache';
import type { PortalRole } from '@/lib/types';
import type { OperationsSection } from './operations-workspace';
import { NestReconnectButton } from './nest-reconnect-button';
import { PropertyOpsRowKey } from './property-ops-row-key';

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
  vacantUnits?: Array<OptionRow & { propertyId?: string }>;
  parties?: OptionRow[];
  owners?: OptionRow[];
  tenants?: OptionRow[];
  users?: OptionRow[];
  vendors?: OptionRow[];
  maintenanceTickets?: OptionRow[];
  leases?: OptionRow[];
  reservations?: Array<OptionRow & { unitId?: string; tenantPartyId?: string }>;
  pendingDepositReservations?: Array<OptionRow & { unitId?: string; tenantPartyId?: string }>;
  confirmedReservations?: Array<OptionRow & { unitId?: string; tenantPartyId?: string }>;
  cancelRequestedLeases?: Array<
    OptionRow & {
      unitId?: string;
      cancellationProposedOn?: string;
      depositMinor?: string | null;
    }
  >;
  clearancePendingLeases?: Array<
    OptionRow & {
      unitId?: string;
      cancellationEffectiveOn?: string;
      depositMinor?: string | null;
      exitKind?: string | null;
    }
  >;
  renewalPendingLeases?: Array<
    OptionRow & {
      unitId?: string;
      renewalPendingContractId?: string | null;
      renewalPendingEndsOn?: string | null;
      depositMinor?: string | null;
    }
  >;
  invoices?: OptionRow[];
  contractTemplates?: OptionRow[];
  ledgerAccounts?: OptionRow[];
  vacancyFollowUps?: {
    tasks: number;
    maintenance: number;
    legal: number;
    expenses: number;
  };
}

interface Column {
  key: string;
  ar: string;
  en: string;
  format?: 'status' | 'money' | 'date' | 'count' | 'kind' | 'thumb';
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
      { key: 'coverImageUrl', ar: 'الصورة', en: 'Photo', format: 'thumb' },
      { key: 'serialNumber', ar: 'رقم العقار', en: 'Property no.' },
      { key: 'nameAr', fallbackKeys: ['nameEn', 'name'], ar: 'العقار', en: 'Property' },
      { key: 'location', fallbackKeys: ['governorate', 'city'], ar: 'الموقع', en: 'Location' },
      { key: 'kind', ar: 'النوع', en: 'Kind', format: 'kind' },
      { key: 'units', ar: 'الوحدات', en: 'Units', format: 'count' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
    flow: [
      { value: 'draft', ar: 'مسودة', en: 'Draft' },
      { value: 'active', ar: 'نشط', en: 'Active' },
      { value: 'inactive', ar: 'متوقف', en: 'Inactive' },
      { value: 'archived', ar: 'مؤرشف', en: 'Archived' },
    ],
  },
  contacts: {
    titleAr: 'الأطراف ودفتر العناوين',
    titleEn: 'Parties & address book',
    introAr: 'سجل موحد وآمن للأفراد والشركات والملاك والمستأجرين والموردين والمفوّضين وعناوينهم.',
    introEn:
      'A secure register for people, companies, owners, tenants, vendors, representatives and addresses.',
    createAr: 'إضافة طرف',
    createEn: 'Add party',
    columns: [
      { key: 'displayName', ar: 'الاسم', en: 'Name' },
      { key: 'type', ar: 'النوع', en: 'Type', format: 'kind' },
      { key: 'roles', ar: 'الأدوار', en: 'Roles', format: 'count' },
      { key: 'email', ar: 'البريد', en: 'Email' },
      { key: 'phone', ar: 'الهاتف', en: 'Phone' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
    flow: [
      { value: 'active', ar: 'نشط', en: 'Active' },
      { value: 'inactive', ar: 'غير نشط', en: 'Inactive' },
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
    introAr:
      'اختر وحدة شاغرة ومستأجراً من سجل العناوين. الحجز يبقى معلّقاً حتى يعتمد المحاسب مبلغ الضمان؛ عند التأكيد يُرحَّل قيد محاسبي تلقائي (نقد/بنك ← تأمينات مستأجرين)، ثم يُحوَّل لعقد إيجار قيد الإجراء. زر «تأكيد العربون» يظهر في صف الحجز المعلّق.',
    introEn:
      'Pick a vacant unit and a tenant from the address book. Reservations stay pending until the accountant confirms the deposit; confirmation auto-posts a ledger journal (cash/bank → tenant deposits), then convert to an in-progress lease. Use “Confirm deposit” on the pending row.',
    createAr: 'حجز جديد',
    createEn: 'New booking',
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
      { value: 'pending', ar: 'بانتظار المحاسب', en: 'Awaiting accountant' },
      { value: 'confirmed', ar: 'محجوز مؤكد', en: 'Deposit confirmed' },
      { value: 'converted', ar: 'تحول لعقد', en: 'Converted' },
    ],
  },
  leasing: {
    titleAr: 'إدارة التأجير',
    titleEn: 'Leasing management',
    introAr:
      'عقد قيد الإجراء: إيجار وضمان وسماح وشيكات وسلسلة اعتماد (محاسب/مالي/إدارة) ثم توقيع إلكتروني وتفعيل ليصبح ساري المفعول.',
    introEn:
      'In-progress lease: rent, deposit, grace, cheques, approval chain, e-sign, then activation to active.',
    createAr: 'تحويل لعقد إيجار',
    createEn: 'Convert to lease',
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
      { value: 'cancel_requested', ar: 'طلب إلغاء', en: 'Cancel requested' },
      { value: 'clearance_pending', ar: 'بانتظار المحاسب', en: 'Clearance pending' },
      { value: 'cancelled', ar: 'ملغي', en: 'Cancelled' },
      { value: 'ended', ar: 'منتهٍ', en: 'Ended' },
      { value: 'terminated', ar: 'مفسوخ (مسودة)', en: 'Terminated (draft)' },
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
      { key: 'reference', fallbackKeys: ['id'], ar: 'العقد', en: 'Contract' },
      { key: 'kind', ar: 'النوع', en: 'Type', format: 'kind' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'approvalStatus', ar: 'الاعتماد', en: 'Approval', format: 'status' },
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
      { key: 'recordKind', ar: 'السجل', en: 'Record', format: 'kind' },
      {
        key: 'providerReference',
        fallbackKeys: ['receiptNumber'],
        ar: 'المرجع',
        en: 'Reference',
      },
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
  'api-keys': {
    titleAr: 'مفاتيح التكامل API',
    titleEn: 'Integration API keys',
    introAr: 'مفاتيح محدودة الصلاحية والمدة للتكاملات الخارجية؛ تظهر القيمة السرية مرة واحدة فقط.',
    introEn:
      'Time- and scope-limited keys for external integrations; the secret is shown only once.',
    createAr: 'إنشاء مفتاح API',
    createEn: 'Create API key',
    columns: [
      { key: 'name', ar: 'الاسم', en: 'Name' },
      { key: 'prefix', ar: 'البادئة', en: 'Prefix' },
      { key: 'scopes', ar: 'الصلاحيات', en: 'Scopes', format: 'count' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
      { key: 'lastUsedAt', ar: 'آخر استخدام', en: 'Last used', format: 'date' },
      { key: 'expiresAt', ar: 'ينتهي', en: 'Expires', format: 'date' },
    ],
    flow: [
      { value: 'active', ar: 'نشط', en: 'Active' },
      { value: 'expired', ar: 'منتهي', en: 'Expired' },
      { value: 'revoked', ar: 'ملغى', en: 'Revoked' },
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

function safeString(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  )
    return String(value);
  return '';
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
  if (value === undefined || value === null || value === '') {
    if (Array.isArray(row.amounts)) {
      const rendered = row.amounts.flatMap((amount) => {
        if (!amount || typeof amount !== 'object') return [];
        const item = amount as DataRow;
        const currency = safeString(item.currency);
        const minor = safeString(item[key]);
        return currency && minor ? [formatMoney(minor, currency, locale)] : [];
      });
      if (rendered.length) return rendered.join(' · ');
    }
    return '—';
  }
  if (typeof row.currency !== 'string') return '—';
  const currency = row.currency;
  return formatMoney(safeString(value), currency, locale);
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
  flow?: Array<{ value: string; ar: string; en: string }>,
): ReactNode {
  const value = scalar(row, column);
  if (value === null) return '—';
  if (column.format === 'count') return Array.isArray(value) ? value.length : safeString(value);
  if (column.format === 'money') return moneyFromRecord(row, column.key, locale);
  if (column.format === 'date') {
    const date = new Date(safeString(value));
    return Number.isNaN(date.valueOf())
      ? safeString(value)
      : new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
          dateStyle: 'medium',
        }).format(date);
  }
  if (column.format === 'status') {
    const status = safeString(value);
    const labeled = flow?.find((item) => item.value === status);
    return (
      <span className={`ops-status ops-status--${statusTone(status)}`}>
        {labeled ? (locale === 'ar' ? labeled.ar : labeled.en) : status.replaceAll('_', ' ')}
      </span>
    );
  }
  if (column.format === 'thumb') {
    return null;
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
    const match = sources.find((option) => option.id === safeString(value));
    return match ? labelForOption(match, locale) : safeString(value).slice(0, 8);
  }
  if (typeof value === 'object') return Array.isArray(value) ? String(value.length) : '—';
  return safeString(value).replaceAll('_', ' ');
}

function SelectOptions({
  name,
  label,
  options,
  locale,
  required = false,
  defaultValue = '',
}: {
  name: string;
  label: string;
  options: OptionRow[];
  locale: 'ar' | 'en';
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="select" name={name} required={required} defaultValue={defaultValue}>
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
  step,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  min?: string;
  step?: string;
  placeholder?: string;
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
        step={step}
        placeholder={placeholder}
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
  prefillUnitId = '',
  prefillReservationId = '',
  prefillTenantId = '',
}: {
  section: OperationsSection;
  locale: 'ar' | 'en';
  context: OperationsContext;
  prefillUnitId?: string;
  prefillReservationId?: string;
  prefillTenantId?: string;
}) {
  const ar = locale === 'ar';
  const today = new Date().toISOString().slice(0, 10);
  const inOneMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const nextHour = new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 16);
  const unitOptions = context.vacantUnits?.length
    ? [...(context.vacantUnits ?? []), ...(context.units ?? [])].filter(
        (row, index, all) => all.findIndex((item) => item.id === row.id) === index,
      )
    : (context.units ?? []);
  switch (section) {
    case 'contacts':
      return (
        <>
          <label className="field">
            <span>{ar ? 'نوع الطرف' : 'Party type'}</span>
            <select className="select" name="partyType" defaultValue="person">
              <option value="person">{ar ? 'فرد' : 'Person'}</option>
              <option value="company">{ar ? 'شركة' : 'Company'}</option>
            </select>
          </label>
          <label className="field">
            <span>{ar ? 'الدور الرئيسي' : 'Primary role'}</span>
            <select className="select" name="partyRole" defaultValue="tenant">
              <option value="tenant">{ar ? 'مستأجر' : 'Tenant'}</option>
              <option value="owner">{ar ? 'مالك' : 'Owner'}</option>
              <option value="prospect">{ar ? 'عميل محتمل' : 'Prospect'}</option>
              <option value="supplier">{ar ? 'مورد' : 'Supplier'}</option>
              <option value="partner">{ar ? 'شريك' : 'Partner'}</option>
              <option value="authorized_representative">
                {ar ? 'مفوّض بالتوقيع' : 'Authorized representative'}
              </option>
              <option value="lawyer">{ar ? 'محامٍ' : 'Lawyer'}</option>
              <option value="government">{ar ? 'جهة حكومية' : 'Government'}</option>
              <option value="other">{ar ? 'أخرى' : 'Other'}</option>
            </select>
          </label>
          <Input
            name="displayName"
            label={ar ? 'الاسم الكامل/التجاري' : 'Full/legal name'}
            required
          />
          <Input name="email" label={ar ? 'البريد الإلكتروني' : 'Email'} type="email" />
          <Input name="phone" label={ar ? 'رقم الهاتف' : 'Phone'} />
          <Input name="civilId" label={ar ? 'الرقم المدني (للفرد)' : 'Civil ID (person)'} />
          <Input
            name="commercialRegistration"
            label={ar ? 'السجل التجاري (للشركة)' : 'Commercial registration (company)'}
          />
          <Input name="governorate" label={ar ? 'المحافظة' : 'Governorate'} required />
          <Input name="wilayat" label={ar ? 'الولاية' : 'Wilayat'} required />
          <Input name="city" label={ar ? 'المدينة/القرية' : 'City/village'} required />
          <Input name="area" label={ar ? 'المنطقة' : 'Area'} />
          <Input name="street" label={ar ? 'الشارع' : 'Street'} />
          <Input name="buildingNumber" label={ar ? 'رقم المبنى' : 'Building number'} />
        </>
      );
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
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة الشاغرة/المرتبطة' : 'Related / vacant unit'}
            options={unitOptions}
            locale={locale}
            defaultValue={prefillUnitId}
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
          <label className="field">
            <span>{ar ? 'نوع الإجراء' : 'Booking action'}</span>
            <select className="select" name="bookingKind" defaultValue="reservation">
              <option value="reservation">{ar ? 'حجز وحدة شاغرة' : 'Reserve vacant unit'}</option>
              <option value="viewing">{ar ? 'طلب معاينة' : 'Viewing request'}</option>
              <option value="hold">{ar ? 'حجز مؤقت' : 'Temporary hold'}</option>
            </select>
          </label>
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة الشاغرة' : 'Vacant unit'}
            options={context.vacantUnits ?? []}
            locale={locale}
            required
            defaultValue={prefillUnitId}
          />
          {!(context.vacantUnits?.length) ? (
            <p className="ops-hint span-2">
              {ar
                ? 'لا توجد وحدات شاغرة حالياً (كل الوحدات مؤجرة أو عليها حجز/حجز مؤقت ساري).'
                : 'No vacant units right now (all units are leased or have an active reservation/hold).'}
            </p>
          ) : null}
          <SelectOptions
            name="prospectPartyId"
            label={ar ? 'المستأجر (من سجل العناوين)' : 'Tenant (address book)'}
            options={context.tenants?.length ? context.tenants : (context.parties ?? [])}
            locale={locale}
            required
          />
          <Input
            name="scheduledAt"
            label={ar ? 'موعد المعاينة' : 'Viewing time'}
            type="datetime-local"
            defaultValue={nextHour}
          />
          <Input
            name="expiresAt"
            label={ar ? 'انتهاء الحجز' : 'Reservation expiry'}
            type="datetime-local"
            defaultValue={tomorrow}
            required
          />
          <Input name="channel" label={ar ? 'المصدر' : 'Channel'} defaultValue="ops" />
          <label className="field span-2">
            <span>{ar ? 'ملاحظات / مبالغ إضافية' : 'Notes / other amounts'}</span>
            <textarea className="textarea" name="notes" />
          </label>
          <p className="ops-hint">
            {ar
              ? 'بعد الحفظ يبقى الحجز «بانتظار المحاسب». يعتمد المحاسب الضمان من زر المتابعة في الجدول، ثم يُحوَّل لعقد من التأجير.'
              : 'After save the reservation stays “awaiting accountant”. Confirm the deposit from the row action, then convert under Leasing.'}
          </p>
        </>
      );
    case 'leasing':
      return (
        <>
          <SelectOptions
            name="reservationId"
            label={ar ? 'حجز مؤكد (إلزامي للمسار التشغيلي)' : 'Confirmed reservation (ops path)'}
            options={
              context.confirmedReservations?.length
                ? context.confirmedReservations
                : (context.reservations ?? [])
            }
            locale={locale}
            defaultValue={prefillReservationId}
          />
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة' : 'Unit'}
            options={context.units ?? []}
            locale={locale}
            required
            defaultValue={prefillUnitId}
          />
          <SelectOptions
            name="ownerPartyId"
            label={ar ? 'المالك (سجل العناوين)' : 'Owner (address book)'}
            options={context.owners?.length ? context.owners : (context.parties ?? [])}
            locale={locale}
            required
          />
          <SelectOptions
            name="tenantPartyId"
            label={ar ? 'المستأجر (سجل العناوين)' : 'Tenant (address book)'}
            options={context.tenants?.length ? context.tenants : (context.parties ?? [])}
            locale={locale}
            required
            defaultValue={prefillTenantId}
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
          <Input name="deposit" label={ar ? 'التأمين/الضمان' : 'Deposit'} type="number" min="0" />
          <Input
            name="graceDays"
            label={ar ? 'أيام السماح' : 'Grace days'}
            type="number"
            min="0"
            defaultValue="0"
            required
          />
          <Input
            name="graceAmount"
            label={ar ? 'مبلغ السماح/الغرامة' : 'Grace / late amount'}
            type="number"
            min="0"
          />
          <Input
            name="handoverOn"
            label={ar ? 'تاريخ تسليم الوحدة' : 'Unit handover date'}
            type="date"
            defaultValue={today}
          />
          <Input
            name="billingDay"
            label={ar ? 'يوم الفوترة' : 'Billing day'}
            type="number"
            min="1"
            defaultValue="1"
            required
          />
          <label className="field">
            <span>{ar ? 'سلسلة الاعتماد' : 'Approval chain'}</span>
            <select className="select" name="approvalChain" defaultValue="accountant">
              <option value="accountant">{ar ? 'محاسب فقط' : 'Accountant only'}</option>
              <option value="accountant_finance">
                {ar ? 'محاسب ← مدير مالي' : 'Accountant → Finance'}
              </option>
              <option value="accountant_finance_admin">
                {ar ? 'محاسب ← مالي ← إدارة' : 'Accountant → Finance → Admin'}
              </option>
            </select>
          </label>
          <Input
            name="cheque1Bank"
            label={ar ? 'شيك 1 — البنك' : 'Cheque 1 — bank'}
            placeholder={ar ? 'اختياري' : 'Optional'}
          />
          <Input name="cheque1Number" label={ar ? 'شيك 1 — الرقم' : 'Cheque 1 — number'} />
          <Input
            name="cheque1Amount"
            label={ar ? 'شيك 1 — المبلغ' : 'Cheque 1 — amount'}
            type="number"
            min="0"
          />
          <Input name="cheque1DueOn" label={ar ? 'شيك 1 — الاستحقاق' : 'Cheque 1 — due'} type="date" />
          <Input name="cheque2Bank" label={ar ? 'شيك 2 — البنك' : 'Cheque 2 — bank'} />
          <Input name="cheque2Number" label={ar ? 'شيك 2 — الرقم' : 'Cheque 2 — number'} />
          <Input
            name="cheque2Amount"
            label={ar ? 'شيك 2 — المبلغ' : 'Cheque 2 — amount'}
            type="number"
            min="0"
          />
          <Input name="cheque2DueOn" label={ar ? 'شيك 2 — الاستحقاق' : 'Cheque 2 — due'} type="date" />
          <CurrencySelect locale={locale} />
          <p className="ops-hint">
            {ar
              ? 'بعد الحفظ يكون العقد قيد الإجراء. يعتمد المحاسب الشيكات والمبالغ، ثم سلسلة الاعتماد، ثم الإرسال للتوقيع الإلكتروني، وأخيراً التفعيل ليصبح ساري المفعول.'
              : 'After save the lease stays in progress. Accounting accepts cheques, then the approval chain, then e-sign send, then activation to make it active.'}
          </p>
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
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة المرتبطة (شاغرة)' : 'Linked vacant unit'}
            options={unitOptions}
            locale={locale}
            defaultValue={prefillUnitId}
          />
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
            defaultValue={prefillUnitId}
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
          <SelectOptions
            name="unitId"
            label={ar ? 'الوحدة المرتبطة' : 'Related unit'}
            options={unitOptions}
            locale={locale}
            defaultValue={prefillUnitId}
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
    case 'team':
      return (
        <>
          <Input name="displayName" label={ar ? 'الاسم الكامل' : 'Full name'} required />
          <Input name="email" label={ar ? 'البريد الإلكتروني' : 'Email'} type="email" required />
          <label className="field span-2">
            <span>{ar ? 'الدور المفوض' : 'Delegated role'}</span>
            <select className="select" name="roleKey" defaultValue="property_manager" required>
              <option value="organization_admin">organization admin</option>
              <option value="developer_admin">developer admin</option>
              <option value="property_manager">property manager</option>
              <option value="finance_manager">finance manager</option>
              <option value="maintenance_agent">maintenance agent</option>
              <option value="auditor">auditor</option>
            </select>
          </label>
          <p className="notice notice--info span-2">
            {ar
              ? 'سيُنشأ حساب موحد ويرسل رابط تفعيل أحادي الاستخدام. يخضع العدد لحد الباقة.'
              : 'A unified account and one-time activation link will be created. Plan limits apply.'}
          </p>
        </>
      );
    case 'api-keys':
      return (
        <>
          <Input name="name" label={ar ? 'اسم المفتاح' : 'Key name'} required />
          <Input
            name="expiresAt"
            label={ar ? 'تاريخ الانتهاء' : 'Expiry'}
            type="datetime-local"
            defaultValue={new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 16)}
            required
          />
          <fieldset className="field span-2">
            <legend>{ar ? 'الصلاحيات المحدودة' : 'Limited scopes'}</legend>
            <div className="permission-grid">
              {[
                'property.read',
                'unit.read',
                'party.read',
                'contract.read',
                'lease.read',
                'invoice.read',
                'payment.read',
                'maintenance.read',
                'request.create',
                'report.read',
                'webhook.read',
              ].map((scope) => (
                <label className="checkbox-row" key={scope}>
                  <input name="scopes" type="checkbox" value={scope} />
                  <span>{scope}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Input
            name="totpCode"
            label={ar ? 'رمز TOTP (إذا كان مفعلاً)' : 'TOTP code (when enabled)'}
          />
        </>
      );
    default:
      return null;
  }
}

const creatable = new Set<OperationsSection>([
  'contacts',
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
  'team',
  'api-keys',
]);

function creationRequest(section: OperationsSection, form: FormData) {
  const currency = (text(form.get('currency')) || 'OMR') as CurrencyCode;
  const amount = (name: string) => toMinorUnits(text(form.get(name)) || '0', currency);
  switch (section) {
    case 'contacts': {
      const type = text(form.get('partyType')) as 'person' | 'company';
      const civilId = text(form.get('civilId'));
      const registration = text(form.get('commercialRegistration'));
      return {
        path: '/v1/parties',
        body: {
          type,
          displayName: text(form.get('displayName')),
          email: optional(text(form.get('email'))),
          phone: optional(text(form.get('phone'))),
          roles: [text(form.get('partyRole'))],
          address: {
            countryCode: 'OM',
            governorate: text(form.get('governorate')),
            wilayat: text(form.get('wilayat')),
            city: text(form.get('city')),
            area: optional(text(form.get('area'))),
            street: optional(text(form.get('street'))),
            buildingNumber: optional(text(form.get('buildingNumber'))),
            primary: true,
          },
          identityDocuments: [
            ...(civilId
              ? [{ documentType: 'civil_id' as const, number: civilId, issuingCountryCode: 'OM' }]
              : []),
            ...(registration
              ? [
                  {
                    documentType: 'commercial_registration' as const,
                    number: registration,
                    issuingCountryCode: 'OM',
                  },
                ]
              : []),
          ],
        },
      };
    }
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
          unitId: optional(text(form.get('unitId'))),
          dueAt: toIsoDateTime(text(form.get('dueAt'))),
        },
      };
    case 'bookings':
      if (text(form.get('bookingKind')) === 'hold')
        return {
          path: '/v1/leasing/holds',
          body: {
            unitId: text(form.get('unitId')),
            prospectPartyId: text(form.get('prospectPartyId')),
            expiresAt: toIsoDateTime(text(form.get('expiresAt'))),
            note: optional(text(form.get('notes'))),
          },
        };
      if (text(form.get('bookingKind')) === 'reservation')
        return {
          path: '/v1/leasing/reservations',
          body: {
            unitId: text(form.get('unitId')),
            tenantPartyId: text(form.get('prospectPartyId')),
            expiresAt: toIsoDateTime(text(form.get('expiresAt'))),
          },
        };
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
          graceDays: Number(text(form.get('graceDays')) || '0'),
          ...(text(form.get('graceAmount'))
            ? { graceAmount: { amountMinor: amount('graceAmount'), currency } }
            : {}),
          ...(text(form.get('handoverOn')) ? { handoverOn: text(form.get('handoverOn')) } : {}),
          approvalChain: text(form.get('approvalChain')) || 'accountant',
          cheques: [1, 2]
            .map((index) => {
              const bankName = text(form.get(`cheque${index}Bank`));
              const chequeNumber = text(form.get(`cheque${index}Number`));
              const chequeAmount = text(form.get(`cheque${index}Amount`));
              const dueOn = text(form.get(`cheque${index}DueOn`));
              if (!bankName || !chequeNumber || !chequeAmount || !dueOn) return null;
              return {
                bankName,
                chequeNumber,
                amount: { amountMinor: amount(`cheque${index}Amount`), currency },
                dueOn,
              };
            })
            .filter(Boolean),
          ...(text(form.get('reservationId'))
            ? { reservationId: text(form.get('reservationId')) }
            : {}),
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
      const unitId = optional(text(form.get('unitId')));
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
              ...(unitId ? { unitId } : {}),
            },
            {
              accountId: text(form.get('creditAccountId')),
              debitMinor: '0',
              creditMinor: value,
              currency,
              ...(unitId ? { unitId } : {}),
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
          unitId: optional(text(form.get('unitId'))),
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
    case 'team':
      return {
        path: '/v1/organizations/current/representatives',
        body: {
          displayName: text(form.get('displayName')),
          email: text(form.get('email')),
          roleKey: text(form.get('roleKey')),
        },
      };
    case 'api-keys':
      return {
        path: '/v1/auth/api-keys',
        body: {
          name: text(form.get('name')),
          scopes: form
            .getAll('scopes')
            .filter((scope): scope is string => typeof scope === 'string'),
          expiresAt: toIsoDateTime(text(form.get('expiresAt'))),
          totpCode: optional(text(form.get('totpCode'))),
        },
      };
    default:
      throw new Error('create_not_supported');
  }
}

function nextAction(section: OperationsSection, row: DataRow) {
  const status = safeString(row.status);
  const id = safeString(row.id);
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
  if (
    section === 'contracts' &&
    status === 'draft' &&
    safeString(row.approvalStatus) === 'approved'
  )
    return { path: `/v1/leasing/contracts/${id}/send`, method: 'POST', body: {}, next: 'sent' };
  if (section === 'approvals' && status === 'pending')
    return {
      path: `/v1/operations/approvals/${id}`,
      method: 'PATCH',
      body: { decision: 'approved' },
      next: 'approved',
    };
  if (section === 'bookings') {
    const kind = safeString(row.recordKind);
    if (kind === 'reservation' && status === 'pending')
      return {
        path: `/v1/leasing/reservations/${id}`,
        method: 'PATCH',
        body: {
          status: 'confirmed',
          note: 'Accountant confirmed security deposit receipt',
        },
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
  if (section === 'leasing' && status === 'draft')
    return {
      path: `/v1/leasing/leases/${id}`,
      method: 'PATCH',
      body: { action: 'activate' },
      next: 'active',
    };
  if (section === 'leasing' && status === 'active')
    return {
      path: `/v1/leasing/leases/${id}`,
      method: 'PATCH',
      body: { action: 'end' },
      next: 'ended',
    };
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
  apiOnline = true,
  nestConfigured = true,
  recordsEmpty = false,
  apiUnauthorized = false,
  dataFromDb = false,
}: {
  portal: PortalRole;
  section: OperationsSection;
  locale: 'ar' | 'en';
  records: DataRow[];
  summary: DataRow;
  secondary: DataRow[];
  context: OperationsContext;
  apiOnline?: boolean;
  nestConfigured?: boolean;
  recordsEmpty?: boolean;
  apiUnauthorized?: boolean;
  dataFromDb?: boolean;
}) {
  const router = useRouter();
  const definition = definitions[section];
  const ar = locale === 'ar';
  const refreshWorkspace = () => {
    invalidateOpsCache(portal, section);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('bhd-r-ops-refresh', { detail: { portal, section } }),
      );
    }
    router.refresh();
  };
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [archiveMode, setArchiveMode] = useState(false);
  const [archiveRecords, setArchiveRecords] = useState<DataRow[] | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeySecret, setApiKeySecret] = useState<string | null>(null);
  const [renewingLease, setRenewingLease] = useState<DataRow | null>(null);
  const [prefillUnitId, setPrefillUnitId] = useState('');
  const [prefillReservationId, setPrefillReservationId] = useState('');
  const [prefillTenantId, setPrefillTenantId] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [hideApiBanner, setHideApiBanner] = useState(false);
  const [statsOpen, setStatsOpen] = useState(true);
  const showOpsDiagnostics = portal === 'platform';

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(`ops-stats-open:${section}`);
      if (stored === '0') setStatsOpen(false);
      else if (stored === '1') setStatsOpen(true);
      else if (window.matchMedia('(max-width: 960px)').matches) setStatsOpen(false);
    } catch {
      /* ignore */
    }
  }, [section]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const unitId = params.get('unitId') ?? '';
    const reservationId = params.get('reservationId') ?? '';
    const tenantId = params.get('tenantId') ?? '';
    const propertyId = params.get('propertyId') ?? '';
    setPrefillUnitId(unitId);
    setPrefillReservationId(reservationId);
    setPrefillTenantId(tenantId);
    // Portfolio lists every property — ?propertyId= is for bookings/leasing filters only.
    setPropertyFilter(section === 'properties' ? '' : propertyId);
    if (reservationId && !tenantId) {
      const match = (context.confirmedReservations ?? context.reservations ?? []).find(
        (row) => row.id === reservationId,
      );
      if (match?.tenantPartyId) setPrefillTenantId(match.tenantPartyId);
      if (match?.unitId && !unitId) setPrefillUnitId(match.unitId);
    }
    if (params.get('create') === '1') setShowCreate(true);
  }, [section, context.confirmedReservations, context.reservations]);

  const vacantUnits = context.vacantUnits ?? [];
  const pendingDeposits = context.pendingDepositReservations ?? [];
  const cancelRequestedLeases = context.cancelRequestedLeases ?? [];
  const clearancePendingLeases = context.clearancePendingLeases ?? [];
  const renewalPendingLeases = context.renewalPendingLeases ?? [];
  const vacancyFollowUps = context.vacancyFollowUps;
  const vacancyFollowUpTotal = vacancyFollowUps
    ? vacancyFollowUps.tasks +
      vacancyFollowUps.maintenance +
      vacancyFollowUps.legal +
      vacancyFollowUps.expenses
    : 0;
  const sourceRecords = section === 'properties' && archiveMode ? (archiveRecords ?? []) : records;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const unitIdsForProperty = propertyFilter
      ? new Set(
          [...(context.units ?? []), ...(context.vacantUnits ?? [])]
            .filter((unit) => unit.propertyId === propertyFilter)
            .map((unit) => unit.id),
        )
      : null;
    return sourceRecords.filter((row) => {
      const status = safeString(row.status);
      if (section === 'properties') {
        if (archiveMode) {
          if (status !== 'archived') return false;
        } else if (statusFilter) {
          if (status !== statusFilter) return false;
          if (status === 'archived') return false;
        } else if (status === 'archived') {
          return false;
        }
      } else if (statusFilter && status !== statusFilter) {
        return false;
      }
      if (propertyFilter && section !== 'properties') {
        const rowPropertyId = safeString(row.propertyId);
        const rowUnitId = safeString(row.unitId);
        const matchesProperty =
          rowPropertyId === propertyFilter ||
          (rowUnitId && unitIdsForProperty?.has(rowUnitId)) ||
          JSON.stringify(row).includes(propertyFilter);
        if (!matchesProperty) return false;
      }
      if (!normalized) return true;
      return JSON.stringify(row).toLocaleLowerCase().includes(normalized);
    });
  }, [
    query,
    sourceRecords,
    statusFilter,
    propertyFilter,
    context.units,
    context.vacantUnits,
    section,
    archiveMode,
  ]);
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
      ].includes(safeString(row.status)),
  ).length;
  const completedCount = Math.max(0, records.length - openCount);
  const amountTotals = new Map<string, bigint>();
  if (definition.moneyKey) {
    for (const row of records) {
      const nested = Array.isArray(row.amounts) ? row.amounts : [row];
      for (const candidate of nested) {
        if (!candidate || typeof candidate !== 'object') continue;
        const item = candidate as DataRow;
        const currency = safeString(item.currency);
        const amount = safeString(item[definition.moneyKey]);
        if (!currency || !/^-?\d+$/.test(amount)) continue;
        amountTotals.set(currency, (amountTotals.get(currency) ?? 0n) + BigInt(amount));
      }
    }
  }

  function closeCreate() {
    setApiKeySecret(null);
    setShowCreate(false);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const request = creationRequest(section, new FormData(event.currentTarget));
      const result = await browserMutation<{ key?: string }>(request.path, {
        method: 'POST',
        body: JSON.stringify(request.body),
      });
      if (section === 'api-keys' && result.key) {
        setApiKeySecret(result.key);
        refreshWorkspace();
        return;
      }
      setShowCreate(false);
      refreshWorkspace();
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
    setSuccessNotice(null);
    try {
      await browserMutation(action.path, {
        method: action.method,
        body: JSON.stringify(action.body),
      });
      if (
        section === 'bookings' &&
        safeString(row.recordKind) === 'reservation' &&
        action.next === 'confirmed'
      ) {
        setSuccessNotice(
          ar
            ? 'تم تأكيد العربون وترحيل القيد المحاسبي (إن وُجد مبلغ ضمان). يمكنك الآن تحويل الحجز لعقد قيد الإجراء.'
            : 'Deposit confirmed and ledger journal posted (when deposit amount exists). You can convert the reservation to an in-progress lease.',
        );
      }
      refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function leaseLifecycle(
    row: DataRow,
    action:
      | 'activate'
      | 'end'
      | 'terminate'
      | 'request_cancellation'
      | 'approve_cancellation'
      | 'clear_cancellation'
      | 'confirm_renewal'
      | 'waive_renewal_gate',
  ) {
    const id = safeString(row.id);
    if (!id) return;
    let body: Record<string, string> = { action };
    if (action === 'request_cancellation') {
      const proposed =
        window.prompt(
          ar ? 'تاريخ الإلغاء المقترح (YYYY-MM-DD)' : 'Proposed cancel date (YYYY-MM-DD)',
          safeString(row.endsOn) || undefined,
        ) ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(proposed)) {
        setError(ar ? 'تاريخ غير صالح' : 'Invalid date');
        return;
      }
      body = { action, proposedEndsOn: proposed, source: 'admin' };
    }
    if (action === 'approve_cancellation') {
      const effective =
        window.prompt(
          ar ? 'تاريخ الإلغاء المعتمد (YYYY-MM-DD)' : 'Approved cancel date (YYYY-MM-DD)',
          safeString(row.cancellationProposedOn) || safeString(row.endsOn) || undefined,
        ) ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
        setError(ar ? 'تاريخ غير صالح' : 'Invalid date');
        return;
      }
      body = { action, effectiveOn: effective };
    }
    if (action === 'clear_cancellation' || action === 'confirm_renewal' || action === 'waive_renewal_gate') {
      const noteRequired =
        action === 'clear_cancellation' &&
        Number(safeString(row.depositMinor) || '0') > 0;
      const note =
        window.prompt(
          noteRequired
            ? ar
              ? 'ملاحظة المحاسب إلزامية: تأكيد تصفية التأمين/المطالبات'
              : 'Required: confirm deposit/claims settlement'
            : ar
              ? 'ملاحظة المحاسب / المدير (اختياري)'
              : 'Accountant/manager note (optional)',
        ) ?? '';
      if (noteRequired && !note.trim()) {
        setError(
          ar
            ? 'يلزم تأكيد المحاسب لتصفية التأمين قبل الإلغاء'
            : 'Deposit settlement note required before clearance',
        );
        return;
      }
      if (note) body = { ...body, note };
    }
    setBusy(true);
    setError(null);
    try {
      await browserMutation(`/v1/leasing/leases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitRenewal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renewingLease) return;
    const leaseId = safeString(renewingLease.id);
    const currency = safeString(renewingLease.currency) as CurrencyCode;
    const form = new FormData(event.currentTarget);
    const rent = text(form.get('rent'));
    const chequeBank = text(form.get('chequeBank'));
    const chequeNumber = text(form.get('chequeNumber'));
    const chequeAmount = text(form.get('chequeAmount'));
    const chequeDueOn = text(form.get('chequeDueOn'));
    const cheques =
      chequeBank && chequeNumber && chequeAmount && chequeDueOn
        ? [
            {
              bankName: chequeBank,
              chequeNumber,
              amount: { amountMinor: toMinorUnits(chequeAmount, currency), currency },
              dueOn: chequeDueOn,
            },
          ]
        : [];
    setBusy(true);
    setError(null);
    try {
      await browserMutation(`/v1/leasing/leases/${encodeURIComponent(leaseId)}/renewals`, {
        method: 'POST',
        body: JSON.stringify({
          templateVersionId: text(form.get('templateVersionId')),
          endsOn: text(form.get('endsOn')),
          ...(rent ? { rent: { amountMinor: toMinorUnits(rent, currency), currency } } : {}),
          ...(text(form.get('additionalTerms'))
            ? { additionalTerms: text(form.get('additionalTerms')) }
            : {}),
          ...(cheques.length ? { cheques } : {}),
        }),
      });
      setRenewingLease(null);
      refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function decideApproval(row: DataRow, decision: 'approved' | 'rejected') {
    const id = safeString(row.id);
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await browserMutation(`/v1/operations/approvals/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      });
      refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function revokeApiKey(row: DataRow) {
    const id = safeString(row.id);
    if (!id) return;
    const totpCode = window.prompt(
      ar
        ? 'أدخل رمز TOTP إذا كان مفعلاً، أو اتركه فارغاً ثم اضغط موافق.'
        : 'Enter your TOTP code when enabled, or leave it blank and press OK.',
      '',
    );
    if (totpCode === null) return;
    setBusy(true);
    setError(null);
    try {
      await browserMutation(`/v1/auth/api-keys/${encodeURIComponent(id)}/revoke`, {
        method: 'PATCH',
        body: JSON.stringify({ ...(totpCode ? { totpCode } : {}) }),
      });
      refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function updateMemberAccess(row: DataRow, status: 'active' | 'inactive') {
    const userId = safeString(row.userId);
    const roleKey = safeString(row.roleKey);
    if (!userId || !roleKey) return;
    if (
      status === 'inactive' &&
      !window.confirm(
        ar
          ? 'سيتم إلغاء جلسات هذا المستخدم فوراً. هل تريد المتابعة؟'
          : 'This user’s sessions will be revoked immediately. Continue?',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await browserMutation(`/v1/organizations/current/members/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ roleKey, status }),
      });
      refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/v1/reports/${encodeURIComponent(id)}/download`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(ar ? 'ملف التقرير غير متاح بعد' : 'Report is not ready');
      const payload = (await response.json()) as { downloadUrl: string };
      window.location.assign(payload.downloadUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'download_failed');
    } finally {
      setBusy(false);
    }
  }

  async function downloadFinanceDocument(kind: 'invoice' | 'receipt', id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/v1/finance/${kind === 'invoice' ? 'invoices' : 'receipts'}/${encodeURIComponent(id)}/document`,
        { credentials: 'same-origin', headers: { accept: 'application/json' } },
      );
      if (!response.ok)
        throw new Error(ar ? 'المستند غير جاهز بعد' : 'The document is not ready yet');
      const payload = (await response.json()) as { url: string };
      const target = new URL(payload.url);
      if (
        target.protocol !== 'https:' &&
        !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))
      )
        throw new Error(ar ? 'رابط مستند غير آمن' : 'Unsafe document URL');
      window.location.assign(target.href);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'download_failed');
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
          {propertyFilter ? (
            <p className="notice">
              {ar
                ? 'معروض فقط ما يخص هذا العقار.'
                : 'Showing records for this property only.'}{' '}
              <Link href={`/${portal}/${section}`} prefetch scroll={false}>
                {ar ? 'إظهار الكل' : 'Show all'}
              </Link>
            </p>
          ) : null}
        </div>
        <div className="ops-header__actions">
          {section === 'properties' ? (
            <>
              <button
                type="button"
                className={`button ${archiveMode ? 'button--primary' : 'button--quiet'}`}
                disabled={archiveBusy}
                onClick={() => {
                  if (archiveMode) {
                    setArchiveMode(false);
                    setStatusFilter('');
                    return;
                  }
                  setArchiveBusy(true);
                  void (async () => {
                    try {
                      const path =
                        portal === 'developer'
                          ? '/v1/developer/projects?view=archive'
                          : '/v1/owner/properties?view=archive';
                      const response = await fetch(browserApiPath(path), {
                        credentials: 'same-origin',
                        headers: { accept: 'application/json' },
                        cache: 'no-store',
                        signal: AbortSignal.timeout(20_000),
                      });
                      if (!response.ok) throw new Error('archive_load_failed');
                      const payload = (await response.json()) as DataRow[] | { items?: DataRow[] };
                      const rows = Array.isArray(payload)
                        ? payload
                        : Array.isArray(payload.items)
                          ? payload.items
                          : [];
                      setArchiveRecords(rows);
                      setArchiveMode(true);
                      setStatusFilter('archived');
                    } catch {
                      setError(
                        ar
                          ? 'تعذر تحميل الأرشيف — تحقق من Nest ثم أعد المحاولة.'
                          : 'Could not load archive — check Nest and retry.',
                      );
                    } finally {
                      setArchiveBusy(false);
                    }
                  })();
                }}
              >
                {archiveMode
                  ? ar
                    ? 'العقارات النشطة'
                    : 'Active properties'
                  : ar
                    ? 'الأرشيف'
                    : 'Archive'}
              </button>
              {!archiveMode ? (
                <Link className="button button--primary" href={`/${portal}/properties/new`} prefetch>
                  ＋ {ar ? definition.createAr : definition.createEn}
                </Link>
              ) : null}
            </>
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
                }).then(() => refreshWorkspace())
              }
            >
              {ar ? 'تهيئة دليل الحسابات' : 'Initialize chart of accounts'}
            </button>
          ) : null}
          {canCreate ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                setApiKeySecret(null);
                setShowCreate(true);
              }}
            >
              ＋ {ar ? definition.createAr : definition.createEn}
            </button>
          ) : null}
        </div>
      </header>

      {!hideApiBanner && (!nestConfigured || !apiOnline) && !(dataFromDb && !recordsEmpty) ? (
        <div className="ops-api-banner" role="status">
          <button
            type="button"
            className="ops-api-banner__dismiss"
            aria-label={ar ? 'إخفاء' : 'Dismiss'}
            onClick={() => setHideApiBanner(true)}
          >
            ×
          </button>
          <strong>
            {showOpsDiagnostics
              ? !nestConfigured
                ? ar
                  ? 'Nest API غير مضبوط على Vercel'
                  : 'Nest API is not configured on Vercel'
                : ar
                  ? 'تعذّر الوصول إلى Nest API'
                  : 'Nest API is unreachable'
              : ar
                ? 'بعض الإجراءات غير متاحة مؤقتاً'
                : 'Some actions are temporarily unavailable'}
          </strong>
          <p>
            {showOpsDiagnostics
              ? !nestConfigured
                ? ar
                  ? 'Nest غير منشور بعد. انشر apps/api على Render (render.yaml) ثم أضف على Vercel: API_INTERNAL_ORIGIN و API_ORIGIN = رابط Nest HTTPS (ليس localhost). الدليل: docs/implementation/NEST-API-HOSTING.md و VERCEL-MANUAL-AR.md'
                  : 'Nest is not hosted yet. Deploy apps/api on Render (render.yaml), then set Vercel API_INTERNAL_ORIGIN and API_ORIGIN to that HTTPS URL (never localhost). See docs/implementation/NEST-API-HOSTING.md'
                : ar
                  ? 'الرابط مضبوط على Vercel لكن خادم Nest على Render لا يستجيب الآن (غالباً الخدمة نائمة أو فشل النشر). من لوحة Render افتح الخدمة → Logs، ثم Manual Deploy لآخر commit ناجح، وانتظر حتى تصبح Live.'
                  : 'Vercel has API_INTERNAL_ORIGIN set, but Nest on Render is not responding (sleeping or failed deploy). In Render open the service → Logs, Manual Deploy the latest good commit, wait until Live.'
              : dataFromDb
                ? ar
                  ? 'يمكنك تصفح السجلات. للحفظ أو إضافة عقار جديد سجّل خروجاً ثم ادخلاً مجدداً من الهاتف أو الكمبيوتر.'
                  : 'You can browse records. To save or add a property, sign out and sign in again on phone or desktop.'
                : ar
                  ? 'الخدمة الخلفية غير جاهزة مؤقتاً. إن استمرت الحالة جرّب بعد لحظات دون إعادة تسجيل الدخول.'
                  : 'The backend is temporarily unavailable. If this persists, wait a moment — you usually do not need to sign in again.'}
          </p>
          {showOpsDiagnostics && nestConfigured ? <NestReconnectButton locale={locale} /> : null}
          {recordsEmpty ? (
            <p className="ops-api-banner__note">
              {ar
                ? 'لا سجلات معروضة حالياً لهذا القسم.'
                : 'No records shown for this section right now.'}
            </p>
          ) : dataFromDb && showOpsDiagnostics ? (
            <p className="ops-api-banner__note">
              {ar
                ? 'تُعرض السجلات من قاعدة البيانات مباشرة (قراءة). الحفظ والإجراءات تحتاج Nest على Render Live.'
                : 'Records are shown from the database (read-only path). Saves and actions need Nest Live on Render.'}
            </p>
          ) : null}
        </div>
      ) : !hideApiBanner && apiUnauthorized && !dataFromDb ? (
        <div className="ops-api-banner ops-api-banner--soft" role="status">
          <button
            type="button"
            className="ops-api-banner__dismiss"
            aria-label={ar ? 'إخفاء' : 'Dismiss'}
            onClick={() => setHideApiBanner(true)}
          >
            ×
          </button>
          <strong>
            {ar ? 'أعد تسجيل الدخول لإكمال بعض الإجراءات' : 'Sign in again to finish some actions'}
          </strong>
          <p>
            {ar
              ? 'التصفح متاح من قاعدة البيانات. إن احتجت إجراءً لا يعمل: اخرج ثم ادخل من جديد.'
              : 'Browsing works from the database. If an action fails: sign out and sign in again.'}
          </p>
          {recordsEmpty ? (
            <p className="ops-api-banner__note">
              {ar
                ? 'لا سجلات معروضة حالياً لهذا القسم — غالباً بسبب انتهاء الجلسة.'
                : 'No records shown for this section — usually because the session expired.'}
            </p>
          ) : null}
        </div>
      ) : null}

      {successNotice ? (
        <div className="notice notice--success" role="status">
          {successNotice}
        </div>
      ) : null}

      {section === 'bookings' && pendingDeposits.length ? (
        <section
          className="ops-deposit-queue"
          aria-label={ar ? 'طابور تأكيد العربون' : 'Deposit confirmation queue'}
        >
          <header>
            <h2>{ar ? 'بانتظار تأكيد المحاسب للعربون' : 'Awaiting accountant deposit confirmation'}</h2>
            <p>
              {ar
                ? 'أكد الاستلام لترحيل القيد ثم حوّل الحجز لعقد قيد الإجراء.'
                : 'Confirm receipt to post the ledger entry, then convert to an in-progress lease.'}
            </p>
          </header>
          <ul>
            {pendingDeposits.slice(0, 12).map((row) => (
              <li key={row.id}>
                <strong>{labelForOption(row, locale)}</strong>
                <div className="ops-vacant-strip__actions">
                  <button
                    className="ops-action"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void advance({
                        ...row,
                        recordKind: 'reservation',
                        status: 'pending',
                        id: row.id,
                      })
                    }
                  >
                    {ar ? 'تأكيد العربون' : 'Confirm deposit'}
                  </button>
                  <Link
                    href={`/${portal}/bookings/${encodeURIComponent(row.id)}`}
                    className="ops-action"
                    prefetch
                  >
                    {ar ? 'المستندات' : 'Documents'}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {section === 'leasing' && cancelRequestedLeases.length ? (
        <section
          className="ops-deposit-queue"
          aria-label={ar ? 'طلبات إلغاء بانتظار الإدارة' : 'Cancel requests awaiting admin'}
        >
          <header>
            <h2>{ar ? 'طلبات إلغاء — اعتماد الإدارة' : 'Cancel requests — admin approval'}</h2>
            <p>
              {ar
                ? 'ثبّت تاريخ الإلغاء ثم يمر للعقد إلى بوابة المحاسب.'
                : 'Set the cancellation date, then the lease moves to accountant clearance.'}
            </p>
          </header>
          <ul>
            {cancelRequestedLeases.slice(0, 12).map((row) => (
              <li key={safeString(row.id)}>
                <strong>{labelForOption(row, locale)}</strong>
                <div className="ops-vacant-strip__actions">
                  <button
                    className="ops-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void leaseLifecycle({ ...row } as DataRow, 'approve_cancellation')}
                  >
                    {ar ? 'اعتماد + تاريخ' : 'Approve + date'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {section === 'leasing' && clearancePendingLeases.length ? (
        <section
          className="ops-deposit-queue"
          aria-label={ar ? 'بانتظار تصفية المحاسب' : 'Awaiting accountant clearance'}
        >
          <header>
            <h2>{ar ? 'تصفية محاسب قبل الإلغاء/الإنهاء' : 'Accountant clearance before exit'}</h2>
            <p>
              {ar
                ? 'لا متأخرات ولا فواتير مفتوحة؛ ملاحظة التأمين إلزامية إن وُجد ضمان.'
                : 'No open invoices; deposit note required when a security deposit exists.'}
            </p>
          </header>
          <ul>
            {clearancePendingLeases.slice(0, 12).map((row) => (
              <li key={safeString(row.id)}>
                <strong>{labelForOption(row, locale)}</strong>
                <div className="ops-vacant-strip__actions">
                  <button
                    className="ops-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void leaseLifecycle({ ...row } as DataRow, 'clear_cancellation')}
                  >
                    {ar ? 'تصفية محاسب' : 'Clear'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {section === 'leasing' && renewalPendingLeases.length ? (
        <section
          className="ops-deposit-queue"
          aria-label={ar ? 'تجديد بانتظار الاعتماد' : 'Renewals awaiting confirmation'}
        >
          <header>
            <h2>{ar ? 'تجديد موقّع — بوابة المحاسب' : 'Signed renewal — accountant gate'}</h2>
            <p>
              {ar
                ? 'أكد الشيكات/الفواتير أو استخدم استثناء المدير.'
                : 'Confirm cheques/invoices or use the manager waive.'}
            </p>
          </header>
          <ul>
            {renewalPendingLeases.slice(0, 12).map((row) => (
              <li key={safeString(row.id)}>
                <strong>{labelForOption(row, locale)}</strong>
                <div className="ops-vacant-strip__actions">
                  <button
                    className="ops-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void leaseLifecycle({ ...row } as DataRow, 'confirm_renewal')}
                  >
                    {ar ? 'اعتماد محاسب' : 'Confirm'}
                  </button>
                  <button
                    className="ops-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void leaseLifecycle({ ...row } as DataRow, 'waive_renewal_gate')}
                  >
                    {ar ? 'استثناء مدير' : 'Waive'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="ops-stats" aria-label={ar ? 'المؤشرات ومراحل العمل' : 'Metrics and stages'}>
        <button
          type="button"
          className="ops-stats__toggle"
          aria-expanded={statsOpen}
          onClick={() => {
            setStatsOpen((open) => {
              const next = !open;
              try {
                window.sessionStorage.setItem(`ops-stats-open:${section}`, next ? '1' : '0');
              } catch {
                /* ignore */
              }
              return next;
            });
          }}
        >
          <span>
            {ar ? 'المؤشرات ومراحل العمل' : 'Metrics & stages'}
            <small>
              {records.length} {ar ? 'سجل' : 'records'} · {openCount}{' '}
              {ar ? 'متابعة' : 'open'}
            </small>
          </span>
          <em aria-hidden="true">{statsOpen ? (ar ? 'طي' : 'Hide') : ar ? 'عرض' : 'Show'}</em>
        </button>

        {statsOpen ? (
          <>
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
                    ? amountTotals.size === 1
                      ? [...amountTotals].map(([currency, amount]) =>
                          formatMoney(amount.toString(), currency, locale),
                        )[0]
                      : amountTotals.size > 1
                        ? `${amountTotals.size} ${ar ? 'عملات' : 'currencies'}`
                        : '—'
                    : safeString(
                        summary.pendingApprovals ?? summary.draftJournals ?? secondary.length,
                      )}
                </strong>
                <small>{ar ? 'محدث من البيانات التشغيلية' : 'Updated from operational data'}</small>
              </article>
            </section>

            {definition.moneyKey && amountTotals.size > 1 ? (
              <section
                className="ops-currency-totals"
                aria-label={ar ? 'الإجماليات حسب العملة' : 'Totals by currency'}
              >
                {[...amountTotals]
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([currency, amount]) => (
                    <article key={currency}>
                      <span>{currency}</span>
                      <strong>{formatMoney(amount.toString(), currency, locale)}</strong>
                    </article>
                  ))}
              </section>
            ) : null}

            <section className="ops-flow" aria-label={ar ? 'مراحل العمل' : 'Workflow stages'}>
              {definition.flow.map((stage, index) => {
                const count = records.filter((row) => safeString(row.status) === stage.value).length;
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
          </>
        ) : null}
      </section>

      {vacancyFollowUpTotal > 0 &&
      (section === 'tasks' ||
        section === 'maintenance' ||
        section === 'legal' ||
        section === 'expenses' ||
        section === 'accounting' ||
        section === 'bookings') ? (
        <section
          className="ops-vacancy-pipeline"
          aria-label={ar ? 'متابعة الشغور' : 'Vacancy follow-ups'}
        >
          <header>
            <h2>{ar ? 'متابعة الوحدات الشاغرة (تلقائي)' : 'Vacancy follow-ups (auto)'}</h2>
            <p>
              {ar
                ? 'بعد إنهاء/فسخ العقد تُنشأ مهمة وصيانة ومحاماة ومصروف مخالصة.'
                : 'After lease end/terminate, task, maintenance, legal, and settlement expense are seeded.'}
            </p>
          </header>
          <ul>
            <li>
              <Link href={`/${portal}/tasks`} prefetch>
                {ar ? 'مهام' : 'Tasks'} <strong>{vacancyFollowUps?.tasks ?? 0}</strong>
              </Link>
            </li>
            <li>
              <Link href={`/${portal}/maintenance`} prefetch>
                {ar ? 'صيانة' : 'Maintenance'} <strong>{vacancyFollowUps?.maintenance ?? 0}</strong>
              </Link>
            </li>
            <li>
              <Link href={`/${portal}/legal`} prefetch>
                {ar ? 'محاماة' : 'Legal'} <strong>{vacancyFollowUps?.legal ?? 0}</strong>
              </Link>
            </li>
            <li>
              <Link href={`/${portal}/expenses`} prefetch>
                {ar ? 'مصروفات' : 'Expenses'} <strong>{vacancyFollowUps?.expenses ?? 0}</strong>
              </Link>
            </li>
          </ul>
        </section>
      ) : null}

      {vacantUnits.length &&
      (section === 'bookings' ||
        section === 'tasks' ||
        section === 'maintenance' ||
        section === 'legal' ||
        section === 'accounting') ? (
        <section className="ops-vacant-strip" aria-label={ar ? 'الوحدات الشاغرة' : 'Vacant units'}>
          <header>
            <h2>{ar ? 'وحدات شاغرة — إجراءات سريعة' : 'Vacant units — quick actions'}</h2>
            <p>
              {ar
                ? 'بعد شغور الوحدة اربطها بمهمة أو صيانة أو محاماة أو قيد محاسبي.'
                : 'When a unit is vacant, link it to a task, maintenance, legal case, or journal.'}
            </p>
          </header>
          <ul>
            {vacantUnits.slice(0, 12).map((unit) => {
              const label = labelForOption(unit, locale);
              return (
                <li key={unit.id}>
                  <strong>{label}</strong>
                  <div className="ops-vacant-strip__actions">
                    <Link href={`/${portal}/bookings?create=1&unitId=${unit.id}`} prefetch>
                      {ar ? 'حجز' : 'Book'}
                    </Link>
                    <Link href={`/${portal}/tasks?create=1&unitId=${unit.id}`} prefetch>
                      {ar ? 'مهمة' : 'Task'}
                    </Link>
                    <Link href={`/${portal}/maintenance?create=1&unitId=${unit.id}`} prefetch>
                      {ar ? 'صيانة' : 'Maintenance'}
                    </Link>
                    <Link href={`/${portal}/legal?create=1&unitId=${unit.id}`} prefetch>
                      {ar ? 'محاماة' : 'Legal'}
                    </Link>
                    <Link href={`/${portal}/accounting?create=1&unitId=${unit.id}`} prefetch>
                      {ar ? 'حسابات' : 'Accounts'}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

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
        <div className="data-table-wrap ops-desktop-table">
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
                const reportId = section === 'reports' ? safeString(row.id) : '';
                const reportReady = Boolean(reportId && safeString(row.status) === 'completed');
                const documentKind =
                  section === 'invoices' && row.documentReady
                    ? 'invoice'
                    : section === 'payments' &&
                        safeString(row.recordKind) === 'receipt' &&
                        row.documentReady
                      ? 'receipt'
                      : null;
                return (
                  <tr key={safeString(row.id ?? row.reference) || String(index)}>
                    {definition.columns.map((column) => (
                      <td
                        key={column.key}
                        className={column.format === 'thumb' ? 'ops-table__thumb-cell' : undefined}
                      >
                        {section === 'properties' && column.format === 'thumb' ? (
                          <PropertyOpsRowKey
                            propertyId={safeString(row.id)}
                            coverImageUrl={
                              typeof row.coverImageUrl === 'string' ? row.coverImageUrl : null
                            }
                            locale={locale}
                            {...(() => {
                              const n =
                                safeString(row.nameAr) ||
                                safeString(row.nameEn) ||
                                safeString(row.name);
                              return n ? { name: n } : {};
                            })()}
                          />
                        ) : (
                          displayCell(row, column, locale, context, definition.flow)
                        )}
                      </td>
                    ))}
                    <td>
                      {section === 'leasing' ? (
                        <span className="ops-inline-actions">
                          {safeString(row.status) === 'draft' ? (
                            <button
                              className="ops-action"
                              type="button"
                              disabled={busy}
                              onClick={() => void leaseLifecycle(row, 'activate')}
                            >
                              {ar ? 'تفعيل (ساري)' : 'Activate'}
                            </button>
                          ) : null}
                          {safeString(row.status) === 'active' ? (
                            <>
                              <button
                                className="ops-action"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setError(null);
                                  setRenewingLease(row);
                                }}
                              >
                                {ar ? 'تجديد' : 'Renew'}
                              </button>
                              {row.renewalPendingContractId ? (
                                <>
                                  <button
                                    className="ops-action"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void leaseLifecycle(row, 'confirm_renewal')}
                                  >
                                    {ar ? 'اعتماد تجديد (محاسب)' : 'Confirm renewal'}
                                  </button>
                                  <button
                                    className="ops-action"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void leaseLifecycle(row, 'waive_renewal_gate')}
                                  >
                                    {ar ? 'استثناء مدير' : 'Manager waive'}
                                  </button>
                                </>
                              ) : null}
                              <button
                                className="ops-action"
                                type="button"
                                disabled={busy}
                                onClick={() => void leaseLifecycle(row, 'end')}
                              >
                                {ar ? 'إنهاء → محاسب' : 'End → clearance'}
                              </button>
                              <button
                                className="ops-action ops-action--danger"
                                type="button"
                                disabled={busy}
                                onClick={() => void leaseLifecycle(row, 'request_cancellation')}
                              >
                                {ar ? 'طلب إلغاء' : 'Request cancel'}
                              </button>
                            </>
                          ) : null}
                          {safeString(row.status) === 'cancel_requested' ? (
                            <button
                              className="ops-action"
                              type="button"
                              disabled={busy}
                              onClick={() => void leaseLifecycle(row, 'approve_cancellation')}
                            >
                              {ar ? 'اعتماد الإدارة + تاريخ' : 'Admin approve + date'}
                            </button>
                          ) : null}
                          {safeString(row.status) === 'clearance_pending' ? (
                            <button
                              className="ops-action"
                              type="button"
                              disabled={busy}
                              onClick={() => void leaseLifecycle(row, 'clear_cancellation')}
                            >
                              {ar ? 'تصفية محاسب (لا متأخرات)' : 'Accountant clear'}
                            </button>
                          ) : null}
                          {safeString(row.status) === 'draft' ? (
                            <button
                              className="ops-action ops-action--danger"
                              type="button"
                              disabled={busy}
                              onClick={() => void leaseLifecycle(row, 'terminate')}
                            >
                              {ar ? 'إلغاء مسودة' : 'Void draft'}
                            </button>
                          ) : null}
                          {!['draft', 'active', 'cancel_requested', 'clearance_pending'].includes(
                            safeString(row.status),
                          )
                            ? '—'
                            : null}
                        </span>
                      ) : section === 'team' ? (
                        <button
                          className={`ops-action ${safeString(row.status) === 'active' ? 'ops-action--danger' : ''}`}
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void updateMemberAccess(
                              row,
                              safeString(row.status) === 'active' ? 'inactive' : 'active',
                            )
                          }
                        >
                          {safeString(row.status) === 'active'
                            ? ar
                              ? 'تعطيل وإلغاء الجلسات'
                              : 'Disable & revoke sessions'
                            : ar
                              ? 'إعادة التفعيل'
                              : 'Reactivate'}
                        </button>
                      ) : section === 'api-keys' && safeString(row.status) === 'active' ? (
                        <button
                          className="ops-action ops-action--danger"
                          type="button"
                          disabled={busy}
                          onClick={() => void revokeApiKey(row)}
                        >
                          {ar ? 'إلغاء المفتاح' : 'Revoke key'}
                        </button>
                      ) : section === 'approvals' && safeString(row.status) === 'pending' ? (
                        <span className="ops-inline-actions">
                          <button
                            className="ops-action"
                            type="button"
                            disabled={busy}
                            onClick={() => void decideApproval(row, 'approved')}
                          >
                            {ar ? 'اعتماد' : 'Approve'}
                          </button>
                          <button
                            className="ops-action ops-action--danger"
                            type="button"
                            disabled={busy}
                            onClick={() => void decideApproval(row, 'rejected')}
                          >
                            {ar ? 'رفض' : 'Reject'}
                          </button>
                        </span>
                      ) : section === 'bookings' && safeString(row.recordKind) === 'reservation' ? (
                        <span className="ops-inline-actions">
                          {safeString(row.status) === 'pending' ? (
                            <button
                              className="ops-action"
                              type="button"
                              disabled={busy}
                              onClick={() => void advance(row)}
                            >
                              {ar ? 'تأكيد العربون (محاسب)' : 'Confirm deposit'}
                            </button>
                          ) : null}
                          {safeString(row.status) === 'confirmed' ? (
                            <Link
                              className="ops-action"
                              href={`/${portal}/leasing?create=1&reservationId=${encodeURIComponent(safeString(row.id))}&unitId=${encodeURIComponent(safeString(row.unitId))}&tenantId=${encodeURIComponent(safeString(row.tenantPartyId))}`}
                              prefetch
                            >
                              {ar ? 'تحويل لعقد قيد الإجراء' : 'Convert to lease'}
                            </Link>
                          ) : null}
                          <Link
                            className="ops-action"
                            href={`/${portal}/bookings/${encodeURIComponent(safeString(row.id))}`}
                            prefetch
                          >
                            {ar ? 'المستندات' : 'Documents'}
                          </Link>
                          {safeString(row.status) === 'confirmed' ? (
                            <Link className="ops-action" href={`/${portal}/accounting`} prefetch>
                              {ar ? 'القيد المحاسبي' : 'Ledger'}
                            </Link>
                          ) : null}
                        </span>
                      ) : section === 'properties' ? (
                        <span className="ops-action-group">
                          <Link
                            className="ops-action"
                            href={`/properties/${encodeURIComponent(safeString(row.id))}`}
                            prefetch
                            target="_blank"
                            rel="noreferrer"
                          >
                            {ar ? 'عرض العقار' : 'View listing'}
                          </Link>
                          <Link
                            className="ops-action ops-action--primary"
                            href={`/${portal}/properties/${encodeURIComponent(safeString(row.id))}`}
                            prefetch
                          >
                            {ar ? 'إدارة العقار' : 'Manage property'}
                          </Link>
                        </span>
                      ) : section === 'contracts' ? (
                        <Link
                          className="ops-action"
                          href={`/${portal}/contracts/${encodeURIComponent(safeString(row.id))}`}
                          prefetch
                        >
                          {ar ? 'عرض العقد' : 'View contract'}
                        </Link>
                      ) : documentKind ? (
                        <button
                          className="ops-action"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void downloadFinanceDocument(documentKind, safeString(row.id))
                          }
                        >
                          {ar ? 'عرض PDF آمن' : 'View secure PDF'}
                        </button>
                      ) : reportReady ? (
                        <button
                          className="ops-action"
                          type="button"
                          disabled={busy}
                          onClick={() => void downloadReport(reportId)}
                        >
                          {ar ? 'تنزيل آمن' : 'Secure download'}
                        </button>
                      ) : action ? (
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
                      <span className="ops-empty__mark" aria-hidden="true">
                        <BrandMark />
                      </span>
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
        <div className="ops-mobile-cards" aria-label={ar ? 'قائمة السجلات' : 'Records list'}>
          {filtered.map((row, index) => {
            const serial = safeString(row.serialNumber);
            const name =
              safeString(row.nameAr) ||
              safeString(row.nameEn) ||
              safeString(row.displayName) ||
              safeString(row.name) ||
              '—';
            const location =
              safeString(row.location) ||
              [safeString(row.governorate), safeString(row.city)].filter(Boolean).join(' · ') ||
              '—';
            const statusRaw = safeString(row.status) || '—';
            const statusLabeled =
              definition.flow.find((item) => item.value === statusRaw) ?? null;
            const status = statusLabeled
              ? ar
                ? statusLabeled.ar
                : statusLabeled.en
              : statusRaw;
            const cover =
              typeof row.coverImageUrl === 'string' ? row.coverImageUrl : null;
            return (
              <article
                className="ops-mobile-card"
                key={safeString(row.id ?? row.reference) || `m-${index}`}
              >
                <div className="ops-mobile-card__head">
                  {section === 'properties' ? (
                    <PropertyOpsRowKey
                      propertyId={safeString(row.id)}
                      coverImageUrl={cover}
                      locale={locale}
                      {...(name && name !== '—' ? { name } : {})}
                    />
                  ) : null}
                  <div className="ops-mobile-card__head-copy">
                    <h3 className="ops-mobile-card__title">{name}</h3>
                    {serial ? (
                      <p className="ops-mobile-card__serial" dir="ltr">
                        {serial}
                      </p>
                    ) : null}
                  </div>
                </div>
                <dl className="ops-mobile-card__meta">
                  {section === 'properties' ? (
                    <>
                      <div>
                        <dt>{ar ? 'الموقع' : 'Location'}</dt>
                        <dd>{location}</dd>
                      </div>
                      <div>
                        <dt>{ar ? 'الحالة' : 'Status'}</dt>
                        <dd>{status}</dd>
                      </div>
                    </>
                  ) : (
                    definition.columns.slice(0, 4).map((column) => (
                      <div key={column.key}>
                        <dt>{ar ? column.ar : column.en}</dt>
                        <dd>{displayCell(row, column, locale, context, definition.flow)}</dd>
                      </div>
                    ))
                  )}
                </dl>
                {section === 'properties' ? (
                  <div className="ops-action-group">
                    <Link
                      className="ops-action button button--quiet"
                      href={`/properties/${encodeURIComponent(safeString(row.id))}`}
                      prefetch
                      target="_blank"
                      rel="noreferrer"
                    >
                      {ar ? 'عرض العقار' : 'View listing'}
                    </Link>
                    <Link
                      className="ops-action button button--quiet ops-action--primary"
                      href={`/${portal}/properties/${encodeURIComponent(safeString(row.id))}`}
                      prefetch
                    >
                      {ar ? 'إدارة العقار' : 'Manage property'}
                    </Link>
                  </div>
                ) : null}
              </article>
            );
          })}
          {!filtered.length ? (
            <div className="ops-empty">
              <span className="ops-empty__mark" aria-hidden="true">
                <BrandMark />
              </span>
              <strong>{ar ? 'لا توجد سجلات مطابقة' : 'No matching records'}</strong>
            </div>
          ) : null}
        </div>
      </section>

      {renewingLease ? (
        <div
          className="ops-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRenewingLease(null);
          }}
        >
          <section
            className="ops-modal__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ops-renewal-title"
          >
            <header>
              <div>
                <span className="ops-kicker">BHD R · CONTRACT CONTROL</span>
                <h2 id="ops-renewal-title">
                  {ar ? 'إنشاء ملحق تجديد' : 'Create renewal addendum'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRenewingLease(null)}
                aria-label={ar ? 'إغلاق' : 'Close'}
              >
                ×
              </button>
            </header>
            <p className="muted">
              {ar
                ? 'لن يتغير العقد الحالي حتى يُعتمد الملحق ويوقعه المالك والمستأجر.'
                : 'The current lease will not change until the addendum is approved and signed by both owner and tenant.'}
            </p>
            <form onSubmit={(event) => void submitRenewal(event)}>
              <div className="form-grid">
                <SelectOptions
                  name="templateVersionId"
                  label={ar ? 'قالب ملحق العقد' : 'Addendum template'}
                  options={context.contractTemplates ?? []}
                  locale={locale}
                  required
                />
                <Input
                  name="endsOn"
                  label={ar ? 'تاريخ النهاية الجديد' : 'New end date'}
                  type="date"
                  min={safeString(renewingLease.endsOn)}
                  required
                />
                <Input
                  name="rent"
                  label={`${ar ? 'الإيجار الجديد (اختياري)' : 'New rent (optional)'} · ${safeString(renewingLease.currency)}`}
                  type="number"
                  min="0"
                  step="0.001"
                />
                <label className="field span-2">
                  <span>{ar ? 'شروط إضافية' : 'Additional terms'}</span>
                  <textarea className="textarea" name="additionalTerms" maxLength={10000} />
                </label>
                <p className="muted span-2" style={{ margin: 0 }}>
                  {ar
                    ? 'جدول شيكات الفترة الجديدة (اختياري — مطلوب قبل اعتماد المحاسب ما لم يستثنِ المدير)'
                    : 'Renewal cheque schedule (optional — required before accountant confirm unless manager waives)'}
                </p>
                <Input name="chequeBank" label={ar ? 'بنك الشيك' : 'Cheque bank'} />
                <Input name="chequeNumber" label={ar ? 'رقم الشيك' : 'Cheque number'} />
                <Input
                  name="chequeAmount"
                  label={`${ar ? 'مبلغ الشيك' : 'Cheque amount'} · ${safeString(renewingLease.currency)}`}
                  type="number"
                  min="0"
                  step="0.001"
                />
                <Input name="chequeDueOn" label={ar ? 'استحقاق الشيك' : 'Cheque due'} type="date" />
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
                  onClick={() => setRenewingLease(null)}
                >
                  {ar ? 'إلغاء' : 'Cancel'}
                </button>
                <button className="button button--primary" type="submit" disabled={busy}>
                  {busy
                    ? ar
                      ? 'جارٍ الحفظ…'
                      : 'Saving…'
                    : ar
                      ? 'حفظ وإرسال للاعتماد'
                      : 'Save & request approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showCreate ? (
        <div
          className="ops-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCreate();
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
              <button type="button" onClick={closeCreate} aria-label={ar ? 'إغلاق' : 'Close'}>
                ×
              </button>
            </header>
            {apiKeySecret ? (
              <div className="api-key-secret" role="status">
                <strong>{ar ? 'انسخ المفتاح الآن' : 'Copy the key now'}</strong>
                <p>
                  {ar
                    ? 'لن تظهر القيمة السرية مرة أخرى بعد إغلاق هذه النافذة.'
                    : 'The secret will not be shown again after you close this dialog.'}
                </p>
                <code dir="ltr">{apiKeySecret}</code>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => {
                    closeCreate();
                  }}
                >
                  {ar ? 'تم النسخ والإغلاق' : 'Copied, close'}
                </button>
              </div>
            ) : (
              <form onSubmit={(event) => void submitCreate(event)}>
                <div className="form-grid">
                  <CreateFields
                    section={section}
                    locale={locale}
                    context={context}
                    prefillUnitId={prefillUnitId}
                    prefillReservationId={prefillReservationId}
                    prefillTenantId={prefillTenantId}
                  />
                </div>
                {error ? (
                  <div className="notice notice--error" role="alert">
                    {error}
                  </div>
                ) : null}
                <div className="form-actions">
                  <button className="button button--quiet" type="button" onClick={closeCreate}>
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
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
