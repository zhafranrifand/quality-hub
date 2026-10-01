# LOKASI Intelligence QA target

Target: <https://dev.lokasi.com/intelligence>. The Playwright suite tests this development site; Quality Hub stores imported results but does not run the tests itself.

## Initial smoke coverage

| Case                                          | Latest observed result | Evidence                                                                                                                         |
| --------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in entry point renders                   | Passed                 | Email field and Continue button appear                                                                                           |
| Continue disabled without email               | Passed                 | Continue remains disabled                                                                                                        |
| Sign-in at 390 px mobile width                | **Failed**             | Document width was 452 px, 62 px wider than viewport                                                                             |
| Known account advances to password            | Passed                 | Password field appears after Continue                                                                                            |
| Authorized account opens Intelligence modules | Passed                 | Sign-in, map workspace, Agentic AI, Analysis, Dataset Explorer, Dataset Management, Search, and Historical Analysis were reached |

The original authenticated smoke check only navigated and read. The expanded suite now also covers search/map, dataset preview, and area validation. These automated checks do not upload datasets or generate analyses. The onboarding dialogs are dismissed during the run. No credential is stored in code, report files, or Playwright storage state.

## Expanded hands-on exploration (30 September 2026)

The owner explicitly approved creating a small fixture in the LOKASI development account and running a sample analysis. The fixture is synthetic and contains no customer or personal data. Existing datasets and projects were not edited.

| Area | Observed behavior | QA follow-up |
| --- | --- | --- |
| Onboarding | Workspace tour has four steps. The introduction's embedded video links to Rick Astley's “Never Gonna Give You Up,” although its caption says it explains LOKASI. | Verify intended introduction media and log a content defect if unintended. |
| Search/map | Searching for Jakarta International Stadium and choosing its suggestion centered the map, added a marker, and increased zoom. | Automate marker and location assertion. |
| Dataset Explorer | Partner data exposes source, provider, license, aggregation filters, a dataset preview, schema columns, and sample rows. | Automate a representative preview without relying on a changing catalog count. |
| Analysis setup | The global filter requires a country and selected area. Indonesia → DKI JAKARTA → JAKARTA BARAT was selectable. Catchment and administrative area inputs, grid/profiling outputs, and grid schemes were visible. | Assert validation before generation. |
| Dataset upload | Uploaded `QA_Codex_Lokasi_20260930.csv` (three Jakarta Barat points); LOKASI inferred point geometries, showed three entries, and permitted a description and Indonesia data setting. | Keep the fixture isolated; verify CSV/geometry mapping and permissions. |
| Publish and selection | Publishing the synthetic dataset made it visible in My Organization, and Add Dataset loaded it onto the analysis map. | Avoid using pre-existing datasets for write tests. |
| Analysis/result | Administrative-area profiling completed. The report represented all three points at 33.3% each. LOKASI correctly warned that a normalized score needs more than the single selected area. | Validate counts and warning; do not require a score in a single-area test. |
| Saved project | Saved as `QA Codex 2026-09-30 three-point profiling`; reopening it loaded the stored title, area, and QA fixture. Historical Analysis showed the related profiling job and its configuration. | Add an automated reopen check once the workflow is stable. |
| User management | The empty Create User form kept Create disabled; it was closed without adding an account. | Keep tests non-mutating until permissions and disposable-user policy are defined. |

The synthetic dataset ID is `f68d9472-3f95-4664-9c97-6a905b47b70e`. It is currently **published** in the development account so that the sample analysis can reference it. The sample analysis job and named saved project were left in place as QA evidence. Do not delete them automatically or treat them as production data. Future cleanup should use the product's recovery-safe flow and be explicitly coordinated.

The initial new-spec failures were locator/onboarding mistakes, not verified product defects. The corrected eight-test authenticated suite finished **7 passed, 1 failed**. Search/map, dataset preview, and analysis-area validation all passed. The sole failure is the reproducible 390 px mobile-width overflow (452 px content width). The imported automated run has all eight cases matched and one screenshot attached to each execution, including the failure. Reuploading the identical report was verified to add no duplicate results or screenshots.

