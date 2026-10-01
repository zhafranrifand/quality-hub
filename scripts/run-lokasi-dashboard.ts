import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseGherkinManifest,
  type GherkinManifestEntry,
} from "./gherkin-manifest.js";

type CreatedRun = { id: string; error?: string };

const root = process.cwd();
if (existsSync(resolve(root, ".env")))
  process.loadEnvFile(resolve(root, ".env"));
const reportPath = resolve(root, "lokasi-results/results.json");
const dashboardUrl = process.env.QA_DASHBOARD_URL?.replace(/\/$/, "");
const planId = process.env.QA_PLAN_ID?.trim();
const editToken = process.env.QA_EDIT_TOKEN?.trim();
const syncToken = editToken || process.env.QA_SYNC_TOKEN?.trim();
const runnerToken = editToken || process.env.QA_RUNNER_TOKEN?.trim();
const existingRunId = process.env.QA_RUN_ID?.trim();
const browser = process.env.QA_BROWSER?.trim() || "chromium";
const build =
  process.env.QA_BUILD_ID?.trim() ||
  `local-${new Date().toISOString().slice(0, 10)}`;

function npm(args: string[], env = process.env) {
  const npmPath = process.env.npm_execpath;
  if (!npmPath)
    throw new Error("Run this command through npm run test:lokasi:dashboard");
  return spawnSync(process.execPath, [npmPath, ...args], {
    cwd: root,
    env,
    stdio: "inherit",
  });
}

function exitCode(result: ReturnType<typeof spawnSync>) {
  return result.status ?? 1;
}

function dashboardUrlFrom(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("QA_DASHBOARD_URL must use HTTPS unless it is localhost");
  return url;
}

async function createAutomatedRun(
  baseUrl: URL,
  selectedPlanId: string,
  runToken: string,
  automationKeys: string[],
): Promise<CreatedRun> {
  const response = await fetch(
    new URL(
      `/api/v1/plans/${encodeURIComponent(selectedPlanId)}/runs`,
      baseUrl,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ build, kind: "automated", automationKeys, browser }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as CreatedRun;
  if (!response.ok)
    throw new Error(
        body.error ||
        `Dashboard could not create the run (HTTP ${response.status}). Check case approval and frozen plan scope.`,
    );
  if (!body.id) throw new Error("Dashboard returned no run ID");
  return body;
}

function readFeatureSources(directory: string) {
  const inputs: { relativePath: string; source: string }[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".feature"))
        inputs.push({
          relativePath: relative(root, path).replaceAll("\\", "/"),
          source: readFileSync(path, "utf8"),
        });
    }
  };
  walk(directory);
  return inputs;
}

async function syncAutomationCases(
  baseUrl: URL,
  selectedPlanId: string,
  token: string,
  scenarios: GherkinManifestEntry[],
) {
  const response = await fetch(
    new URL(
      `/api/v1/plans/${encodeURIComponent(selectedPlanId)}/automation/sync`,
      baseUrl,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ browser, scenarios }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    ready?: boolean;
    scenarios?: {
      key: string;
      caseId: string | null;
      status: string;
      planned: boolean;
      ready: boolean;
      reason?: string | null;
    }[];
  };
  if (!response.ok)
    throw new Error(
      body.error ||
        `Quality Hub case sync failed (HTTP ${response.status}). Check the plan-bound Edit token.`,
    );
  return body;
}

async function preflightExistingRun(
  baseUrl: URL,
  selectedPlanId: string,
  runId: string,
  token: string,
  automationKeys: string[],
) {
  const response = await fetch(
    new URL(
      `/api/v1/plans/${encodeURIComponent(selectedPlanId)}/automation/preflight`,
      baseUrl,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ automationKeys, browser, runId, build }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    ready?: boolean;
    scenarios?: {
      key: string;
      caseId?: string | null;
      reason?: string | null;
    }[];
  };
  if (!response.ok || !body.ready)
    throw new Error(
      readinessMessage(
        body.scenarios || [],
        body.error || `Existing run preflight failed (HTTP ${response.status}).`,
      ),
    );
}

function readinessMessage(
  scenarios: {
    key: string;
    caseId?: string | null;
    reason?: string | null;
  }[],
  heading = "Automation cases need review before this suite can run.",
) {
  const blocked = scenarios.filter((scenario) => scenario.reason);
  return [
    heading,
    ...blocked.map(
      (scenario) =>
        `- ${scenario.key}${scenario.caseId ? ` (${scenario.caseId})` : ""}: ${scenario.reason}`,
    ),
    "Review and approve the drafts, then create a new frozen plan containing the current case versions and matching browser target. No test run was created.",
  ].join("\n");
}

