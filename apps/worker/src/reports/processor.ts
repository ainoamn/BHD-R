import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { PdfJob, DomainEventJob } from '../types.js';
import type { StorageAdapter } from '../storage.js';
import { PermanentJobError } from '../errors.js';

type ReportFormat = 'csv' | 'xlsx' | 'pdf';
type Cell = string | number | bigint | boolean | null | undefined;

interface ReportJobRow {
  id: string;
  organization_id: string;
  type: string;
  format: string;
  status: string;
}

interface ReportData {
  title: string;
  columns: string[];
  rows: Cell[][];
}

const reportQueries: Record<string, { title: string; sql: string }> = {
  occupancy: {
    title: 'Occupancy / الإشغال',
    sql: `SELECT p.name_en AS property, count(u.id)::text AS units,
                 count(l.id) FILTER (WHERE l.status = 'active')::text AS occupied
          FROM properties p JOIN units u ON u.property_id = p.id
          LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
          WHERE p.organization_id = $1 GROUP BY p.id, p.name_en ORDER BY p.name_en`,
  },
  rent_roll: {
    title: 'Rent roll / سجل الإيجارات',
    sql: `SELECT p.name_en AS property, u.code AS unit, pa.display_name AS tenant,
                 l.status, l.starts_on::text, l.ends_on::text, l.rent_minor::text, l.currency
          FROM leases l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
          JOIN parties pa ON pa.id = l.tenant_party_id
          WHERE l.organization_id = $1 ORDER BY p.name_en, u.code`,
  },
  income: {
    title: 'Income / الإيرادات',
    sql: `SELECT i.invoice_number, p.received_at::text, p.method, p.status,
                 p.amount_minor::text, p.currency, p.provider_reference
          FROM payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE p.organization_id = $1 ORDER BY p.received_at DESC`,
  },
  arrears: {
    title: 'Arrears / المتأخرات',
    sql: `SELECT i.invoice_number, pa.display_name AS tenant, i.status, i.due_on::text,
                 (i.total_minor - i.paid_minor)::text AS outstanding_minor, i.currency
          FROM invoices i JOIN parties pa ON pa.id = i.tenant_party_id
          WHERE i.organization_id = $1 AND i.status IN ('issued','partially_paid','overdue')
          ORDER BY i.due_on`,
  },
  maintenance: {
    title: 'Maintenance / الصيانة',
    sql: `SELECT reference, title, priority, status, blocks_availability::text,
                 created_at::text, resolved_at::text
          FROM maintenance_tickets WHERE organization_id = $1 ORDER BY created_at DESC`,
  },
  portfolio: {
    title: 'Portfolio / المحفظة',
    sql: `SELECT p.name_en AS property, p.kind, p.category, p.status,
                 count(u.id)::text AS units, p.default_currency
          FROM properties p LEFT JOIN units u ON u.property_id = p.id
          WHERE p.organization_id = $1 GROUP BY p.id ORDER BY p.name_en`,
  },
  sales_pipeline: {
    title: 'Sales pipeline / مسار المبيعات',
    sql: `SELECT reference, status, asking_price_minor::text, agreed_price_minor::text,
                 currency, expected_closing_on::text, closed_on::text
          FROM sales_deals WHERE organization_id = $1 ORDER BY created_at DESC`,
  },
  legal_cases: {
    title: 'Legal cases / القضايا',
    sql: `SELECT reference, title, case_type, status, court_name, case_number,
                 next_hearing_at::text, claimed_amount_minor::text, recovered_amount_minor::text, currency
          FROM legal_cases WHERE organization_id = $1 ORDER BY created_at DESC`,
  },
  task_performance: {
    title: 'Task performance / أداء المهام',
    sql: `SELECT reference, title, priority, status, due_at::text, completed_at::text,
                 estimated_minutes::text, actual_minutes::text
          FROM work_tasks WHERE organization_id = $1 ORDER BY created_at DESC`,
  },
  requests: {
    title: 'Requests / الطلبات',
    sql: `SELECT reference, subject, type, priority, status, due_at::text,
                 completed_at::text, created_at::text
          FROM operational_requests WHERE organization_id = $1 ORDER BY created_at DESC`,
  },
  trial_balance: {
    title: 'Trial balance / ميزان المراجعة',
    sql: `SELECT a.code, a.name_en, a.type, coalesce(sum(l.debit_minor),0)::text AS debit_minor,
                 coalesce(sum(l.credit_minor),0)::text AS credit_minor, coalesce(l.currency,a.currency,'OMR') AS currency
          FROM ledger_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
          LEFT JOIN journal_entries j ON j.id = l.journal_entry_id AND j.status = 'posted'
          WHERE a.organization_id = $1 GROUP BY a.id, l.currency ORDER BY a.code`,
  },
  general_ledger: {
    title: 'General ledger / الأستاذ العام',
    sql: `SELECT j.reference, j.occurred_on::text, j.description, a.code AS account,
                 l.debit_minor::text, l.credit_minor::text, l.currency, l.memo
          FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id = j.id
          JOIN ledger_accounts a ON a.id = l.account_id
          WHERE j.organization_id = $1 AND j.status = 'posted'
          ORDER BY j.occurred_on, j.reference, l.created_at`,
  },
  expenses: {
    title: 'Expenses / المصروفات',
    sql: `SELECT reference, expense_date::text, description, category, status,
                 amount_minor::text, tax_minor::text, currency, paid_at::text
          FROM expenses WHERE organization_id = $1 ORDER BY expense_date DESC`,
  },
};

