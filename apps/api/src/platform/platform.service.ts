import { Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { auditLogs, countryPacks, currencies, organizations, outboxEvents, users } from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { randomUUID } from 'node:crypto';
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
  listUsers() {
    return this.database.asSystem(async (transaction) => {
      const rows = await transaction
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          displayName: users.displayName,
          locale: users.locale,
          disabledAt: users.disabledAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(500);
      return rows.map((row) => ({
        ...row,
        status: row.disabledAt ? 'disabled' : 'active',
      }));
    });
  }
  settingsHealth() {
    const configured = (name: string) => Boolean(process.env[name]?.trim());
    return [
      {
        id: 'bhd-identity',
        title: 'BHD Identity OIDC',
        status:
          configured('BHD_IDENTITY_ISSUER') && configured('BHD_IDENTITY_CLIENT_ID')
            ? 'configured'
            : 'incomplete',
      },
      {
        id: 'object-storage',
        title: 'Private object storage',
        status:
          configured('S3_BUCKET_PRIVATE') && configured('S3_ACCESS_KEY')
            ? 'configured'
            : 'incomplete',
      },
      {
        id: 'smtp',
        title: 'Transactional email',
        status: configured('SMTP_HOST') ? 'configured' : 'incomplete',
      },
      {
        id: 'webhooks',
        title: 'Payment webhook signing',
        status: configured('PAYMENT_WEBHOOK_SECRET') ? 'configured' : 'incomplete',
      },
      {
        id: 'telemetry',
        title: 'Telemetry export',
        status:
          configured('OTEL_EXPORTER_OTLP_ENDPOINT') || configured('SENTRY_DSN')
            ? 'configured'
            : 'optional',
      },
      {
        id: 'field-encryption',
        title: 'Field encryption keyring',
        status:
          configured('FIELD_ENCRYPTION_ACTIVE_VERSION') &&
          Object.keys(process.env).some((key) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key))
            ? 'configured'
            : 'incomplete',
      },
    ];
  }
  enqueueEncryptionBackfill(
    claims: SessionClaims,
    input: {
      target:
        | 'users.totp_secret_encrypted'
        | 'parties.national_id_encrypted'
        | 'parties.registration_number_encrypted'
        | 'party_identity_documents.number_encrypted'
        | 'payment_gateway_settings.credentials_encrypted';
      batchSize?: number | undefined;
    },
  ) {
    const aggregateId = randomUUID();
    return this.database.asSystem(async (transaction) => {
      const rows = await transaction
        .insert(outboxEvents)
        .values({
          topic: 'encryption.backfill',
          aggregateType: 'encryption_backfill',
          aggregateId,
          payload: {
            target: input.target,
            afterId: null,
            batchSize: input.batchSize ?? 50,
            continue: true,
            requestedBy: claims.sub,
          },
        })
        .returning({ id: outboxEvents.id });
      return {
        queued: true,
        outboxEventId: rows[0]!.id,
        target: input.target,
      };
    });
  }
  listCountryPacks() {
    return this.database.asSystem((transaction) => transaction.select().from(countryPacks));
  }
  listCurrencies() {
    return this.database.asSystem((transaction) => transaction.select().from(currencies));
  }
}
