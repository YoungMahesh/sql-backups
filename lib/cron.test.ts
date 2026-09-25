import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidCronExpression, nextRunAt, isValidTimeZone } from "./cron";

describe("cron helpers", () => {
  describe("isValidCronExpression", () => {
    it("accepts a standard 5-field daily-at-2am expression", () => {
      assert.equal(isValidCronExpression("0 2 * * *"), true);
    });

    it("accepts an every-15-minutes expression", () => {
      assert.equal(isValidCronExpression("*/15 * * * *"), true);
    });

    it("accepts a Sunday-midnight weekly expression", () => {
      assert.equal(isValidCronExpression("0 0 * * 0"), true);
    });

    it("accepts comma-separated values and ranges", () => {
      assert.equal(isValidCronExpression("0 9-17 * * 1-5"), true);
    });

    it("rejects an empty string", () => {
      assert.equal(isValidCronExpression(""), false);
    });

    it("rejects a 6-field expression with seconds", () => {
      assert.equal(isValidCronExpression("0 0 2 * * *"), false);
    });

    it("rejects an out-of-range hour", () => {
      assert.equal(isValidCronExpression("0 25 * * *"), false);
    });

    it("rejects garbage text", () => {
      assert.equal(isValidCronExpression("not a cron"), false);
    });
  });

  describe("isValidTimeZone", () => {
    it("accepts UTC", () => {
      assert.equal(isValidTimeZone("UTC"), true);
    });

    it("accepts IANA zone names", () => {
      assert.equal(isValidTimeZone("America/New_York"), true);
      assert.equal(isValidTimeZone("Asia/Kolkata"), true);
      assert.equal(isValidTimeZone("Europe/Paris"), true);
    });

    it("rejects an empty string", () => {
      assert.equal(isValidTimeZone(""), false);
    });

    it("rejects a zone name that Intl does not know", () => {
      assert.equal(isValidTimeZone("Not/ARealZone"), false);
    });

    it("rejects a random string that is not a zone", () => {
      assert.equal(isValidTimeZone("hello world"), false);
    });
  });

  describe("nextRunAt", () => {
    it("returns the next 02:00 in America/New_York after a midnight UTC reference", () => {
      // 2026-09-06 00:00 UTC = 2026-09-05 20:00 EDT (still the 5th in NY)
      // Next 02:00 NY after that is 2026-09-06 02:00 EDT = 06:00 UTC
      const after = new Date("2026-09-06T00:00:00.000Z");
      const result = nextRunAt("0 2 * * *", "America/New_York", after);
      assert.ok(result, "expected a next-run date");
      assert.equal(result.toISOString(), "2026-09-06T06:00:00.000Z");
    });

    it("returns the next 02:00 in Asia/Kolkata after a midnight UTC reference", () => {
      // 2026-09-06 00:00 UTC = 2026-09-06 05:30 IST (already past 02:00 IST)
      // Next 02:00 IST is 2026-09-07 02:00 IST = 2026-09-06 20:30 UTC
      const after = new Date("2026-09-06T00:00:00.000Z");
      const result = nextRunAt("0 2 * * *", "Asia/Kolkata", after);
      assert.ok(result, "expected a next-run date");
      assert.equal(result.toISOString(), "2026-09-06T20:30:00.000Z");
    });

    it("returns the next quarter-hour after the reference in UTC", () => {
      // 2026-09-06 12:07 UTC, */15 → 12:15 UTC
      const after = new Date("2026-09-06T12:07:00.000Z");
      const result = nextRunAt("*/15 * * * *", "UTC", after);
      assert.ok(result, "expected a next-run date");
      assert.equal(result.toISOString(), "2026-09-06T12:15:00.000Z");
    });

    it("skips Saturday to the next Monday for a weekday-9am schedule", () => {
      // 2026-09-05 is a Saturday
      // 0 9 * * 1-5 → next is Monday 2026-09-07 09:00 UTC
      const after = new Date("2026-09-05T12:00:00.000Z");
      const result = nextRunAt("0 9 * * 1-5", "UTC", after);
      assert.ok(result, "expected a next-run date");
      assert.equal(result.toISOString(), "2026-09-07T09:00:00.000Z");
    });

    it("returns a date strictly after the reference when now is used", () => {
      const result = nextRunAt("0 2 * * *", "UTC");
      assert.ok(result, "expected a next-run date");
      assert.ok(result.getTime() > Date.now() - 1000);
    });

    it("throws when the expression is invalid", () => {
      assert.throws(
        () => nextRunAt("garbage", "UTC", new Date()),
        /invalid cron expression/i
      );
    });

    it("throws when the timezone is invalid", () => {
      assert.throws(
        () => nextRunAt("0 2 * * *", "Not/AZone", new Date()),
        /invalid timezone/i
      );
    });
  });
});
