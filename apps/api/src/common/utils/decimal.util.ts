import { Prisma } from '@prisma/client';

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

/**
 * Converts a database decimal (or null) to a plain JSON number so API responses
 * keep returning numbers instead of Decimal strings.
 */
export function decimalToNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'number' ? value : Number(value.toString());
}

/** Converts a plain number to a database decimal, keeping null and undefined as they are. */
export function numberToDecimal(value: number | null): Prisma.Decimal | null;
export function numberToDecimal(value: number | null | undefined): Prisma.Decimal | null | undefined;
export function numberToDecimal(value: number | null | undefined): Prisma.Decimal | null | undefined {
  if (value === null || value === undefined) {
    return value;
  }
  return new Prisma.Decimal(value);
}
