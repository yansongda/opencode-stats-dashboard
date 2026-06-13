/**
 * Safe Numeric Helpers
 */

/**
 * Safe division: returns `null` when denominator is zero, null, or undefined.
 * Returns `null` when either operand is not a finite number.
 *
 * Use for dashboard contract fields like `avg_tokens_per_session`,
 * `cost_per_1k_tokens`, `tokens_per_usd`, etc.
 *
 * @param numerator   - The dividend.
 * @param denominator - The divisor.
 * @param precision   - Optional decimal places to round to (default: no rounding).
 */
export function safeDivide(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  precision?: number,
): number | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  const result = numerator / denominator;
  if (precision !== undefined) {
    const factor = 10 ** precision;
    return Math.round(result * factor) / factor;
  }
  return result;
}

/**
 * Safe rate: numerator / denominator clamped to [0, 1], or null.
 *
 * Use for error_rate, success_rate, etc.
 */
export function safeRate(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  const rate = numerator / denominator;
  return Math.max(0, Math.min(1, rate));
}

/**
 * Coalesce a nullable/undefined value to a numeric default (0).
 *
 * Useful when mapping SQL results that may return NULL for SUM/COUNT.
 */
export function toNum(val: unknown, fallback = 0): number {
  if (val == null) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}
