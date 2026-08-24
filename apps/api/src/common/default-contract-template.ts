import { createHash } from 'node:crypto';
import { contractTemplates } from '@bhd-r/db';
import type { DatabaseTransaction } from '../database/database.service.js';

export const omanResidentialLeaseTemplateKey = 'oman-residential-lease';

export const omanResidentialLeaseTemplateHtml = `
<article dir="rtl">
  <header>
    <h1>عقد إيجار عقار سكني / Residential Lease Agreement</h1>
    <p><strong>المرجع / Reference:</strong> {{contract.reference}}</p>
  </header>
  <section>
    <h2>أطراف العقد / Contract parties</h2>
    <p><strong>المالك / Landlord:</strong> {{owner.displayName}}</p>
    <p><strong>المستأجر / Tenant:</strong> {{tenant.displayName}}</p>
  </section>
  <section>
    <h2>العقار والوحدة / Property and unit</h2>
    <p><strong>العقار / Property:</strong> {{property.nameAr}} / {{property.nameEn}}</p>
    <p><strong>الوحدة / Unit:</strong> {{unit.code}} — {{unit.nameAr}} / {{unit.nameEn}}</p>
  </section>
  <section>
    <h2>المدة والقيمة / Term and consideration</h2>
    <p><strong>البداية / Start:</strong> {{startsOn}}</p>
    <p><strong>النهاية / End:</strong> {{endsOn}}</p>
    <p><strong>الإيجار بوحدات العملة الصغرى / Rent in minor units:</strong> {{rent.amountMinor}} {{rent.currency}}</p>
    <p><strong>التأمين بوحدات العملة الصغرى / Deposit in minor units:</strong> {{deposit.amountMinor}} {{deposit.currency}}</p>
    <p><strong>يوم الفوترة / Billing day:</strong> {{billingDay}}</p>
  </section>
  <section>
    <h2>شروط إضافية / Additional terms</h2>
    <div>{{additionalTerms}}</div>
  </section>
  <footer>
    <p>لا تصبح هذه النسخة نافذة حتى يكتمل اعتمادها وتوقيع جميع الأطراف إلكترونياً.</p>
    <p>This version becomes effective only after approval and electronic signature by all parties.</p>
  </footer>
</article>`;

export async function ensureDefaultContractTemplate(
  transaction: DatabaseTransaction,
  organizationId: string,
): Promise<string> {
  const contentHash = createHash('sha256').update(omanResidentialLeaseTemplateHtml).digest('hex');
  const rows = await transaction
    .insert(contractTemplates)
    .values({
      organizationId,
      key: omanResidentialLeaseTemplateKey,
      version: 1,
      language: 'ar',
      html: omanResidentialLeaseTemplateHtml,
      contentHash,
      active: true,
    })
    .onConflictDoNothing()
    .returning({ id: contractTemplates.id });
  if (rows[0]) return rows[0].id;
  const existing = await transaction.query.contractTemplates.findFirst({
    where: (table, operators) =>
      operators.and(
        operators.eq(table.organizationId, organizationId),
        operators.eq(table.key, omanResidentialLeaseTemplateKey),
        operators.eq(table.version, 1),
        operators.eq(table.language, 'ar'),
      ),
  });
  if (!existing) throw new Error('Default contract template could not be provisioned');
  return existing.id;
}
