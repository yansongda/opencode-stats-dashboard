/**
 * Query Filter Helpers
 */

/**
 * Parse an optional string filter from a query parameter.
 *
 * Returns `undefined` for empty strings or missing values so callers
 * can use it directly in WHERE clause conditionals.
 */
export function parseOptionalString(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  return raw;
}

/**
 * Build a SQL WHERE clause fragment with parameterized conditions.
 *
 * Returns { clause, params } where `clause` is either empty or starts
 * with " AND". Safe for appending to an existing WHERE 1=1 base.
 *
 * @param conditions - Array of [sqlFragment, value | undefined] pairs.
 *                     Undefined values cause the condition to be skipped.
 */
export function buildWhereConditions(
  conditions: Array<[sql: string, value: string | number | undefined]>,
): { clause: string; params: Array<string | number> } {
  const active: string[] = [];
  const params: Array<string | number> = [];

  for (const [sql, value] of conditions) {
    if (value !== undefined) {
      active.push(sql);
      params.push(value);
    }
  }

  if (active.length === 0) {
    return { clause: "", params: [] };
  }

  return {
    clause: ` AND ${active.join(" AND ")}`,
    params,
  };
}
