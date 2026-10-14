import { z } from 'zod';
import {
  BADGE_GRANT_MODES,
  BADGE_ICONS,
  BADGE_LEVELS,
  BADGE_METRICS,
  BADGE_SUBJECTS,
  BADGE_TIERS,
  METRIC_KEYS,
  type MetricKey,
} from '@/lib/badges-shared';

const criterionSchema = z
  .object({
    metric: z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]),
    op: z.enum(['gte', 'lte']),
    value: z.number().finite().min(0).max(1_000_000),
  })
  .strict();

const fields = {
  tier: z.enum(BADGE_TIERS),
  level: z.enum(BADGE_LEVELS),
  nameAr: z.string().trim().min(2).max(80),
  nameEn: z.string().trim().min(2).max(80),
  descriptionAr: z.string().trim().max(400).nullable(),
  descriptionEn: z.string().trim().max(400).nullable(),
  icon: z.enum(BADGE_ICONS),
  criteria: z.array(criterionSchema).min(1).max(8),
  windowDays: z.number().int().min(7).max(3650),
  sustainDays: z.number().int().min(0).max(3650),
  validityDays: z.number().int().min(1).max(3650).nullable(),
  autoRevoke: z.boolean(),
  grantMode: z.enum(BADGE_GRANT_MODES),
};

export const createDefinitionSchema = z
  .object({ subjectType: z.enum(BADGE_SUBJECTS), ...fields })
  .strict()
  .refine((value) =>
    value.criteria.every((criterion) =>
      (BADGE_METRICS[criterion.metric].subjects as readonly string[]).includes(value.subjectType),
    ),
  );

export const updateDefinitionSchema = z
  .object({
    ...Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, schema.optional()])),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
  })
  .strict() as unknown as z.ZodType<
  Partial<{ [K in keyof typeof fields]: z.infer<(typeof fields)[K]> }> & {
    status?: 'active' | 'inactive' | 'archived';
  }
>;