function reportIsFresh(startedAt: number) {
  if (!existsSync(reportPath)) return false;
  try {
    const { stats } = JSON.parse(readFileSync(reportPath, "utf8")) as {
      stats?: { startTime?: string };
    };
    const reportStartedAt = Date.parse(stats?.startTime || "");
    return (
      Number.isFinite(reportStartedAt) && reportStartedAt >= startedAt - 2000
    );
  } catch {
    return false;
  }
}

function assertReportBrowserMatches(path: string, expectedBrowser: string) {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    config?: {
      projects?: {
        name?: string;
        use?: { browserName?: string };
      }[];
    };
  };
  const projects = parsed.config?.projects || [];
  const actualBrowsers = [...new Set(projects.map((project) => project.use?.browserName).filter(Boolean))];
  if (actualBrowsers.length !== 1 || actualBrowsers[0] !== expectedBrowser)
    throw new Error(
      `Playwright report browser does not match QA_BROWSER=${expectedBrowser}; found ${actualBrowsers.join(", ") || "no browser identity"}. The report was not uploaded.`,
    );
}

async function main() {
  if (!dashboardUrl || !planId || !syncToken || !runnerToken)
    throw new Error(
      "Set QA_DASHBOARD_URL, QA_PLAN_ID, and QA_EDIT_TOKEN using a plan-bound Edit token from Quality Hub Settings. Existing separate QA_SYNC_TOKEN and QA_RUNNER_TOKEN values are still accepted for compatibility.",
    );
  if (!build || build.length > 120)
    throw new Error("QA_BUILD_ID must contain 1 to 120 characters");
  const baseUrl = dashboardUrlFrom(dashboardUrl);

  console.log("[Quality Hub] Generating Playwright tests from Gherkin...");
  const generated = npm(["run", "bddgen:lokasi"]);
  if (exitCode(generated) !== 0) process.exit(exitCode(generated));

  const featureRoot = resolve(root, "tests/targets/lokasi");
  const scenarios = parseGherkinManifest(readFeatureSources(featureRoot));
  if (!scenarios.length)
    throw new Error("No tagged Gherkin scenarios were found to sync.");
  const automationKeys = scenarios.map((scenario) => scenario.key);
  console.log(
    `[Quality Hub] Syncing ${scenarios.length} Gherkin scenarios and checking plan readiness...`,
  );
  const sync = await syncAutomationCases(
    baseUrl,
    planId,
    syncToken,
    scenarios,
  );
  if (!sync.ready)
    throw new Error(
      readinessMessage(
        sync.scenarios || [],
        "Automation scenarios synced, but some require approval or plan updates.",
      ),
    );

  const run = existingRunId
    ? { id: existingRunId }
    : await createAutomatedRun(baseUrl, planId, runnerToken, automationKeys);
  if (existingRunId)
    await preflightExistingRun(
      baseUrl,
      planId,
      existingRunId,
      runnerToken,
      automationKeys,
    );
  console.log(
    existingRunId
      ? `[Quality Hub] Reusing existing automated run ${run.id}.`
      : `[Quality Hub] Created automated run ${run.id} (${build}).`,
  );

  const startedAt = Date.now();
  console.log("[LOKASI] Running the BDD suite...");
  const executed = npm([
    "exec",
    "--",
    "playwright",
    "test",
    "--config",
    "playwright.lokasi.config.ts",
  ]);
  const testExitCode = exitCode(executed);

  if (!reportIsFresh(startedAt)) {
    console.error(
      `[Quality Hub] No fresh Playwright report was produced. Run ${run.id} is waiting for results at ${baseUrl.href}.`,
    );
    process.exit(testExitCode || 1);
  }

  assertReportBrowserMatches(reportPath, browser);

  console.log("[Quality Hub] Importing the report and captured screenshots...");
  const imported = npm(
    [
      "run",
      "upload",
      "--",
      "--url",
      baseUrl.href,
      "--run-id",
      run.id,
      "--report",
      reportPath,
    ],
    { ...process.env, QA_UPLOAD_TOKEN: runnerToken },
  );
  const uploadExitCode = exitCode(imported);

  if (uploadExitCode === 0)
    console.log(`[Quality Hub] Run ${run.id} is visible in Test Runs.`);
  else
    console.error(
      `[Quality Hub] Import did not finish. Retry with npm run upload -- --url ${baseUrl.href} --run-id ${run.id} --report ${reportPath} (set QA_EDIT_TOKEN).`,
    );

  process.exitCode = testExitCode || uploadExitCode;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "BDD run failed");
  process.exitCode = 1;
});
