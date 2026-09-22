import { test } from "vitest";
import assert from "node:assert/strict";
import {
  encrypt,
  decrypt,
  maskConnectionString,
  serializeToConnectionString,
  parseConnectionString,
} from "@/lib/crypto";

test("encrypt and decrypt roundtrip", () => {
  const original = "mysql://admin:supersecret@db.example.com:3306/production";
  const encrypted = encrypt(original);
  assert.notEqual(encrypted, original);
  assert.match(encrypted, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

  const decrypted = decrypt(encrypted);
  assert.equal(decrypted, original);
});

test("decrypt handles invalid string gracefully", () => {
  assert.throws(() => decrypt("invalid:format"), /Invalid ciphertext format/);
});

test("maskConnectionString masks password in URI", () => {
  const uriWithPass = "mysql://root:mypassword123@localhost:3306/mydb";
  const masked = maskConnectionString(uriWithPass);
  assert.equal(masked, "mysql://root:••••@localhost:3306/mydb");

  const uriNoPass = "mysql://root@localhost:3306";
  const maskedNoPass = maskConnectionString(uriNoPass);
  assert.equal(maskedNoPass, "mysql://root@localhost:3306");
});

test("serializeToConnectionString creates valid URI", () => {
  const uri = serializeToConnectionString({
    host: "127.0.0.1",
    port: 3306,
    user: "my user",
    password: "p@ssword:with@special",
  });
  assert.equal(
    uri,
    "mysql://my%20user:p%40ssword%3Awith%40special@127.0.0.1:3306"
  );
});

test("parseConnectionString extracts fields properly", () => {
  const parsed = parseConnectionString(
    "mysql://admin:secret123@db.internal:3307/analytics"
  );
  assert.equal(parsed.host, "db.internal");
  assert.equal(parsed.port, 3307);
  assert.equal(parsed.user, "admin");
  assert.equal(parsed.password, "secret123");
  assert.equal(parsed.database, "analytics");
});
