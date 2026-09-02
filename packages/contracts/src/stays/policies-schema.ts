import { z } from 'zod';
import { STAY_POLICY_SECTIONS } from './policies.js';

export const stayPolicySectionTextSchema = z
  .object({
    ar: z.string().max(8000).nullable().optional(),
    en: z.string().max(8000).nullable().optional(),
  })
  .strict();

export const stayPoliciesStructuredSchema = z
  .object({
    general: stayPolicySectionTextSchema.optional(),
    cancellation: stayPolicySectionTextSchema.optional(),
    events: stayPolicySectionTextSchema.optional(),
    payment: stayPolicySectionTextSchema.optional(),
  })
  .strict();

export const stayPoliciesJsonSchema = z.union([
  z.array(z.string().max(500)).max(80),
  stayPoliciesStructuredSchema,
]);

export type StayPoliciesStructuredInput = z.infer<typeof stayPoliciesStructuredSchema>;
export type StayPoliciesJsonInput = z.infer<typeof stayPoliciesJsonSchema>;

export { STAY_POLICY_SECTIONS };
