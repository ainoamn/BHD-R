import 'server-only';
import { aiChatJson, resolveAiEndpoint } from '@/lib/ai-chat';
import {
  criterionLabel,
  groupLabel,
  rubricFor,
  type ReviewAnswers,
  type ReviewDirection,
  type ReviewScores,
  type ReviewText,
} from '@/lib/review-rubric';

export type ReviewAnalysis = {
  engine: 'ai' | 'rules';
  /** The comment's own verdict on 10; null without a comment or without AI. */
  textScore: number | null;
  summary: ReviewText | null;
  highlights: ReviewText[];
  concerns: ReviewText[];
  /** `abusive`, `contradictory`, `personal_data`. */
  flags: string[];
};

export type ProfileAnalysis = {
  engine: 'ai' | 'rules';
  summary: ReviewText | null;
  strengths: ReviewText[];
  watchouts: ReviewText[];
};

const REVIEW_SYSTEM = [
  'You analyse verified short-stay reviews on BHD R, a property platform in the Sultanate of Oman.',
  'A review is either a guest rating the property and its management, or a host rating the guest.',
  'Criteria are answered on 1–5 (5 = excellent). Read the criteria and the free-text comment together.',
  'Be fair and factual; never invent facts that are not in the input.',
  'Arabic output is clear Modern Standard Arabic; English output is plain professional English.',
  'Respond with a single JSON object only.',
].join(' ');

const REVIEW_INSTRUCTION = [
  'Return {"textScore": number|null, "summaryAr": string, "summaryEn": string,',
  '"highlights": [{"ar": string, "en": string}], "concerns": [{"ar": string, "en": string}],',
  '"flags": string[]}.',
  'textScore: 0–10 for how positive the written comment is on its own (null when there is no comment).',
  'summary: one neutral sentence (max 30 words) of what this review says, written for other users.',
  'highlights / concerns: at most 3 short points each (max 8 words), taken from the criteria and comment.',
  'flags: add "abusive" for insults or hate, "contradictory" when the comment clearly contradicts the',
  'criteria, "personal_data" when the comment contains phone numbers, IDs or account numbers.',
].join(' ');

const PROFILE_SYSTEM = [
  'You write the reputation summary of a property, a host (property management) or a guest on BHD R,',
  'a property platform in the Sultanate of Oman, from its verified stay reviews.',
  'Be balanced and factual: mention recurring strengths and recurring problems only, never one-off',
  'details, names or personal data. Arabic is clear Modern Standard Arabic; English is plain English.',
  'Respond with a single JSON object only.',
].join(' ');

const PROFILE_INSTRUCTION = [
  'Return {"summaryAr": string, "summaryEn": string, "strengths": [{"ar": string, "en": string}],',
  '"watchouts": [{"ar": string, "en": string}]}.',
  'summary: two sentences (max 45 words) a future guest or host can rely on.',
  'strengths / watchouts: at most 4 short points each (max 8 words); empty when nothing recurs.',
].join(' ');

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function pairs(value: unknown, limit: number): ReviewText[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const ar = text(row.ar, 120);
      const en = text(row.en, 120);
      return ar && en ? [{ ar, en }] : [];
    })
    .slice(0, limit);
}

/** Highlights and concerns straight from the criteria, when the AI is unavailable. */
function rulesAnalysis(direction: ReviewDirection, answers: ReviewAnswers): ReviewAnalysis {
  const rated = rubricFor(direction).flatMap((group) =>
    group.criteria.flatMap((item) => {
      const value = answers[item.key];
      return value ? [{ key: item.key, value }] : [];
    }),
  );
  const label = (key: string) => ({
    ar: criterionLabel(direction, key, true),
    en: criterionLabel(direction, key, false),
  });
  return {
    engine: 'rules',
    textScore: null,
    summary: null,
    highlights: rated
      .filter((item) => item.value === 5)
      .slice(0, 3)
      .map((item) => label(item.key)),
    concerns: rated
      .filter((item) => item.value <= 2)
      .slice(0, 3)
      .map((item) => label(item.key)),
    flags: [],
  };
}

