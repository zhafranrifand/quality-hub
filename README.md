# Quality Hub

Quality Hub is a personal QA workspace for managing test cases, recording manual results, synchronizing automated scenarios from a repository, and checking release readiness. It keeps approved case versions, execution attempts, defects, and screenshot evidence together.

The app uses React, Vite, and TypeScript for the UI; Express for the API; and Drizzle with SQLite for storage. One server serves the frontend and API. Playwright tests run on your computer; the dashboard stores their results.

## Contents

- [Start locally](#start-locally)
- [Use the dashboard](#use-the-dashboard)
- [Write and organize test cases](#write-and-organize-test-cases)
- [Understand synchronization](#understand-synchronization)
- [Run automation and publish results](#run-automation-and-publish-results)
- [Tokens and access](#tokens-and-access)
- [Release readiness and metrics](#release-readiness-and-metrics)
- [Configuration reference](#configuration-reference)
- [Deploy on Railway](#deploy-on-railway)
- [Screenshots, storage, and backups](#screenshots-storage-and-backups)
- [Troubleshooting](#troubleshooting)
- [Development and verification](#development-and-verification)

## Start locally

Run commands from the repository directory containing `package.json`.

### Requirements

- Node.js 22.17 or later in the Node 22 LTS line, with npm.
- A current browser.
- Playwright browser binaries if you want to run browser tests.

### First setup

Install dependencies and create your local configuration:

```powershell
npm ci
Copy-Item .env.example .env
npm run password -- "replace-with-your-own-password"
```

On macOS or Linux, use `cp .env.example .env` instead of `Copy-Item`.

The password must have at least 12 characters. Copy the generated `salt:hash` value into `OWNER_PASSWORD_HASH`, and set your owner email. These credentials sign you into Quality Hub; they are separate from the account used to test LOKASI.

Edit `.env`:

```dotenv
PORT=3000
DATA_DIR=./data
OWNER_EMAIL=you@example.com
OWNER_PASSWORD_HASH=PASTE_GENERATED_HASH_HERE
PUBLIC_ORIGIN=http://localhost:3000
```

Leave `GITHUB_REPOSITORY` blank until you configure a real source repository; replace the example `owner/repository` value if you want GitHub sync. Set `QA_DASHBOARD_URL` to your actual dashboard URL before using the integrated automation command.

Build and start:

```powershell
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the email and original password you configured. There is no public registration or default owner password.

`PUBLIC_ORIGIN` must match the browser URL exactly, including the hostname and port. For example, to use the local address from this workspace:

```dotenv
PORT=3210
PUBLIC_ORIGIN=http://127.0.0.1:3210
```

Then open [http://127.0.0.1:3210](http://127.0.0.1:3210). Stop the server with Ctrl+C. Rebuild before using `npm start` after application code changes.

The server loads `.env` at startup. Changing server variables requires a restart. Local records are stored in `DATA_DIR`, which defaults to `./data`; reusing that directory preserves your workspace.

### Development with live reload

Set `PORT=3000` and `PUBLIC_ORIGIN=http://127.0.0.1:5173` in `.env`.

Run these in two terminals:

```powershell
# Terminal 1: API
npm run dev
```

```powershell
# Terminal 2: frontend
npm run dev:web
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies API requests to port 3000; changing the API port also requires updating the proxy in `vite.config.ts`.

## Use the dashboard

| Menu             | What you do there                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Overview         | Select a release and build, inspect readiness reasons, and open filtered records from metrics.         |
| Test Cases       | Create, search, filter, duplicate, approve, and deprecate cases; organize suites and review revisions. |
| Plans & Releases | Define environments, releases, and frozen plans with case versions and browser targets.                |
| Test Runs        | Start manual or automated runs, inspect attempts, import results, and attach evidence or defects.      |
| Defects          | Track severity, status, affected releases, and optional external issue links.                          |
| Coverage         | Link requirements to cases and review automation mappings.                                             |
| Settings         | Manage API tokens, sync from GitHub, inspect storage, and export backups.                              |

To complete a manual release cycle:

1. Create or select a project.
2. Write cases with preconditions, ordered actions, and expected results. Choose their execution method and approve them.
3. Add an environment and release. Create a frozen plan containing the approved case versions and environment/browser combinations.
4. Start a manual run from the plan and give it a build identifier.
5. Record results, notes, screenshots, and linked defects. Retesting adds an attempt to the existing execution.
6. Open Overview, select the release and the same build, and review the readiness reasons.

Plans preserve the case versions selected when they were created. Editing a case creates a draft revision; existing plans and runs keep their original content. Approve the revision and create a new plan when you want future runs to use it. Deprecating a case preserves its history.

## Write and organize test cases

### Manual, automated, and both

| Execution method | Intended use                                                               |
| ---------------- | -------------------------------------------------------------------------- |
| Manual           | A tester performs the steps and records the result.                        |
| Automated        | Executable test code performs the checks.                                  |
| Both             | The same behavior has manual instructions and an automated implementation. |

The method describes how a case can be executed; it is separate from Draft, Approved, and Deprecated status. New scenarios created by repository sync are Automated. Linking a scenario to an existing Manual case can change its method to Both while preserving its manual steps.

For manual cases, use a title describing one behavior, preconditions describing the required state, and ordered steps with observable expected results. Add a component, priority, and tags to make filtering useful.

### Gherkin is the source for repository-owned automation

Author automated scenarios in `.feature` files and implement their steps in `.steps.ts` files. Sync creates their case records in Quality Hub, so you do not need to write the same automated scenario twice. Review, approval, planning, and execution history remain in the dashboard.

The current LOKASI suite is organized as:

```text
tests/
  quality-hub/
    unit/                    Dashboard domain, parser, and GitHub source tests
    api/                     Dashboard API integration tests
    e2e/                     Browser tests for Quality Hub itself
    fixtures.ts              Shared test data
  targets/
    lokasi/
      lokasi.feature        # Scenarios and stable identity tags
      lokasi.steps.ts       # Executable Playwright step definitions
      .features-gen/         # Generated tests; do not edit or commit
```

As the suite grows, group feature files by module, such as authentication, datasets, and analysis. Both the runner and GitHub sync discover feature files recursively under the configured root. The BDD runner also discovers step definitions recursively.

Example using steps already implemented by the LOKASI suite:

```gherkin
@lokasi @smoke
Feature: LOKASI sign-in

  @qh_key_lokasi_auth_empty_email @authentication
  Scenario: Continue is disabled without an email
    When I open the LOKASI sign-in page
    Then Continue is disabled and password recovery is available
```

Identity rules:

- Put exactly one `@qh_key_<key>` tag directly above each Scenario.
- Use lowercase letters and numbers, separated by underscores or hyphens: `@qh_key_lokasi_auth_empty_email`.
- Keep the key stable when renaming a scenario or moving its file. Changing it represents a different identity and can create a new case.
- Each key must be unique within the project's synchronized scenarios.
- Put grouping tags such as `@smoke`, `@authentication`, and `@datasets` on scenarios, features, or rules.
- Scenario Outlines are not supported by sync v1; use individual Scenarios.
- New step wording needs a matching step definition before the BDD runner can generate tests.

To connect automation to a manually authored case, add its actual dashboard ID:

```gherkin
@qh_key_lokasi_auth_empty_email @TC-1234ABCD @authentication
Scenario: Continue is disabled without an email
  When I open the LOKASI sign-in page
  Then Continue is disabled and password recovery is available
```

`@TC-1234ABCD` is an example, not an ID to copy. The referenced case must exist in the target project. The checked-in suite contains IDs from an existing workspace; for a fresh workspace, replace them with your actual IDs or remove the `@TC-…` tags to let sync create automated cases. Keep the stable `@qh_key_…` tags.

An existing manual approval does not automatically approve new synchronized content. If linking or syncing changes case content, the current implementation creates a draft revision for review. Identical repeated syncs do not create another revision.

## Understand synchronization

Sync registers scenario descriptions and identities as cases. Test execution is a separate operation.

| Action                                  | Where scenario content comes from             | Which dashboard receives it    | Runs tests?                              |
| --------------------------------------- | --------------------------------------------- | ------------------------------ | ---------------------------------------- |
| Sync from repo in the local dashboard   | Configured GitHub repository and branch       | The local dashboard you opened | No                                       |
| Sync from repo in the Railway dashboard | Configured GitHub repository and branch       | That Railway dashboard         | No                                       |
| `npm run test:lokasi:dashboard`         | Local feature files, including unpushed edits | The URL in `QA_DASHBOARD_URL`  | Yes, after approval and plan checks pass |
| `npm run test:lokasi`                   | Local feature files                           | None; results stay local       | Yes                                      |

The Sync button reads GitHub even when the dashboard runs locally. It cannot see unpushed changes on your computer. Pushing to a new branch makes changes available only if `GITHUB_BRANCH` points to that branch; otherwise merge into the configured branch or change the setting and restart/redeploy.

Local and production databases are separate. A CLI run on your computer can publish to either one, depending on `QA_DASHBOARD_URL` and a token issued by that dashboard.

### Configure the Sync button

Set these variables in the local server's `.env` or the Railway service's Variables:

```dotenv
GITHUB_REPOSITORY=your-owner/your-repository
GITHUB_BRANCH=main
GITHUB_FEATURE_ROOT=tests/targets/lokasi
GITHUB_SYNC_BROWSER=chromium
```

Restart locally or apply the variables and redeploy on Railway. Select the destination project in the workspace header, open **Settings → Sync from GitHub**, and click **Sync from repo**. The result identifies the GitHub commit used and whether any imported cases need review and approval.

Public repositories need no GitHub token. For private repositories, supply `GITHUB_READ_TOKEN` with Contents read access to that repository. This source credential stays on the server.

The button uses your signed-in owner session; you do not need to enter a Quality Hub automation token for the button. CLI integrations authenticate with a plan-bound token instead.

### First sync and subsequent changes

1. Select or create the destination project in the workspace header. A release, environment, or plan is not required to sync cases.
2. Sync your scenarios from GitHub or start the integrated local command.
3. Review the synchronized drafts in Test Cases and approve the intended versions.
4. Create a frozen plan containing those approved versions and matching environment/browser targets.
5. For the CLI workflow, create an Edit token bound to the new plan and update `QA_PLAN_ID` and `QA_EDIT_TOKEN`.
6. Run the integrated command to execute and publish results.

Sync does not insert cases into an existing frozen plan. Changed scenario content creates a draft revision, so approval and a new plan are needed before running that revision. Frozen plans and historical evidence retain the previous versions.

## Run automation and publish results

### Execute BDD tests locally

Install the browser once:

```powershell
npx playwright install chromium
```

For authenticated LOKASI scenarios, set credentials in your shell. In PowerShell:

```powershell
$env:LOKASI_EMAIL = "your-test-account@example.com"
$env:LOKASI_PASSWORD = "your-test-account-password"
npm run test:lokasi
```

The default target is `https://dev.lokasi.com/intelligence`. Override it with `LOKASI_BASE_URL` when needed; it must use HTTPS.

This command generates Playwright tests from Gherkin and runs them. It writes:

- JSON results to `lokasi-results/results.json`.
- Screenshots to `lokasi-results/artifacts/`.

The suite captures screenshots for passed and failed tests. Authenticated scenarios can be skipped when credentials are missing; inspect the output rather than treating a skipped result as a pass.

Direct `npm run test:lokasi` uses shell environment variables; its configuration does not load `.env`. The integrated dashboard command below loads `.env` before starting the suite.

### Execute, sync, and publish with one command

In **Settings → Automation tokens**, create an **Edit** token bound to the selected plan. Store these values in your untracked `.env`:

```dotenv
QA_DASHBOARD_URL=http://127.0.0.1:3210
QA_PLAN_ID=YOUR_FROZEN_PLAN_ID
QA_EDIT_TOKEN=YOUR_PLAN_BOUND_EDIT_TOKEN
QA_BUILD_ID=dev-build-001
QA_BROWSER=chromium
LOKASI_EMAIL=your-test-account@example.com
LOKASI_PASSWORD=your-test-account-password
```

Use your actual local URL, or a Railway HTTPS URL to publish to production. The token and plan must belong to that destination.

```powershell
npm run test:lokasi:dashboard
```

The command generates tests, syncs local scenarios, and checks their approval and frozen plan scope. If a scenario needs review or a plan update, it stops with an explanation before creating a run.

When all scenarios are ready, it creates an automated run, executes the suite, and uploads the JSON report plus captured screenshots. Failed tests still have their results published; the command exits with a failure code. Open **Test Runs** in the destination dashboard and look for the run ID printed in the terminal.

The current integrated command processes the whole LOKASI feature directory. Every scenario must pass its plan checks. `QA_BROWSER` must match the plan target and be `chromium`, `firefox`, or `webkit`; install that browser if you change it.

Leave `QA_RUN_ID` blank for a fresh run. Use it only to resume an existing, unimported automated run for the matching plan and build. A corrected test execution belongs in a new run.

### Upload an existing report

Use **Test Runs → Open run → Import report** for browser uploads. JSON attachment paths alone do not upload local files; screenshots need separate evidence uploads.

Alternatively, set the Edit token in your shell and use the CLI:

```powershell
$env:QA_EDIT_TOKEN = "YOUR_PLAN_BOUND_EDIT_TOKEN"
npm run upload -- --url http://127.0.0.1:3210 --run-id YOUR_RUN_ID --report lokasi-results/results.json
```

The standalone uploader reads its token from the shell; it does not load `.env`. Run it from the directory where the report and screenshot paths were generated. Screenshot files must be inside the report directory.

Report imports preserve attempts, expected and actual statuses, errors, timing, and attachment metadata. Identical content uploaded to the same run returns the existing import. Screenshot retries are also duplicate-safe. The uploader retries network failures and HTTP 502/503/504 responses up to five attempts.

Tests without an unambiguous case and environment/browser mapping remain visible as unmatched. They do not satisfy planned release coverage. Use **Verify mapping** to select the appropriate planned case and target; matching never relies on similar titles.

## Tokens and access

The owner signs in with a password and receives an HTTP-only session. Public registration is disabled. API tokens provide access for scripts without using the owner's password.

| Token     | Allowed                                                                                     | Not allowed                                                          |
| --------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Read-only | Read the selected plan's project data                                                       | Writes, settings, backups                                            |
| Edit      | Sync drafts into the project associated with its plan; create runs, import results, and upload evidence for that plan | Approve cases, alter frozen plans, access settings, download backups |

Tokens are bound to one plan; sync can update that plan's project's case library, while execution and result operations stay scoped to that plan. Their secret is shown once. Revoke a token in Settings when it is no longer needed. Create a new token when switching plans or dashboard instances.

The GitHub source token is separate: it lets the server read a private repository. The Quality Hub Edit token lets a CLI write to the dashboard. Older upload, runner, and automation-sync tokens remain supported with their narrower permissions; replace unscoped legacy tokens with plan-bound tokens.

## Release readiness and metrics

Readiness uses the selected release and build, across its frozen plans, in this precedence:

| Status  | Reason                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Blocked | An open critical release defect or a required failed/blocked test exists.                                                                    |
| Unknown | Scope is missing, an automated import is incomplete, or required evidence is missing, skipped, not run, interrupted, or an expected failure. |
| At risk | Required results are complete, but retry-recovered failures or open high-severity defects remain.                                            |
| Ready   | Every required test passes cleanly and no critical/high defect remains.                                                                      |

Evidence from another build does not satisfy the selected build's gate.

- **Completion:** required combinations with terminal outcomes divided by planned combinations. Passed, failed, blocked, and expected-failure outcomes count as terminal; skipped, not-run, and interrupted outcomes remain incomplete.
- **Pass rate:** passed final results divided by passed plus failed final results. Retries do not inflate totals.
- **Flaky result:** a failure followed by success in the same Playwright run.
- **Automation coverage:** active approved cases with verified automation mappings divided by all active approved cases.
- **Requirement coverage:** requirements linked to an approved case divided by tracked requirements. No requirements means “Not configured.”

An expected failure is distinct from a clean pass and still prevents Ready. A critical defect blocks release even when the pass rate is 100%.

For the same planned item and build, the latest run containing that item supplies its result. Starting another manual run creates Not Run executions that supersede prior evidence for those items.

## Configuration reference

Application and GitHub variables are read by the server. `QA_*` and `LOKASI_*` variables configure the local automation workflow.

| Variable                          | Purpose / default                                                                |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `OWNER_EMAIL`                     | Required Quality Hub owner login email.                                          |
| `OWNER_PASSWORD_HASH`             | Required hash generated by `npm run password`.                                   |
| `PORT`                            | Server port; defaults to `3000`. Railway supplies its own value.                 |
| `DATA_DIR`                        | SQLite and screenshots; defaults to `./data`. Use `/data` on Railway.            |
| `PUBLIC_ORIGIN`                   | Exact dashboard browser origin for session/CSRF checks.                          |
| `NODE_ENV`                        | Set to `production` on Railway.                                                  |
| `VOLUME_CAPACITY_BYTES`           | Storage budget; defaults to `500000000` bytes.                                   |
| `GITHUB_REPOSITORY`               | GitHub `owner/repository`; leave blank to disable the source connection.         |
| `GITHUB_BRANCH`                   | Source branch; defaults to `main`.                                               |
| `GITHUB_FEATURE_ROOT`             | Feature directory; defaults to `tests/targets/lokasi`.                           |
| `GITHUB_SYNC_BROWSER`             | Browser identity for button sync; defaults to `chromium`.                        |
| `GITHUB_READ_TOKEN`               | Optional source credential for a private GitHub repository.                      |
| `QA_DASHBOARD_URL`                | Dashboard receiving local sync, runs, and reports.                               |
| `QA_PLAN_ID`                      | Frozen plan used by the integrated runner.                                       |
| `QA_EDIT_TOKEN`                   | Edit token issued by that dashboard and bound to that plan.                      |
| `QA_BUILD_ID`                     | Target build label; defaults to `local-YYYY-MM-DD` in the integrated runner.     |
| `QA_BROWSER`                      | Runner browser; defaults to `chromium`.                                          |
| `QA_RUN_ID`                       | Optional existing unimported run to resume.                                      |
| `LOKASI_BASE_URL`                 | HTTPS application under test; defaults to `https://dev.lokasi.com/intelligence`. |
| `LOKASI_EMAIL`, `LOKASI_PASSWORD` | Account credentials for authenticated target tests.                              |

Keep `.env`, tokens, generated reports, local databases, and screenshots out of Git. The repository's ignore rules exclude these local artifacts.

## Deploy on Railway

Deploy the directory containing `Dockerfile`, `package.json`, and `railway.toml` as the service root.

1. Connect the GitHub repository to one Railway service.
2. Attach a persistent volume mounted at `/data`. Keep one replica.
3. Set `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `DATA_DIR=/data`, `NODE_ENV=production`, and `PUBLIC_ORIGIN=https://YOUR-SERVICE.up.railway.app`.
4. Generate a public domain and make sure `PUBLIC_ORIGIN` matches it. Railway supplies `PORT`.
5. Add the GitHub source variables if you want the hosted Sync button.
6. Deploy. Startup runs database migrations after the volume is mounted. The container entrypoint fixes volume ownership and starts the app as the non-root `node` user.
7. Enable Serverless in the Railway service settings and redeploy if you want idle sleeping.
8. Check `/api/health`, sign-in, and a small run. Verify persistence across a redeployment and review actual usage.

SQLite is the database. The volume makes its files and screenshot evidence persist between deployments; it does not replace the database. Without persistent storage, a redeployment can lose application data.

The Docker image contains the dashboard server, not the local BDD runner. Tests execute on your computer and publish results over HTTPS. GitHub source sync and deployment are separate operations.

Resource limits, credit consumption, and sleep/wake behavior depend on the Railway account and service settings. Measure actual usage before claiming the app fits a budget. Local benchmark results do not establish Railway costs or availability.

## Screenshots, storage, and backups

Screenshots must be valid PNG, JPEG, or WebP files, at most 2 MiB each. Images are decoded and stored as WebP without their original metadata. The combined screenshot quota is 100 MiB.

Reports are limited to 10 MiB and 5,000 tests per import. Scenario sync requests support up to 500 scenarios. New report/evidence uploads are rejected when the configured storage budget reaches its 80% safety limit or available disk space is too low.

Reports and screenshots upload separately. An evidence failure preserves imported test results. A remote dashboard cannot open a local trace/video path; attach a published HTTPS evidence link instead.

Records are not silently purged. Remove explicitly selected evidence from its execution panel when needed, and deprecate cases to retain history.

### Export and restore

Use **Settings → Download backup** to export a consistent SQLite snapshot and referenced screenshots. Sessions and API tokens are removed from the export; the configured owner password hash is not included. Backup export uses SQLite's backup mechanism rather than copying a live database file.

To restore:

1. Stop the app.
2. Choose a new or empty destination directory.
3. Run:

```powershell
npm run restore -- --from backup.zip --to ./restored-data
```

4. Set `DATA_DIR=./restored-data`, retain or reconfigure the owner credentials, and restart.
5. Create new plan-bound API tokens.

Restore checks archive paths, sizes, the manifest, database integrity, foreign keys, and screenshot references. Do not restore over a running or nonempty data directory.

## Troubleshooting

| Symptom                                                | Check                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid email or password                              | Use `OWNER_EMAIL` and the original password corresponding to `OWNER_PASSWORD_HASH`. Restart after changing credentials. Target-app credentials do not sign you into Quality Hub. |
| Requests fail after sign-in                            | Match `PUBLIC_ORIGIN` to the exact browser scheme, hostname, and port.                                                                                                           |
| Port is already in use                                 | Stop the existing app or choose a free `PORT` and update `PUBLIC_ORIGIN`. For Vite development, also update its API proxy.                                                       |
| Previous projects are missing                          | Verify `DATA_DIR` and which local/production instance you opened. Relative paths resolve from the server's working directory.                                                    |
| Recent UI changes are missing                          | Rebuild before `npm start`; ensure you opened the right port and refresh the browser.                                                                                            |
| Sync source is not configured                          | Set a real `GITHUB_REPOSITORY`, branch, and feature root; restart locally or redeploy Railway.                                                                                   |
| Sync ignores local edits or a new branch               | Push to the configured branch or change `GITHUB_BRANCH`. Use the integrated local runner to sync unpushed feature edits.                                                         |
| Sync rejects a `TC-…` tag                              | The case ID must exist in the selected plan's project. Replace workspace-specific IDs or omit the legacy tag for a new automated case.                                           |
| Cases synced but no run appears                        | Sync alone creates no run. The integrated runner stops before execution if drafts need approval or current versions are absent from the frozen plan.                             |
| Token is rejected                                      | Check the destination URL, token revocation, and plan binding. The runner requires Edit permission.                                                                              |
| Automated result is unmatched                          | Check the stable key or case ID, approved version, and plan's environment/browser target. Use Verify mapping for ambiguous results.                                              |
| Screenshot says “Local artifact, unavailable remotely” | Report metadata includes a path, not the file. Use the uploader or attach the screenshot through the evidence panel.                                                             |
| Upload stops on screenshots                            | Check the 2 MiB per-file limit, quota, storage, and local paths. Fix the evidence issue and retry the same report/run; imported results remain.                                  |
| Authenticated target tests are skipped                 | Set `LOKASI_EMAIL` and `LOKASI_PASSWORD` in the runner environment.                                                                                                              |
| Browser executable is missing                          | Run `npx playwright install chromium`, or install the browser selected by `QA_BROWSER`.                                                                                          |
| Release is Unknown despite passing tests               | Check missing planned targets, skipped/expected-failure outcomes, incomplete imports, selected build, and unmatched results.                                                     |

## Development and verification

### Source layout

```text
src/                            React UI, pages, API client, shared components
server/                         API, authentication, SQLite, reporting, ingestion, storage
shared/                         TypeScript contracts, validation, execution/gate definitions
migrations/                     Committed SQL migrations and Drizzle metadata
scripts/                        Integrated runner, uploader, restore, password, harness
tests/quality-hub/unit/          Dashboard domain, parsing, and sync-source tests
tests/quality-hub/api/           Dashboard API integration tests
tests/quality-hub/e2e/           Browser tests for Quality Hub itself
tests/quality-hub/fixtures.ts    Data shared by Quality Hub tests
tests/targets/lokasi/            Gherkin and Playwright tests for LOKASI Intelligence
Dockerfile               Container build
docker-entrypoint.sh     Persistent volume initialization
railway.toml             Railway build, health check, and replica configuration
```

### Useful commands

| Command                           | Purpose                                                               |
| --------------------------------- | --------------------------------------------------------------------- |
| `npm run build`                   | TypeScript check, frontend build, and server bundle.                  |
| `npm start`                       | Run the compiled dashboard.                                           |
| `npm run dev` / `npm run dev:web` | API watch mode / Vite frontend.                                       |
| `npm test`                        | Domain, parser, and SQLite API tests.                                 |
| `npm run test:e2e`                | Dashboard browser tests against the compiled app; build first.        |
| `npm run bddgen:lokasi`           | Generate tests from feature files without executing them.             |
| `npm run test:lokasi`             | Execute target BDD tests and keep results locally.                    |
| `npm run test:lokasi:dashboard`   | Sync local scenarios, check scope, execute, and publish results.      |
| `npm run benchmark`               | Local sizing and dashboard performance benchmark.                     |
| `npm run verify`                  | Build → unit/API tests → dashboard E2E → benchmark; stops on failure. |
| `npm run db:generate`             | Generate Drizzle migrations after schema changes.                     |
| `npm audit --omit=dev`            | Check production dependency advisories.                               |

For full local verification:

```powershell
npx playwright install chromium
npm run verify
```

The harness uses isolated SQLite databases. Browser tests start a separate app on port 3107 and retain failure artifacts. It does not execute the LOKASI suite or validate live Railway behavior. See [HARNESS.md](HARNESS.md) for test isolation and benchmark targets, and [LOKASI_TESTING.md](LOKASI_TESTING.md) for target exploration context.

Inspect generated SQL before committing migrations and export a backup before deploying database changes. Commit source, migrations, configuration templates, and `package-lock.json`; keep local/generated artifacts ignored.

Team permissions, Jira synchronization, hosted test execution, and AI-generated cases are outside the current release.
