import { Prisma } from '@prisma/client';
import { decimalToNumber, numberToDecimal } from './decimal.util';

describe('decimal helpers', () => {
  it('converts decimals to plain numbers', () => {
    const value = decimalToNumber(new Prisma.Decimal('0.00012345'));
    expect(value).toBe(0.00012345);
    expect(typeof value).toBe('number');
    expect(JSON.stringify({ cost: value })).toBe('{"cost":0.00012345}');
  });

  it('keeps null and undefined as null', () => {
    expect(decimalToNumber(null)).toBeNull();
    expect(decimalToNumber(undefined)).toBeNull();
  });

  it('passes plain numbers through', () => {
    expect(decimalToNumber(1.5)).toBe(1.5);
  });

  it('converts numbers to decimals', () => {
    const value = numberToDecimal(0.000123);
    expect(value).toBeInstanceOf(Prisma.Decimal);
    expect(value?.toString()).toBe('0.000123');
    expect(numberToDecimal(null)).toBeNull();
    expect(numberToDecimal(undefined)).toBeUndefined();
  });
});
