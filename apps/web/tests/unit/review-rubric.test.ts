import { describe, expect, it } from 'vitest';
import {
  GUEST_RUBRIC,
  HOST_RUBRIC,
  blendScore,
  needsComment,
  publicPersonName,
  reviewScoreLabel,
  scoreAnswers,
  validAnswers,
  type ReviewAnswers,
  type ReviewGroup,
} from '@/lib/review-rubric';

function all(rubric: ReviewGroup[], value: number, skipOptional = false): ReviewAnswers {
  return Object.fromEntries(
    rubric.flatMap((group) =>
      group.criteria
        .filter((item) => !(skipOptional && item.optional))
        .map((item) => [item.key, value]),
    ),
  );
}

describe('review rubric', () => {
  it('weights add up to 1 in both rubrics', () => {
    for (const rubric of [GUEST_RUBRIC, HOST_RUBRIC]) {
      expect(rubric.reduce((sum, group) => sum + group.weight, 0)).toBeCloseTo(1);
    }
  });

  it('requires every non-optional criterion and integers 1–5', () => {
    expect(validAnswers('guest_to_host', all(GUEST_RUBRIC, 5, true))).toBe(true);
    const partial = all(GUEST_RUBRIC, 5, true);
    delete partial.clean_rooms;
    expect(validAnswers('guest_to_host', partial)).toBe(false);
    expect(validAnswers('guest_to_host', { ...all(GUEST_RUBRIC, 5), clean_rooms: 6 })).toBe(false);
    expect(validAnswers('guest_to_host', { ...all(GUEST_RUBRIC, 5), unknown: 3 })).toBe(false);
    expect(validAnswers('host_to_guest', all(HOST_RUBRIC, 4))).toBe(true);
  });

  it('maps 1–5 answers onto 10 and splits property and management', () => {
    expect(scoreAnswers('guest_to_host', all(GUEST_RUBRIC, 5)).criteria).toBe(10);
    expect(scoreAnswers('guest_to_host', all(GUEST_RUBRIC, 3)).criteria).toBe(6);
    const mixed: ReviewAnswers = {
      ...all(GUEST_RUBRIC, 5),
      staff: 2,
      communication: 2,
      check_in: 2,
      problem_solving: 2,
    };
    const scores = scoreAnswers('guest_to_host', mixed);
    expect(scores.property).toBe(10);
    expect(scores.host).toBe(4);
    expect(scores.criteria).toBe(8.2);
    const host = scoreAnswers('host_to_guest', all(HOST_RUBRIC, 4));
    expect(host.criteria).toBe(8);
    expect(host.property).toBeNull();
  });

  it('skipped optional criteria do not drag the score down', () => {
    const scores = scoreAnswers('guest_to_host', all(GUEST_RUBRIC, 5, true));
    expect(scores.criteria).toBe(10);
  });

  it('lets the AI reading of the comment move the score by its 20% share', () => {
    expect(blendScore(8, null)).toBe(8);
    expect(blendScore(8, 3)).toBe(7);
    expect(blendScore(9, 99)).toBe(9.2);
  });

  it('asks for a comment when the score is below 6', () => {
    expect(needsComment('host_to_guest', all(HOST_RUBRIC, 2))).toBe(true);
    expect(needsComment('host_to_guest', all(HOST_RUBRIC, 4))).toBe(false);
  });

  it('labels and public names', () => {
    expect(reviewScoreLabel(9.4, true)).toBe('استثنائي');
    expect(reviewScoreLabel(4.2, false)).toBe('Poor');
    expect(publicPersonName('Abdul Hamid Al Rawahi')).toBe('Abdul R.');
    expect(publicPersonName('ABDUL HAMID AL RAWAHI')).toBe('Abdul R.');
    expect(publicPersonName('سالم')).toBe('سالم');
    expect(publicPersonName('  ')).toBeNull();
  });
});
