import { describe, expect, it } from 'vitest';
import { countFields, describeSigningOrder, names } from './labels';

describe('labels', () => {
  it('counts fields in the plural the sentence needs', () => {
    expect(countFields('SIGNATURE', 1)).toBe('1 signature');
    expect(countFields('SIGNATURE', 2)).toBe('2 signatures');
    expect(countFields('INITIALS', 1)).toBe('1 initials');
    expect(countFields('INITIALS', 3)).toBe('3 initials');
    expect(countFields('CHECKBOX', 2)).toBe('2 tick boxes');
  });

  it('joins names the way a sentence would', () => {
    expect(names([])).toBe('');
    expect(names(['Asha'])).toBe('Asha');
    expect(names(['Asha', 'Raj'])).toBe('Asha and Raj');
    expect(names(['Asha', 'Raj', 'Priya'])).toBe('Asha, Raj and Priya');
  });

  it('names the signing order', () => {
    const people = [{ name: 'Raj' }, { name: 'Priya' }];
    expect(describeSigningOrder(false, people)).toBe('Everyone at once');
    expect(describeSigningOrder(true, people.slice(0, 1))).toBe('One after another');
    expect(describeSigningOrder(true, people)).toBe('One after another: Raj, then Priya');
  });
});
