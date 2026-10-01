import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

const testDir = defineBddConfig({
  features: "tests/targets/lokasi/**/*.feature",
  steps: "tests/targets/lokasi/**/*.steps.ts",
  outputDir: "tests/targets/lokasi/.features-gen",
});

const target =
  process.env.LOKASI_BASE_URL || "https://dev.lokasi.com/intelligence";
const browserName = process.env.QA_BROWSER || "chromium";
if (!["chromium", "firefox", "webkit"].includes(browserName)) {
  throw new Error("QA_BROWSER must be chromium, firefox, or webkit");
}
if (!target.startsWith("https://")) {
  throw new Error("LOKASI_BASE_URL must use HTTPS");
}

export default defineConfig({
  testDir,
  projects: [
    {
      name: browserName,
      use: { browserName: browserName as "chromium" | "firefox" | "webkit" },
    },
  ],
  outputDir: "lokasi-results/artifacts",
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "lokasi-results/results.json" }]],
  use: {
    baseURL: target,
    viewport: { width: 1365, height: 768 },
    screenshot: "on",
  },
});
