# Quality Hub

A private QA workspace for versioned test cases, manual runs, local Playwright imports, defect traceability, and release readiness. React + Vite + TypeScript, Express, Drizzle/SQLite; one process and one persistent volume.

## Run locally

Requires Node.js 22.17 or newer in the 22 LTS line, npm, and a current browser.

```sh
npm ci
npm run password -- "choose-your-own-long-password"
```

Copy `.env.example` to `.env` and fill `OWNER_EMAIL` and `OWNER_PASSWORD_HASH` with your email and the generated `salt:hash` value. The app refuses to start without owner credentials. Do not commit `.env` or paste the plaintext password into the hash field. You can also set `OWNER_PASSWORD` in the environment and run `npm run password` without putting a password in command history.

```sh
npm run build
npm start
```

Open **http://localhost:3000** and sign in. `PUBLIC_ORIGIN` must match the exact browser origin; `localhost` and `127.0.0.1` are different origins. There is no public signup or default owner password.

For development, run `npm run dev` and `npm run dev:web` in separate terminals, open http://127.0.0.1:5173, and set `PUBLIC_ORIGIN=http://127.0.0.1:5173` before starting the API. Vite proxies `/api` to port 3000.

## First release workflow

1. Create a project. Add test cases with steps and expected results, then approve them. Optionally organize suites and link requirements.
2. In **Plans & Releases**, add an environment and release, then freeze a plan containing approved case versions and environment/browser combinations.
3. Start a manual run with a build identifier, or start an automated run to receive Playwright results.
4. Record manual outcomes and retests, or upload the JSON report. Add screenshots, HTTPS evidence links, and release defects.
5. In **Overview**, select the release and build. Drill into its required results to understand the gate.

Editing a case creates a new draft revision. Historical plans retain the original approved content. Deprecation preserves existing results. A retest adds another attempt; the most recent attempt determines the result of that execution.

## Playwright reports

Configure the runner to emit JSON:

```ts
export default defineConfig({
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
```

The LOKASI suite uses executable Gherkin `.feature` files with `playwright-bdd`; `npm run test:lokasi` generates Playwright tests from them before execution. Give each automated scenario a stable repository key such as `@qh_key_lokasi_auth_empty_email`. This key syncs scenario metadata into Quality Hub; the dashboard keeps its own `TC-…` case ID. Existing `@TC-…` tags remain supported to connect scenarios to manually authored cases during migration:

```gherkin
@qh_key_checkout_place_order @TC-1234ABCD @smoke
Scenario: Customer can place an order
  Given the customer has an active account
  When the customer submits a valid order
  Then the order is confirmed
```

Playwright-BDD carries Gherkin tags into the Playwright JSON report, which Quality Hub reads. Scenario identity comes from the stable `@qh_key_…` key—not the title or file path—so renames do not create duplicate cases. A key maps to one case within its project. Changed feature content creates a draft revision; it never rewrites a frozen plan or historical run, and it is not approved automatically. Existing `type: "case"` annotations remain supported for compatibility. Conflicting stable keys and `@TC-…` identities are rejected instead of silently mapping incorrectly.

The plan's browser should match the Playwright project name. Reports with an explicit `browserName` in project `use` or `metadata` use that value instead. If the plan repeats a case/browser across environments, the result remains unmatched until you explicitly choose its environment. The app never guesses from test titles.

For a one-command local run, create an **Edit** token for the selected plan in **Settings** and configure these variables in your local secret manager (or an untracked `.env` file):

```sh
QA_DASHBOARD_URL=https://YOUR-APP.up.railway.app
QA_PLAN_ID=YOUR_PLAN_ID
QA_BUILD_ID=your-build-id
QA_BROWSER=chromium
QA_EDIT_TOKEN=your-plan-scoped-edit-token
npm run test:lokasi:dashboard
```

The command syncs tagged scenarios into Quality Hub as draft automated cases. Review and approve them, then include the approved versions in a new frozen plan. On later runs, the command verifies every scenario is approved and in the selected plan before it creates a run; it then generates and executes the Gherkin suite and imports the JSON report and screenshots—even when a test fails. The plan-bound Edit token is used for scenario sync, automated run creation, and result/evidence upload; it cannot approve cases or change frozen plan scope. The command exits nonzero when tests fail, while retaining the imported results. Keep `LOKASI_EMAIL` and `LOKASI_PASSWORD` in a local secret manager for authenticated scenarios. For manual uploads, use **Test Runs → Open run → Import report** or use a plan-bound Edit token with `npm run upload -- --url URL --run-id RUN_ID --report results.json` and `QA_EDIT_TOKEN` set.

For one-click synchronization from the hosted dashboard, configure `GITHUB_REPOSITORY`, `GITHUB_BRANCH`, and `GITHUB_FEATURE_ROOT` in Railway. Public repositories need no token; a private repository can optionally use `GITHUB_READ_TOKEN` with repository-only **Contents: read** permission. Then open **Settings → Sync from GitHub**, select the target plan, and press **Sync from repo**. Quality Hub fetches a consistent branch commit, parses the `.feature` files under the configured root, and sends them through the same scenario sync validation. It does not run Playwright; approval and frozen-plan updates remain separate. Any optional source token stays server-side and is never returned to the browser.

Set optional `QA_RUN_ID` only to resume an existing, unimported automated run; otherwise each invocation creates a fresh run.

