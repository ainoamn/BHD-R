import { describe, expect, it } from 'vitest';
import { countryPacks, getCountryPack, validateNationalPhone } from '../src/index.js';

describe('country packs', () => {
  it('covers all Gulf currencies and USD', () => {
    expect(Object.values(countryPacks).map((pack) => pack.defaultCurrency)).toEqual(
      expect.arrayContaining(['OMR', 'AED', 'SAR', 'BHD', 'KWD', 'QAR', 'USD']),
    );
  });

  it('uses three decimal Omani context through contracts and validates phones', () => {
    expect(getCountryPack('OM').defaultCurrency).toBe('OMR');
    expect(validateNationalPhone('OM', '9212 3456')).toBe(true);
    expect(validateNationalPhone('OM', '123')).toBe(false);
  });
});
