import { Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { auditLogs, countryPacks, currencies, organizations } from '@bhd-r/db';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class PlatformService {
  constructor(private readonly database: DatabaseService) {}
  listOrganizations() {
    return this.database.asSystem((transaction) =>
      transaction.select().from(organizations).orderBy(desc(organizations.createdAt)).limit(200),
    );
  }
  listAudit() {
    return this.database.asSystem((transaction) =>
      transaction.select().from(auditLogs).orderBy(desc(auditLogs.occurredAt)).limit(200),
    );
  }
  listCountryPacks() {
    return this.database.asSystem((transaction) => transaction.select().from(countryPacks));
  }
  listCurrencies() {
    return this.database.asSystem((transaction) => transaction.select().from(currencies));
  }
}