Every newly created API token is bound to one plan. Read-only tokens can query that plan's project data but cannot write; Edit tokens can sync automation drafts, create automated runs, and submit reports/screenshots for that plan. Neither token can approve cases, alter frozen plan scope, read Settings, or download backups. Existing legacy upload, runner, and automation-sync tokens retain their narrower permissions until revoked. Scenario identity is project-wide, so a changed source may create a new case revision used by future plans; frozen plan items and historical runs retain their original versions. Legacy unscoped tokens are denied write access; revoke and replace them with plan-bound tokens. Identical report uploads are idempotent; screenshot retries do not create duplicates. Reports are limited to 10 MB and 5,000 tests; repeated identical test identities must be split into separate runs. Unmatched or out-of-scope tests remain visible but cannot satisfy planned coverage.

Results store all attempts, expected and actual statuses, timing, errors, and attachment metadata. Local trace/video paths are not remotely accessible; use external HTTPS links for published traces/videos. API tokens cannot approve cases or modify frozen plan scope.

## Release rules

Rules apply in this order, across every frozen plan in the selected release, using results for the selected build only:

| Status  | Condition                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| Blocked | Open critical release defect, or a required failed/blocked test                                             |
| Unknown | Missing scope, incomplete automated import, or required missing/skipped/interrupted/expected-failure result |
| At risk | Required results completed, but retry-recovered failures or open high defects remain                        |
| Ready   | All required results passed cleanly; no critical/high defects                                               |

Completion counts passed, failed, blocked, and expected-failure terminal outcomes; skipped/not-run/interrupted remain incomplete. Expected failures still prevent Ready. Pass rate is `passed / (passed + failed)`; retries do not inflate the denominator. Verified automation coverage uses active approved cases. Requirements without configured records show “Not configured”, not zero coverage.

Multiple runs for one planned item/build use the latest run containing that item. Starting a new manual run creates Not Run executions and supersedes prior manual evidence for those items. A newer complete automated run supersedes an older incomplete automated run on the same plan/build.

## Railway deployment

The repository includes `Dockerfile`, `docker-entrypoint.sh`, and `railway.toml`. Deploy this directory as the repository root, or set Railway's root directory to the directory containing these files.

1. Create one Railway service from the code repository.
2. Attach a persistent volume mounted at **`/data`**. Use one replica.
3. Configure `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `DATA_DIR=/data`, `NODE_ENV=production`, and `PUBLIC_ORIGIN=https://YOUR-APP.up.railway.app` using the actual generated domain. Railway supplies `PORT`.
4. Deploy. Startup migrations execute after the volume is mounted. The entrypoint sets `/data` ownership, then drops to the non-root `node` user for the app.
5. Enable **Serverless** in service deployment settings and redeploy. No polling or always-on worker is required.
6. Confirm `/api/health`, sign-in, a small manual run, and data persistence across redeployment. Check Railway usage after representative daily use and after idle periods.

The Free plan's credit is a budget, not an uptime guarantee. Compute, disk, and network use can exhaust it; cold starts and downtime are acceptable for this personal workspace. Resource measurements from the local harness are not Railway billing measurements. Do not configure external uptime pings that keep the service awake.

This workspace had no Docker or Railway CLI installed during initial development. Live deployment, container runtime checks, platform sleep/wake, and credit use must be validated on Railway; the source and deployment files are prepared, but no deployment is claimed.

## Storage and recovery

SQLite uses WAL, foreign keys, transactions, and versioned Drizzle migrations. Defaults: 500,000,000-byte volume budget, 80% safe limit for new imports/uploads, 100 MiB screenshot quota, 2 MiB per image. PNG/JPEG/WebP files are decoded, checked, and re-encoded as WebP; metadata is not retained. The budget can be set through `VOLUME_CAPACITY_BYTES`.

No records are silently purged. Remove individual screenshots/links through an execution's evidence panel after confirmation. Case deprecation preserves history. For a large historical archive, export a backup and create a fresh workspace rather than deleting a live database.

**Settings → Download backup** creates a consistent SQLite snapshot plus referenced screenshot files. Sessions and upload tokens are removed from the snapshot. Backups are downloaded from temporary storage and cleaned after the response; they are not kept as a second copy on the persistent volume. Keep the downloaded file somewhere safe. A backup does not include your configured owner password hash.

To restore offline:

```sh
# Stop the app first. Destination must be new or empty.
npm run restore -- --from backup.zip --to ./restored-data
```

Set `DATA_DIR` to the restored directory, retain/reconfigure owner credentials, and restart. Restore validates archive paths, size, manifest, SQLite integrity/foreign keys, and screenshot references. Create fresh plan-bound API tokens afterward. Never restore over a running or nonempty data directory.

## Verification and maintenance

```sh
npx playwright install chromium
npm run verify
npm audit --omit=dev
```

The harness checks TypeScript/build, gate/parser unit tests, real SQLite API workflows, browser interactions, and a 2,000-case/50,000-execution local benchmark. See `HARNESS.md` for isolation and acceptance criteria. Playwright screenshots/traces and HTML reports capture failures.

Source layout: `src/` UI; `shared/contracts.ts` validation and gate types; `server/` API, auth, storage, parser and reporting; `migrations/` committed schema history; `scripts/` uploader, restore, password and harness tools; `tests/` unit, API, and browser tests.

Use `npm run db:generate` after schema changes, inspect the generated SQL, and take a backup before deploying migrations. Production builds target modern ES2022-capable browsers. Dependencies are locked; the esbuild override keeps build tooling on a patched release.

Deferred: team accounts, Jira synchronization, CI-specific integrations, AI generation, performance/security dashboards, and hosted test execution.
