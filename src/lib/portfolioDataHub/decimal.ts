import Decimal from 'decimal.js';
import type { ExactDecimal } from './schemas';

export { Decimal };

/** Converts only already-validated Hub decimal strings; never accepts numbers. */
export function decimalFrom(value: ExactDecimal): Decimal {
  return new Decimal(value);
}

/** Keeps Hub's null-as-unknown semantics distinct from numeric zero. */
export function decimalOrNull(value: ExactDecimal | null): Decimal | null {
  return value === null ? null : decimalFrom(value);
}

/** Use only when an exact string is needed after a deliberate Decimal calculation. */
export function decimalToExactString(value: Decimal): ExactDecimal {
  return value.toString() as ExactDecimal;
}
