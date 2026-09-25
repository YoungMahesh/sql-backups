import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatRelativeTime, formatRowCount } from "./format";

describe("format", () => {
  describe("formatBytes", () => {
    it("formats 0 bytes", () => {
      assert.equal(formatBytes(0), "0 B");
    });

    it("formats bytes, KB, MB, and GB accurately", () => {
      assert.equal(formatBytes(512), "512 B");
      assert.equal(formatBytes(1024), "1.0 KB");
      assert.equal(formatBytes(1536), "1.5 KB");
      assert.equal(formatBytes(1048576), "1.0 MB");
      assert.equal(formatBytes(1073741824), "1.0 GB");
    });
  });

  describe("formatRelativeTime", () => {
    it("returns 'Just now' for timestamps within the last minute", () => {
      const now = new Date();
      const fiveSecondsAgo = new Date(now.getTime() - 5_000);
      assert.equal(formatRelativeTime(fiveSecondsAgo.toISOString()), "Just now");
    });

    it("returns minutes ago for sub-hour deltas", () => {
      const now = new Date();
      const twelveMinutesAgo = new Date(now.getTime() - 12 * 60_000);
      assert.equal(formatRelativeTime(twelveMinutesAgo.toISOString()), "12m ago");
    });

    it("returns days ago for sub-week deltas", () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60_000);
      assert.equal(formatRelativeTime(threeDaysAgo.toISOString()), "3d ago");
    });
  });

  describe("formatRowCount", () => {
    it("formats zero as 'empty'", () => {
      assert.equal(formatRowCount(0), "empty");
    });

    it("formats one as '1 row' (singular)", () => {
      assert.equal(formatRowCount(1), "1 row");
    });

    it("formats small numbers with thousands separators", () => {
      assert.equal(formatRowCount(42), "42 rows");
      assert.equal(formatRowCount(1_234), "1,234 rows");
      assert.equal(formatRowCount(1_000_000), "1,000,000 rows");
    });
  });
});
