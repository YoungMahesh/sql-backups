import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  deriveManifestKey,
  formatManifest,
  parseManifest,
  type BackupManifest,
} from "@/lib/manifest";

describe("manifest", () => {
  describe("deriveManifestKey", () => {
    it("derives a manifest key by swapping the dump suffix", () => {
      assert.equal(
        deriveManifestKey("backups/user_1/my_db_2026-09-05T12-30-00-000Z.sql.gz"),
        "backups/user_1/my_db_2026-09-05T12-30-00-000Z.manifest.json"
      );
    });

    it("handles dump keys without a databaseName timestamp suffix by replacing the last segment", () => {
      assert.equal(
        deriveManifestKey("backups/user/db.sql.gz"),
        "backups/user/db.manifest.json"
      );
    });

    it("returns null when the key does not look like a dump key", () => {
      assert.equal(deriveManifestKey("random/prefix/no-suffix"), null);
    });
  });

  describe("formatManifest", () => {
    it("serializes a manifest to pretty JSON bytes", () => {
      const m: BackupManifest = {
        version: 1,
        uncompressedSizeBytes: 1234,
        tables: [
          { name: "users", rowCount: 5 },
          { name: "orders", rowCount: 0 },
        ],
      };
      const bytes = formatManifest(m);
      const text = bytes.toString("utf8");
      assert.match(text, /"version": 1/);
      assert.match(text, /"uncompressedSizeBytes": 1234/);
      assert.match(text, /"name": "users"/);
      assert.match(text, /"rowCount": 5/);
    });

    it("emits an empty tables array rather than omitting the field", () => {
      const m: BackupManifest = { version: 1, uncompressedSizeBytes: 0, tables: [] };
      const text = formatManifest(m).toString("utf8");
      assert.match(text, /"tables": \[\]/);
    });
  });

  describe("parseManifest", () => {
    it("round-trips a manifest through format then parse", () => {
      const original: BackupManifest = {
        version: 1,
        uncompressedSizeBytes: 4096,
        tables: [{ name: "users", rowCount: 12 }],
      };
      const parsed = parseManifest(formatManifest(original));
      assert.deepEqual(parsed, original);
    });

    it("returns null when the JSON is malformed", () => {
      assert.equal(parseManifest(Buffer.from("not json")), null);
    });

    it("returns null when the version is wrong", () => {
      const bytes = Buffer.from(
        JSON.stringify({ version: 99, uncompressedSizeBytes: 0, tables: [] })
      );
      assert.equal(parseManifest(bytes), null);
    });

    it("returns null when tables is not an array", () => {
      const bytes = Buffer.from(
        JSON.stringify({ version: 1, uncompressedSizeBytes: 0, tables: "nope" })
      );
      assert.equal(parseManifest(bytes), null);
    });

    it("returns null when a table entry is missing rowCount", () => {
      const bytes = Buffer.from(
        JSON.stringify({
          version: 1,
          uncompressedSizeBytes: 0,
          tables: [{ name: "users" }],
        })
      );
      assert.equal(parseManifest(bytes), null);
    });

    it("returns null when uncompressedSizeBytes is negative", () => {
      const bytes = Buffer.from(
        JSON.stringify({ version: 1, uncompressedSizeBytes: -1, tables: [] })
      );
      assert.equal(parseManifest(bytes), null);
    });

    it("accepts an empty tables array", () => {
      const m: BackupManifest = { version: 1, uncompressedSizeBytes: 0, tables: [] };
      const parsed = parseManifest(formatManifest(m));
      assert.deepEqual(parsed, m);
    });
  });
});
