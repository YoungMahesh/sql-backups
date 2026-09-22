import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { generateBackupS3Key, formatBytes } from "@/lib/s3";

describe("S3 Backup Helpers", () => {
  describe("generateBackupS3Key", () => {
    it("generates a structured S3 key with sanitized database name and timestamp", () => {
      const date = new Date("2026-09-05T12:30:00.000Z");
      const key = generateBackupS3Key({
        userId: "user_123",
        databaseName: "my-ecommerce_db",
        timestamp: date,
      });

      assert.equal(
        key,
        "backups/user_123/my-ecommerce_db_2026-09-05T12-30-00-000Z.sql.gz"
      );
    });

    it("sanitizes unsafe characters in database name", () => {
      const date = new Date("2026-09-05T12:00:00.000Z");
      const key = generateBackupS3Key({
        userId: "user/456",
        databaseName: "evil/../db name!*?",
        timestamp: date,
      });

      // Special characters replaced with underscores, avoiding path traversal
      assert.ok(!key.includes(".."));
      assert.ok(!key.includes(" "));
      assert.equal(
        key,
        "backups/user_456/evil____db_name____2026-09-05T12-00-00-000Z.sql.gz"
      );
    });
  });

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
});
