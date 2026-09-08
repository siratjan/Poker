/**
 * Money helpers. Every amount in this project is an integer number of cents;
 * floats never appear in a calculation path.
 */

/**
 * Formats integer cents in German notation, e.g. `123450` -> `"1.234,50 €"`.
 * Negative amounts keep the sign: `-1234` -> `"-12,34 €"`.
 *
 * Throws on `NaN`, `Infinity` and non-integer input. Such a value is always a
 * programming error, never a user error, and rendering it as `"0,00 €"` would
 * hide broken money behind a plausible looking amount.
 */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatCents expects integer cents, received: ${cents}`);
  }

  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const fraction = abs % 100;
  const groupedEuros = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${sign}${groupedEuros},${String(fraction).padStart(2, '0')} €`;
}

/**
 * Parses a user-typed euro amount into integer cents.
 *
 * Accepted: `"100"`, `"100,5"`, `"100.50"`, `"1.000,00"`, `"1,000.50"`,
 * `"1.234.567,89"`, surrounding whitespace.
 * Rejected (`null`): empty input, non-numeric text, signs, more than two
 * decimal places, malformed thousands grouping, amounts outside the safe
 * integer range.
 *
 * Separator rules: if both `.` and `,` occur, the last one is the decimal
 * separator. A single separator type occurring more than once is a thousands
 * separator. A single `.` followed by exactly three digits is read as a
 * thousands separator (`"1.000"` -> 100000); every other single separator is
 * the decimal separator.
 */
export function parseEuroInput(input: string): number | null {
  const value = input.trim();
  if (!/^\d+(?:[.,]\d+)*$/.test(value)) return null;

  const dots = (value.match(/\./g) ?? []).length;
  const commas = (value.match(/,/g) ?? []).length;

  const decimalSeparator = pickDecimalSeparator(value, dots, commas);

  let integerPart = value;
  let fractionPart = '';
  if (decimalSeparator !== null) {
    const index = value.lastIndexOf(decimalSeparator);
    integerPart = value.slice(0, index);
    fractionPart = value.slice(index + 1);
  }

  if (fractionPart.length > 2) return null;

  const digits = stripThousandsSeparators(integerPart);
  if (digits === null) return null;

  const euros = Number(digits);
  const fraction = Number(fractionPart.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(euros)) return null;

  const cents = euros * 100 + fraction;
  if (!Number.isSafeInteger(cents)) return null;

  return cents;
}

function pickDecimalSeparator(
  value: string,
  dots: number,
  commas: number,
): '.' | ',' | null {
  if (dots > 0 && commas > 0) {
    return value.lastIndexOf('.') > value.lastIndexOf(',') ? '.' : ',';
  }
  if (dots + commas === 0) return null;

  const separator: '.' | ',' = dots > 0 ? '.' : ',';
  if (dots + commas > 1) return null; // repeated separator = thousands grouping

  const right = value.slice(value.indexOf(separator) + 1);
  if (separator === '.' && right.length === 3) return null; // "1.000"

  return separator;
}

/**
 * Removes thousands separators and validates the grouping.
 * Returns the plain digits, or `null` if the grouping is malformed.
 */
function stripThousandsSeparators(integerPart: string): string | null {
  if (integerPart === '') return null;
  if (!/[.,]/.test(integerPart)) return integerPart;

  const separators = new Set(integerPart.match(/[.,]/g));
  if (separators.size !== 1) return null;

  const groups = integerPart.split(/[.,]/);
  if (!/^\d{1,3}$/.test(groups[0])) return null;
  if (!groups.slice(1).every((group) => /^\d{3}$/.test(group))) return null;

  return groups.join('');
}
