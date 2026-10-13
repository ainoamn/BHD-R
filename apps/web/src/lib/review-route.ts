import { z } from 'zod';
import {
  REVIEW_COMMENT_MAX,
  REVIEW_PHOTO_MAX,
  REVIEW_PHOTOS_MAX,
  REVIEW_TAGS_MAX,
} from '@/lib/review-rubric';

/** Review fields shared by the guest and host routes; the rubric itself is checked server-side. */
export const reviewFields = {
  answers: z.record(z.string().max(40), z.number().int().min(1).max(5)),
  comment: z.string().max(REVIEW_COMMENT_MAX).optional(),
  recommend: z.boolean().nullable().optional(),
  tags: z.array(z.string().max(40)).max(REVIEW_TAGS_MAX).optional(),
  photos: z
    .array(
      z
        .string()
        .max(REVIEW_PHOTO_MAX)
        .regex(/^data:image\/(?:png|jpeg|webp);base64,/),
    )
    .max(REVIEW_PHOTOS_MAX)
    .optional(),
};
