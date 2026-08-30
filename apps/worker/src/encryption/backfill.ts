import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  emptyBackfillMetrics,
  tryRotateEncryptedField,
  type EncryptionBackfillMetrics,
  type Keyring,
} from '@bhd-r/security';
import { z } from 'zod';
import { logger } from '../logger.js';

export const encryptionBackfillPayloadSchema = z.object({
  target: z.enum([
    'users.totp_secret_encrypted',
    'parties.national_id_encrypted',
    'parties.registration_number_encrypted',
    'party_identity_documents.number_encrypted',
    'payment_gateway_settings.credentials_encrypted',
  ]),
  afterId: z.string().uuid().nullable().default(null),
  batchSize: z.number().int().min(1).max(200).default(50),
  continue: z.boolean().default(true),
});

export type EncryptionBackfillPayload = z.infer<typeof encryptionBackfillPayloadSchema>;

interface TargetRow {
  id: string;
  organization_id: string | null;
  ciphertext: string;
  provider: string | null;
}

interface TargetConfig {
  table: string;
  column: string;
  purpose: string;
  selectExtra: string;
  context: (row: TargetRow) => string;
}

const TARGETS: Record<EncryptionBackfillPayload['target'], TargetConfig> = {
  'users.totp_secret_encrypted': {
    table: 'users',
    column: 'totp_secret_encrypted',
    purpose: 'totp',
    selectExtra: 'NULL::uuid AS organization_id, NULL::text AS provider',
    context: (row) => `totp:${row.id}`,
  },
  'parties.national_id_encrypted': {
    table: 'parties',
    column: 'national_id_encrypted',
    purpose: 'party-identity',
    selectExtra: 'organization_id, NULL::text AS provider',
    context: (row) => `party:${row.organization_id}:${row.id}:national_id`,
  },
  'parties.registration_number_encrypted': {
    table: 'parties',
    column: 'registration_number_encrypted',
    purpose: 'party-identity',
    selectExtra: 'organization_id, NULL::text AS provider',
    context: (row) => `party:${row.organization_id}:${row.id}:registration_number`,
  },
  'party_identity_documents.number_encrypted': {
    table: 'party_identity_documents',
    column: 'number_encrypted',
    purpose: 'party-document',
    selectExtra: 'organization_id, NULL::text AS provider',
    context: (row) => `party-document:${row.organization_id}:${row.id}`,
  },
  'payment_gateway_settings.credentials_encrypted': {
    table: 'payment_gateway_settings',
    column: 'credentials_encrypted',
    purpose: 'payment-gateway',
    selectExtra: 'organization_id, provider',
    context: (row) => `gateway:${row.organization_id}:${row.provider}`,
  },
};

export type EncryptionBackfillFailure = {
  target: EncryptionBackfillPayload['target'];
  rowId: string;
  reason: string;
  ciphertextHash: string;
};

export interface EncryptionBackfillResult {
  target: EncryptionBackfillPayload['target'];
  metrics: EncryptionBackfillMetrics;
  nextAfterId: string | null;
  /** True only when the table is exhausted AND no decrypt/rotate failures occurred (P1-06). */
  done: boolean;
  failures: EncryptionBackfillFailure[];
}

export function createEncryptionBackfillProcessor(
  pool: Pool,
  keyringFor: (purpose: string) => Keyring,
) {
  return async function processEncryptionBackfill(
    payload: EncryptionBackfillPayload,
  ): Promise<EncryptionBackfillResult> {
    const input = encryptionBackfillPayloadSchema.parse(payload);
    const target = TARGETS[input.target];
    const keyring = keyringFor(target.purpose);
    const metrics = emptyBackfillMetrics();
    const failures: EncryptionBackfillFailure[] = [];
    const client = await pool.connect();
    let nextAfterId: string | null = input.afterId;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.worker = 'true'");
      const rows = await client.query<TargetRow>(
        `SELECT id, ${target.selectExtra}, ${target.column} AS ciphertext
         FROM ${target.table}
         WHERE ${target.column} IS NOT NULL
           AND ($1::uuid IS NULL OR id > $1::uuid)
         ORDER BY id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [input.afterId, input.batchSize],
      );
      for (const row of rows.rows) {
        const rotated = tryRotateEncryptedField(
          row.ciphertext,
          keyring,
          target.context(row),
          metrics,
        );
        if (rotated.failed) {
          failures.push({
            target: input.target,
            rowId: row.id,
            reason: rotated.reason ?? 'rotate_failed',
            ciphertextHash: createHash('sha256').update(row.ciphertext).digest('hex'),
          });
        } else if (rotated.changed) {
          await client.query(
            `UPDATE ${target.table}
             SET ${target.column} = $2, updated_at = now()
             WHERE id = $1`,
            [row.id, rotated.value],
          );
        }
        nextAfterId = row.id;
      }
      await client.query('COMMIT');
      const batchExhausted = rows.rows.length < input.batchSize;
      // P1-06: never declare done when any row failed to decrypt/rotate.
      const done = batchExhausted && failures.length === 0;
      if (failures.length > 0) {
        logger.error(
          {
            target: input.target,
            metrics,
            failures,
          },
          'Encryption backfill batch incomplete — fail-closed',
        );
      } else {
        logger.info(
          {
            target: input.target,
            activeVersion: keyring.activeVersion,
            metrics,
            nextAfterId,
            done,
          },
          'Encryption backfill batch completed',
        );
      }
      return {
        target: input.target,
        metrics,
        // Stop auto-continue when failures exist so cursor does not skip quarantine rows.
        nextAfterId: failures.length > 0 || done ? null : nextAfterId,
        done,
        failures,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}
