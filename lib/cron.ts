import { Cron } from "croner";

/**
 * Returns true if the supplied string parses as a 5-field crontab expression.
 * Throws nothing — pure boolean check.
 */
export function isValidCronExpression(expr: string): boolean {
  if (!expr || typeof expr !== "string") return false;
  const trimmed = expr.trim();
  if (!trimmed) return false;
  try {
    new Cron(trimmed, { mode: "5-part" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if the supplied string is a recognised IANA timezone name.
 */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the next Date a cron expression fires after the supplied reference,
 * evaluated in the given IANA timezone. Returns null if croner cannot find a
 * future match within its horizon.
 *
 * Throws if either the expression or timezone is invalid.
 */
export function nextRunAt(
  expr: string,
  tz: string,
  after: Date = new Date()
): Date | null {
  if (!isValidCronExpression(expr)) {
    throw new Error(`Invalid cron expression: ${expr}`);
  }
  if (!isValidTimeZone(tz)) {
    throw new Error(`Invalid timezone: ${tz}`);
  }
  const cron = new Cron(expr.trim(), { timezone: tz });
  return cron.nextRun(after);
}
