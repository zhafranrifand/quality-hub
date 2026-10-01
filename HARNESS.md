# Verification harness

Run `npm ci`, `npx playwright install chromium`, then `npm run verify`.

The harness stops on the first failing stage:

1. TypeScript checking and production build.
2. Vitest domain and API integration tests on isolated SQLite databases.
3. Playwright browser workflows against the compiled app, including mobile overflow and page-error checks.
4. Local database/reporting benchmark: 2,000 cases, 50,000 executions, 10-build dashboard trend; warm p95 <1 second and observed peak process memory <400 MB.

Test databases use unique directories in the task's `work/harness` directory. API and benchmark databases are removed after closing. Browser artifacts are retained for diagnosis; no production database is used. Browser tests start their own server on port 3107 with isolated test credentials, then stop it.

`npm audit --omit=dev` checks production dependency advisories separately. Live Railway deployment, credit consumption, and platform sleep/wake need actual Railway access; local tests do not certify those properties.

Multi-agent work was attempted with separate frontend, operations, and test ownership. The platform stopped all three agents at the account usage limit. Their partial frontend utilities were retained; the primary agent completed integration and verification.
