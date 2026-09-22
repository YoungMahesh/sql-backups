import { defineConfig, defineProject } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    projects: [
      defineProject({
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          env: {
            S3_ENDPOINT: "http://localhost:8333",
            S3_ACCESS_KEY_ID: "test-access-key",
            S3_SECRET_ACCESS_KEY: "test-secret-key",
            S3_BUCKET_NAME: "test-bucket",
            S3_REGION: "us-east-1",
          },
        },
      }),
      defineProject({
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude: [
            "tests/integration/setup.ts",
            "tests/integration/global-setup.ts",
            "tests/integration/db-admin.ts",
          ],
          environment: "node",
          pool: "forks",
          globalSetup: ["./tests/integration/global-setup.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
        },
      }),
    ],
  },
});
