import { describe, expect, it } from 'vitest';
import {
  hasNoteTranslation,
  joinNoteTranslation,
  noteLanguage,
  noteOriginal,
  otherLanguage,
} from '@/lib/note-translation';

describe('note translation helpers', () => {
  it('detects the dominant language', () => {
    expect(noteLanguage('خُصم 10 ر.ع. لتنظيف إضافي')).toBe('ar');
    expect(noteLanguage('10 OMR deducted for extra cleaning')).toBe('en');
    expect(noteLanguage('تم استلام الوحدة A-101 بحالة جيدة')).toBe('ar');
    expect(otherLanguage('ar')).toBe('en');
  });

  it('appends a marked translation and recovers the original', () => {
    const original = 'خُصم 10 ر.ع. لتنظيف إضافي\nوكسر في الباب';
    const joined = joinNoteTranslation(original, '10 OMR deducted for extra cleaning', 'en');
    expect(joined).toBe(
      'خُصم 10 ر.ع. لتنظيف إضافي\nوكسر في الباب\n— English —\n10 OMR deducted for extra cleaning',
    );
    expect(hasNoteTranslation(joined)).toBe(true);
    expect(noteOriginal(joined)).toBe(original);
  });

  it('re-translating replaces the previous translation instead of stacking', () => {
    const first = joinNoteTranslation(
      'Broken lamp in the bedroom',
      'مصباح مكسور في غرفة النوم',
      'ar',
    );
    const second = joinNoteTranslation(noteOriginal(first), 'مصباح غرفة النوم مكسور', 'ar');
    expect(second.match(/— العربية —/g)).toHaveLength(1);
    expect(noteOriginal(second)).toBe('Broken lamp in the bedroom');
  });

  it('leaves notes without a marker untouched', () => {
    expect(hasNoteTranslation('Guest left early — keys returned')).toBe(false);
    expect(noteOriginal('  Guest left early — keys returned  ')).toBe(
      'Guest left early — keys returned',
    );
  });
});
