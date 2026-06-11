import { appendFileSync } from "node:fs";

export type Logger = (
  level: "info" | "error",
  msg: string,
  err?: unknown,
) => void;

/** 将 Date 格式化为本地时间戳：YYYY-MM-DD HH:mm:ss.SSS */
function formatLocalTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

export function createLogger(logFile: string): Logger {
  return (level, msg, err) => {
    const detail =
      err === undefined
        ? msg
        : err instanceof Error
          ? `${msg} — ${err.name}: ${err.message}`
          : `${msg} — ${String(err)}`;

    try {
      appendFileSync(
        logFile,
        `[${formatLocalTimestamp(new Date())}] [${level}] ${detail}\n`,
      );
    } catch {
      // File logging is best-effort and must not break plugin lifecycle.
    }
  };
}
