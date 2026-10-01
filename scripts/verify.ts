import { spawnSync } from "node:child_process";
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run using npm run verify");
for (const stage of ["build", "test", "test:e2e", "benchmark"]) {
  console.log(`\n[HARNESS] ${stage}`);
  const result = spawnSync(process.execPath, [npm, "run", stage], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    console.error(`[HARNESS] Failed: ${stage}`);
    process.exit(result.status || 1);
  }
}
console.log(
  "\n[HARNESS] Build, API/domain tests, browser workflows, and local benchmark passed.",
);
