import { z } from 'zod';
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_RECURRENCES,
  ADJUSTMENT_SCOPES,
  CONTRACT_USES,
  DEPOSIT_METHODS,
  MAX_SCHEDULE_ROWS,
  PAYMENT_FREQUENCIES,
  PAYMENT_METHODS,
  VAT_MODES,
} from '@/lib/lease-terms';

const uuid = z.string().uuid();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const short = (max: number) => z.string().max(max).optional();
const money = z.string().max(24);

/** Tenant block of the manual lease form. */
export const leaseTenantSchema = z
  .object({
    partyId: uuid.optional(),
    entityType: z.enum(['person', 'company']),
    nameAr: z.string().trim().min(2).max(200),
    nameEn: short(200),
    civilId: short(40),
    passport: short(40),
    nationality: short(80),
    crNumber: short(40),
    crExpiry: isoDateSchema.optional().or(z.literal('').transform(() => undefined)),
    signatoryName: short(200),
    signatoryCivilId: short(40),
    signatoryNationality: short(80),
    phone: short(40),
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .strict();

/** Full lease terms draft; amounts are recomputed on the server from these strings. */
export const leaseTermsSchema = z
  .object({
    contractType: z.enum(CONTRACT_USES),
    usageType: z.enum(CONTRACT_USES),
    municipalFormNo: short(80),
    municipalContractNo: short(80),
    rentCalcMode: z.enum(['full', 'per_meter']),
    monthlyRent: money,
    rentAreaSqm: short(16),
    rentPerSqm: short(24),
    handoverOn: short(10),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    paymentDay: z.string().max(4),
    paymentMethod: z.enum(PAYMENT_METHODS),
    paymentFrequency: z.enum(PAYMENT_FREQUENCIES),
    vatEnabled: z.boolean(),
    vatRate: z.string().max(8),
    vatMode: z.enum(VAT_MODES),
    vatChequeCount: z.string().max(4),
    municipalityFeeEnabled: z.boolean(),
    registrationFee: money,
    otherTaxName: short(80),
    otherTaxRate: short(8),
    graceAsDiscount: z.boolean(),
    deposit: money,
    depositItems: z
      .array(
        z
          .object({
            method: z.enum(DEPOSIT_METHODS),
            amount: money,
            reference: short(80),
            bankName: short(160),
            dueOn: short(10),
          })
          .strict(),
      )
      .max(20),
    chequeBankName: short(160),
    chequeAccountName: short(160),
    rentBankAccountId: short(64),
    schedule: z
      .array(
        z
          .object({
            dueOn: isoDateSchema,
            rent: money,
            chequeNumber: short(80),
            bankName: short(160),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SCHEDULE_ROWS),
    vatChequeNumbers: z.array(z.string().max(80)).max(24),
    adjustments: z
      .array(
        z
          .object({
            kind: z.enum(ADJUSTMENT_KINDS),
            title: z.string().max(120),
            amount: money,
            recurrence: z.enum(ADJUSTMENT_RECURRENCES),
            scope: z.enum(ADJUSTMENT_SCOPES),
            months: short(4),
          })
          .strict(),
      )
      .max(50),
    electricityReading: short(40),
    waterReading: short(40),
    notes: short(2000),
  })
  .strict();