function csvCell(value: Cell): string {
  const scalar = value == null ? '' : String(value);
  return `"${scalar.replaceAll('"', '""')}"`;
}

export function renderCsv(data: ReportData): Uint8Array {
  const lines = [data.columns, ...data.rows].map((row) => row.map(csvCell).join(','));
  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

function xml(value: Cell): string {
  return (value == null ? '' : String(value)).replace(/[<>&"']/g, (character) => {
    const map: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return map[character]!;
  });
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Array<{ name: string; body: Uint8Array }>): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const body = Buffer.from(file.body);
    const checksum = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

export function renderXlsx(data: ReportData): Uint8Array {
  const rows = [data.columns, ...data.rows]
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<c r="${String.fromCharCode(65 + (columnIndex % 26))}${rowIndex + 1}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ''}><is><t>${xml(value)}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('');
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="BHD R" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font/><font><b/><color rgb="FFFFFFFF"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF07543E"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="1" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
  };
  return zip(
    Object.entries(files).map(([name, body]) => ({ name, body: Buffer.from(body, 'utf8') })),
  );
}

function toHtml(data: ReportData): string {
  const header = data.columns.map((column) => `<th>${xml(column)}</th>`).join('');
  const rows = data.rows
    .map((row) => `<tr>${row.map((value) => `<td>${xml(value)}</td>`).join('')}</tr>`)
    .join('');
  return `<article dir="rtl"><h1>${xml(data.title)}</h1><p>BHD R · ${xml(new Date().toISOString())}</p><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></article>`;
}

async function asWorker<T>(pool: Pool, task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.worker = 'true'");
    const result = await task(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createReportProcessor(
  pool: Pool,
  storage: StorageAdapter,
  processPdf: (job: PdfJob) => Promise<{ key: string }>,
) {
  return async (event: DomainEventJob) => {
    if (event.topic !== 'report.requested') return { ignored: true, topic: event.topic };
    const report = await asWorker(pool, async (client) => {
      const result = await client.query<ReportJobRow>(
        `UPDATE report_jobs SET status = 'running', updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND status IN ('queued','failed') RETURNING *`,
        [event.aggregateId, event.organizationId],
      );
      return result.rows[0];
    });
    if (!report) throw new PermanentJobError('REPORT_NOT_FOUND', 'Report job was not found');
    const definition = reportQueries[report.type];
    if (!definition)
      throw new PermanentJobError('REPORT_TYPE_UNSUPPORTED', `Unsupported report: ${report.type}`);
    const format = report.format as ReportFormat;
    if (!['csv', 'xlsx', 'pdf'].includes(format))
      throw new PermanentJobError('REPORT_FORMAT_UNSUPPORTED', `Unsupported format: ${format}`);
    try {
      const result = await asWorker(pool, (client) =>
        client.query<QueryResultRow>(definition.sql, [event.organizationId]),
      );
      const columns = result.fields.map((field) => field.name);
      const data: ReportData = {
        title: definition.title,
        columns,
        rows: result.rows.map((row) => columns.map((column) => row[column] as Cell)),
      };
      const objectKey = `reports/${event.organizationId}/${report.id}.${format}`;
      if (format === 'pdf') {
        await processPdf({
          documentId: report.id,
          documentType: 'report',
          html: toHtml(data),
          outputKey: objectKey,
          locale: 'ar',
          correlationId: event.eventId,
          organizationId: event.organizationId,
        });
      } else {
        const bytes = format === 'xlsx' ? renderXlsx(data) : renderCsv(data);
        const contentType =
          format === 'xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv; charset=utf-8';
        await storage.putPrivate(objectKey, bytes, contentType, {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          reportId: report.id,
        });
      }
      await asWorker(pool, (client) =>
        client.query(
          `UPDATE report_jobs SET status = 'completed', object_key = $2,
             expires_at = now() + interval '7 days', updated_at = now() WHERE id = $1`,
          [report.id, objectKey],
        ),
      );
      return { reportId: report.id, objectKey, rows: data.rows.length };
    } catch (error) {
      await asWorker(pool, (client) =>
        client.query(`UPDATE report_jobs SET status = 'failed', updated_at = now() WHERE id = $1`, [
          report.id,
        ]),
      );
      throw error;
    }
  };
}
