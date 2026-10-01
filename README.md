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

Annotate each test with a stable case ID from Quality Hub:

```ts
test("customer can place an order", async ({ page }) => {
  test.info().annotations.push({ type: "case", description: "TC-1234ABCD" });
  // test steps ...
});
```

The plan's browser should match the Playwright project name. Reports with an explicit `browserName` in project `use` or `metadata` use that value instead. If the plan repeats a case/browser across environments, the result remains unmatched until you explicitly choose its environment. The app never guesses from test titles.

Use **Test Runs → Open run → Import report**, or create an upload token in **Settings** and set `QA_UPLOAD_TOKEN` locally:

```sh
npm run upload -- --url https://YOUR-APP.up.railway.app --run-id RUN_ID --report results.json
```

The uploader retries network failures and 502/503/504 cold-start responses up to five attempts. Identical uploads to the same run are idempotent. If the Playwright report includes local screenshot attachments, the CLI also uploads the final screenshot for each execution, on both pass and failure; repeat uploads do not duplicate images. Keep the report and its artifact directory together and run the CLI on the machine where Playwright ran. A browser-only JSON import does not transfer local image files; add those manually from the execution view. A different report requires a new run. Reports are limited to 10 MB and 5,000 tests; repeated identical test identities must be split into separate runs. Unmatched tests remain available for explicit mapping.

Results store all attempts, expected and actual statuses, timing, errors, and attachment metadata. Local trace/video paths are not remotely accessible; use external HTTPS links for published traces/videos. Upload tokens can submit reports and screenshots only; they cannot read data or modify cases.

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

Set `DATA_DIR` to the restored directory, retain/reconfigure owner credentials, and restart. Restore validates archive paths, size, manifest, SQLite integrity/foreign keys, and screenshot references. Create fresh upload tokens afterward. Never restore over a running or nonempty data directory.

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
