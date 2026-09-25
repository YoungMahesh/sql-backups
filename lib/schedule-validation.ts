import { isValidCronExpression, isValidTimeZone } from "./cron";
import { SYSTEM_DATABASES } from "./mysql-backup";

export interface ScheduleInput {
  cronExpression: string;
  timezone: string;
  databaseName: string;
  retentionCount: number;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const MAX_DATABASE_NAME_LENGTH = 255;

/**
 * Pure validator for Scheduled Backup inputs. Does not touch the database or the network —
 * callers handle ownership checks, DB-exists-on-target checks, and uniqueness checks.
 *
 * Returns the trimmed/normalized values on success, or an array of human-readable errors.
 */
export function validateScheduleInput(
  input: ScheduleInput
): ValidationResult<ScheduleInput> {
  const errors: string[] = [];

  const cronExpression = (input.cronExpression ?? "").trim();
  if (!cronExpression) {
    errors.push("Cron expression is required.");
  } else if (!isValidCronExpression(cronExpression)) {
    errors.push(
      `Cron expression "${cronExpression}" is not a valid 5-field crontab.`
    );
  }

  const timezone = (input.timezone ?? "").trim();
  if (!timezone) {
    errors.push("Timezone is required.");
  } else if (!isValidTimeZone(timezone)) {
    errors.push(`Timezone "${timezone}" is not a valid IANA zone name.`);
  }

  const databaseName = (input.databaseName ?? "").trim();
  if (!databaseName) {
    errors.push("Database name is required.");
  } else if (databaseName.length > MAX_DATABASE_NAME_LENGTH) {
    errors.push(
      `Database name must be at most ${MAX_DATABASE_NAME_LENGTH} characters.`
    );
  } else if (SYSTEM_DATABASES.has(databaseName.toLowerCase())) {
    errors.push(
      `Cannot schedule backups of system database "${databaseName}".`
    );
  }

  const retentionCount = input.retentionCount;
  if (
    typeof retentionCount !== "number" ||
    !Number.isFinite(retentionCount) ||
    !Number.isInteger(retentionCount) ||
    retentionCount < 1
  ) {
    errors.push("Retention count must be a positive integer.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      cronExpression,
      timezone,
      databaseName,
      retentionCount,
    },
  };
}
