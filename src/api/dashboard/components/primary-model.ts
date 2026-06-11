/**
 * Primary-model query helpers.
 *
 * A primary model is the model with the highest SUM(total_tokens) for a
 * session or project key.
 */

import type { Database } from "bun:sqlite";
import { toNum } from "../helpers";

export type PrimaryModelKeyColumn = "session_id" | "project_path";

type PrimaryModelKeyValue = string | null;
type PrimaryModelKeyNormalizer = (value: PrimaryModelKeyValue) => string;

function foldOrderedPrimaryModels(
  rows: Array<Record<string, unknown>>,
  keyColumn: PrimaryModelKeyColumn,
): Map<string, string> {
  const primaryMap = new Map<string, string>();

  for (const row of rows) {
    const key = String(row[keyColumn]);
    if (!primaryMap.has(key)) {
      primaryMap.set(key, String(row.model));
    }
  }

  return primaryMap;
}

function foldMaxPrimaryModels(
  rows: Array<Record<string, unknown>>,
  keyColumn: PrimaryModelKeyColumn,
  normalizeKey: PrimaryModelKeyNormalizer,
): Map<string, string> {
  const primaryMap = new Map<string, string>();
  const tokenMap = new Map<string, number>();

  for (const row of rows) {
    const rawKey = row[keyColumn] == null ? null : String(row[keyColumn]);
    const key = normalizeKey(rawKey);
    const modelTokens = toNum(row.model_tokens);
    const existing = tokenMap.get(key) ?? 0;
    if (modelTokens > existing) {
      primaryMap.set(key, String(row.model));
      tokenMap.set(key, modelTokens);
    }
  }

  return primaryMap;
}

export function queryPrimaryModelByKey(
  db: Database,
  keyColumn: PrimaryModelKeyColumn,
  keys: string[],
): Map<string, string> {
  if (keys.length === 0) return new Map();

  const placeholders = keys.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT
         ${keyColumn},
         model,
         SUM(total_tokens) as model_tokens
       FROM messages
       WHERE ${keyColumn} IN (${placeholders}) AND model IS NOT NULL AND model != ''
       GROUP BY ${keyColumn}, model
       ORDER BY ${keyColumn}, model_tokens DESC`,
    )
    .all(...keys) as Array<Record<string, unknown>>;

  return foldOrderedPrimaryModels(rows, keyColumn);
}

export function queryPrimaryModelByProjectWhere(
  db: Database,
  whereClause: string,
  whereParams: Array<string | number>,
  normalizeKey: PrimaryModelKeyNormalizer,
): Map<string, string> {
  const rows = db
    .query(
      `SELECT
         m.project_path,
         m.model,
         SUM(m.total_tokens) as model_tokens
       FROM messages m
       WHERE m.model IS NOT NULL AND m.model != ''${whereClause}
       GROUP BY m.project_path, m.model`,
    )
    .all(...whereParams) as Array<Record<string, unknown>>;

  return foldMaxPrimaryModels(rows, "project_path", normalizeKey);
}

export function queryPrimaryModelForSession(
  db: Database,
  sessionId: string,
): string | null {
  const primaryModels = queryPrimaryModelByKey(db, "session_id", [sessionId]);
  return primaryModels.get(sessionId) ?? null;
}