export async function analyzeReview(
  context: { oidcToken: string | null },
  input: {
    direction: ReviewDirection;
    answers: ReviewAnswers;
    scores: ReviewScores;
    comment: string | null;
    recommend: boolean | null;
  },
): Promise<ReviewAnalysis> {
  const fallback = rulesAnalysis(input.direction, input.answers);
  const endpoint = resolveAiEndpoint(context.oidcToken);
  if (!endpoint) return fallback;
  try {
    const result = await aiChatJson(
      endpoint,
      REVIEW_SYSTEM,
      REVIEW_INSTRUCTION,
      {
        kind:
          input.direction === 'guest_to_host'
            ? 'guest reviews the property and its management'
            : 'host reviews the guest',
        criteria: Object.entries(input.answers).map(([key, value]) => ({
          criterion: criterionLabel(input.direction, key, false),
          score: value,
        })),
        groups: input.scores.groups.map((group) => ({
          group: groupLabel(input.direction, group.key, false),
          scoreOutOf10: group.score,
        })),
        recommend: input.recommend,
        comment: input.comment ?? '',
      },
      'review analysis',
      12_000,
    );
    const raw = typeof result.textScore === 'number' ? result.textScore : null;
    const summaryAr = text(result.summaryAr, 400);
    const summaryEn = text(result.summaryEn, 400);
    const highlights = pairs(result.highlights, 3);
    const concerns = pairs(result.concerns, 3);
    return {
      engine: 'ai',
      textScore:
        input.comment && raw !== null && Number.isFinite(raw)
          ? Math.min(10, Math.max(0, Math.round(raw * 10) / 10))
          : null,
      summary: summaryAr && summaryEn ? { ar: summaryAr, en: summaryEn } : null,
      highlights: highlights.length ? highlights : fallback.highlights,
      concerns: concerns.length ? concerns : fallback.concerns,
      flags: Array.isArray(result.flags)
        ? result.flags
            .filter(
              (flag): flag is string =>
                flag === 'abusive' || flag === 'contradictory' || flag === 'personal_data',
            )
            .slice(0, 3)
        : [],
    };
  } catch {
    return fallback;
  }
}

/** Recurring strengths and problems across a subject's published reviews. */
export async function analyzeProfile(
  context: { oidcToken: string | null },
  input: {
    subject: 'property' | 'host' | 'guest';
    score: number | null;
    groups: Array<{ label: string; score: number | null }>;
    reviews: Array<{
      score: number;
      comment: string | null;
      highlights: ReviewText[];
      concerns: ReviewText[];
    }>;
  },
): Promise<ProfileAnalysis> {
  const count = (items: ReviewText[][]) => {
    const tally = new Map<string, { item: ReviewText; count: number }>();
    for (const item of items.flat()) {
      const entry = tally.get(item.en) ?? { item, count: 0 };
      entry.count += 1;
      tally.set(item.en, entry);
    }
    return [...tally.values()]
      .filter((entry) => entry.count > 1 || input.reviews.length === 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map((entry) => entry.item);
  };
  const fallback: ProfileAnalysis = {
    engine: 'rules',
    summary: null,
    strengths: count(input.reviews.map((review) => review.highlights)),
    watchouts: count(input.reviews.map((review) => review.concerns)),
  };
  const endpoint = resolveAiEndpoint(context.oidcToken);
  if (!endpoint || !input.reviews.length) return fallback;
  try {
    const result = await aiChatJson(
      endpoint,
      PROFILE_SYSTEM,
      PROFILE_INSTRUCTION,
      {
        subject: input.subject,
        averageOutOf10: input.score,
        groups: input.groups,
        reviews: input.reviews.slice(0, 30).map((review) => ({
          score: review.score,
          comment: review.comment?.slice(0, 600) ?? '',
          highlights: review.highlights.map((item) => item.en),
          concerns: review.concerns.map((item) => item.en),
        })),
      },
      'review profile',
      20_000,
    );
    const summaryAr = text(result.summaryAr, 600);
    const summaryEn = text(result.summaryEn, 600);
    return {
      engine: 'ai',
      summary: summaryAr && summaryEn ? { ar: summaryAr, en: summaryEn } : null,
      strengths: pairs(result.strengths, 4),
      watchouts: pairs(result.watchouts, 4),
    };
  } catch {
    return fallback;
  }
}
