import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateScheduleInput } from "@/lib/schedule-validation";
import { SYSTEM_DATABASES } from "@/lib/mysql-backup";

describe("validateScheduleInput", () => {
  const validInput = {
    cronExpression: "0 2 * * *",
    timezone: "UTC",
    databaseName: "production_app",
    retentionCount: 7,
  };

  it("accepts a valid input", () => {
    const result = validateScheduleInput(validInput);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.cronExpression, "0 2 * * *");
      assert.deepEqual(result.value.timezone, "UTC");
      assert.deepEqual(result.value.databaseName, "production_app");
      assert.deepEqual(result.value.retentionCount, 7);
    }
  });

  it("accepts an edge-of-range retention count", () => {
    const result = validateScheduleInput({ ...validInput, retentionCount: 1 });
    assert.equal(result.ok, true);
  });

  it("rejects an invalid cron expression with a specific message", () => {
    const result = validateScheduleInput({ ...validInput, cronExpression: "garbage" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => /cron/i.test(e)));
    }
  });

  it("rejects an invalid timezone with a specific message", () => {
    const result = validateScheduleInput({ ...validInput, timezone: "Not/AZone" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => /timezone/i.test(e)));
    }
  });

  it("rejects an empty database name", () => {
    const result = validateScheduleInput({ ...validInput, databaseName: "" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => /database name/i.test(e)));
    }
  });

  it("rejects a whitespace-only database name", () => {
    const result = validateScheduleInput({ ...validInput, databaseName: "   " });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => /database name/i.test(e)));
    }
  });

  it("rejects a database name longer than 255 characters", () => {
    const result = validateScheduleInput({
      ...validInput,
      databaseName: "a".repeat(256),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((e) => /database name/i.test(e)));
    }
  });

  it("rejects a system database name", () => {
    for (const sysDb of SYSTEM_DATABASES) {
      const result = validateScheduleInput({
        ...validInput,
        databaseName: sysDb,
      });
      assert.equal(result.ok, false, `should reject ${sysDb}`);
    }
  });

  it("rejects a system database name case-insensitively", () => {
    const result = validateScheduleInput({
      ...validInput,
      databaseName: "MYSQL",
    });
    assert.equal(result.ok, false);
  });

  it("rejects a non-positive retention count", () => {
    for (const value of [0, -1, -100]) {
      const result = validateScheduleInput({ ...validInput, retentionCount: value });
      assert.equal(result.ok, false, `should reject retentionCount=${value}`);
    }
  });

  it("rejects a non-integer retention count", () => {
    const result = validateScheduleInput({
      ...validInput,
      retentionCount: 3.5,
    });
    assert.equal(result.ok, false);
  });

  it("rejects a NaN retention count", () => {
    const result = validateScheduleInput({
      ...validInput,
      retentionCount: Number.NaN,
    });
    assert.equal(result.ok, false);
  });

  it("accumulates multiple errors at once", () => {
    const result = validateScheduleInput({
      cronExpression: "garbage",
      timezone: "Not/AZone",
      databaseName: "",
      retentionCount: 0,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.length >= 4);
    }
  });

  it("trims whitespace from database name and cron expression", () => {
    const result = validateScheduleInput({
      ...validInput,
      cronExpression: "  0 2 * * *  ",
      databaseName: "  production_app  ",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.cronExpression, "0 2 * * *");
      assert.equal(result.value.databaseName, "production_app");
    }
  });
});