Quality Hub also contains an 11-case manual exploration plan: all eleven observed cases were marked passed with notes and five screenshots across the run. Its release gate is **Ready** for the selected build. The automated smoke release is **Blocked** because the mobile test failed. A medium-severity defect is linked to that execution. The manual and automated gates refer to different release plans; Ready for exploration does not override the blocked smoke release.

Case execution method is separate from result status and automation mapping verification. The sixteen cases are classified as five Automated smoke cases, three Both cases (search/map, partner dataset preview, analysis-area validation), and eight Manual exploratory cases. Editing this field created new approved case revisions; existing plan versions and evidence stay frozen. The user-form case was also clarified to expect a disabled Create button, matching the observed validation behavior.

The collapsed sidebar's six module icon buttons appeared without accessible names in Playwright's accessibility snapshot. That is a likely keyboard/screen-reader issue to investigate separately; it is not counted as a failed automated case yet.

## Run the suite

Install dependencies and Chromium from the `quality-hub` directory:

```sh
npm ci
npx playwright install chromium
```

Public checks only:

```sh
npm run test:lokasi
```

On Windows PowerShell, run the public and authenticated checks with a password prompt:

```powershell
./scripts/test-lokasi.ps1 -Email 'YOUR_TEST_ACCOUNT_EMAIL'
```

On another shell, set `LOKASI_EMAIL` and `LOKASI_PASSWORD` using your local secret manager, then run `npm run test:lokasi`. Do not put the password in source files, shell history, issue reports, or dashboard case descriptions. `LOKASI_BASE_URL` can override the target, but must be HTTPS.

The report is `lokasi-results/results.json`; a final-state screenshot for every executed case is stored in `lokasi-results/artifacts/`. This separate ignored directory survives the dashboard's own Playwright runs. The report and screenshots are generated locally and are not automatically uploaded by the test runner. The current mobile failure makes the suite exit nonzero. If the mobile case is required for a release plan, that release is blocked until the issue is resolved or the plan scope is deliberately changed.

## Map tests to Quality Hub

1. Create a **LOKASI Intelligence** project and **Development** environment.
2. Create and approve the five cases above, and collect them in a **LOKASI smoke** suite.
3. Freeze those case versions in a release plan targeting Development + `chromium`; start an automated run for the specific build.
4. Set these optional environment variables to the cases' `TC-…` IDs before Playwright runs. Without IDs, the imported tests remain unmatched for explicit mapping.

| Environment variable | Case |
| --- | --- |
| `LOKASI_CASE_SIGNIN` | Sign-in entry point renders |
| `LOKASI_CASE_EMPTY_EMAIL` | Continue disabled without email |
| `LOKASI_CASE_MOBILE` | Sign-in at 390 px mobile width |
| `LOKASI_CASE_EMAIL_STEP` | Known account advances to password |
| `LOKASI_CASE_AUTH_NAV` | Authorized account opens Intelligence modules |
| `LOKASI_CASE_SEARCH_MAP` | Place search selects Jakarta International Stadium |
| `LOKASI_CASE_DATASET_PREVIEW` | Partner dataset can be selected and previewed |
| `LOKASI_CASE_ANALYSIS_AREA` | Analysis requires a filter area |

5. Create an upload token in **Settings**, set `QA_UPLOAD_TOKEN` locally, then run `npm run upload -- --url YOUR_DASHBOARD_URL --run-id RUN_ID --report lokasi-results/results.json` on the machine where the screenshots were generated. The CLI imports the JSON first, then uploads each final-state screenshot to the matching execution's **Evidence & linked defects** panel. Repeating the same upload does not duplicate the report or images. If an image fails to upload, the execution result remains intact and the CLI can be retried.

Uploading only the JSON in the browser records screenshot paths, but browsers cannot read those local artifact paths from the report. In that case, add the images manually in each execution's **Upload screenshot** form.

Do not publish reports or screenshots publicly: they may include development-site names or imagery. The three-row synthetic fixture is the only dataset this exploration created; keep future write tests similarly isolated and agree on cleanup before expanding them.
