import { defineConfig } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { hashPassword } from "./server/auth";
mkdirSync(resolve("../../work/harness"), { recursive: true });
const dataDir =
  process.env.E2E_DATA_DIR || mkdtempSync(resolve("../../work/harness/e2e-"));
export default defineConfig({
  testDir: "./tests/quality-hub/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3107",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3107/api/health",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: "3107",
      DATA_DIR: dataDir,
      OWNER_EMAIL: "qa@example.com",
      OWNER_PASSWORD_HASH: hashPassword("Harness-private-password-123"),
      PUBLIC_ORIGIN: "http://127.0.0.1:3107",
      NODE_ENV: "test",
    },
  },
});
