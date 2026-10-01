import { defineConfig } from "@playwright/test";

const target =
  process.env.LOKASI_BASE_URL || "https://dev.lokasi.com/intelligence";
if (!target.startsWith("https://")) {
  throw new Error("LOKASI_BASE_URL must use HTTPS");
}

export default defineConfig({
  testDir: "./tests/targets/lokasi",
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
