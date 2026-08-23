import { describe, expect, it } from 'vitest';
import { messages } from '../src/index.js';

describe('bilingual message catalog', () => {
  it('keeps the same namespaces in Arabic and English', () => {
    expect(Object.keys(messages.ar).sort()).toEqual(Object.keys(messages.en).sort());
  });
  it('keeps the same keys inside every namespace', () => {
    for (const namespace of Object.keys(messages.ar) as Array<keyof typeof messages.ar>)
      expect(Object.keys(messages.ar[namespace]).sort()).toEqual(
        Object.keys(messages.en[namespace]).sort(),
      );
  });
});
