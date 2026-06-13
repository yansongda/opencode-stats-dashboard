/**
 * Dashboard query helpers — reusable parsing, validation, and formatting
 * utilities for /api/v1/dashboard/* endpoint handlers.
 *
 * Scope: parameter parsing, pagination clamping, sort/order mapping,
 * safe numeric division, and date-bucket formatting.
 *
 * NOT in scope: SQL queries, schema changes, projection tables, caching.
 *
 * Design doc: §3 (helper surface).
 */

export * from "./numeric";
export * from "./pagination";
export * from "./sort";
export * from "./sql-offset";
export * from "./time-range";
export * from "./timezone";
export * from "./where";
