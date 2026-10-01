import { beforeEach, afterEach, describe, it, expect } from "vitest";
import request from "supertest";
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth";
import { createBackup } from "../server/storage";
import { restoreBackup } from "../scripts/restore";
import { content, report } from "./fixtures";
const password = "Harness-private-password-123";
const passwordHash = hashPassword(password);
const origin = "http://localhost:3000";
let app: ReturnType<typeof createApp>,
  agent: ReturnType<typeof request.agent>,
  csrf: string,
  dir: string;
const mutation = (method: "post" | "put" | "patch" | "delete", path: string) =>
  agent[method]("/api/v1" + path)
    .set("Origin", origin)
    .set("x-csrf-token", csrf);
beforeEach(async () => {
  mkdirSync(resolve("../../work/harness"), { recursive: true });
  dir = mkdtempSync(resolve("../../work/harness/api-"));
  app = createApp({
    dataDir: dir,
    ownerEmail: "qa@example.com",
    passwordHash,
    publicOrigin: origin,
    quiet: true,
  });
  agent = request.agent(app.app);
  const login = await agent
    .post("/api/v1/auth/login")
    .send({ email: "qa@example.com", password });
  expect(login.status).toBe(200);
  csrf = login.body.csrf;
});
afterEach(() => {
  if (app.db.sqlite.open) app.db.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.VOLUME_CAPACITY_BYTES;
});
async function setup(kind = "manual") {
  const project = (
    await mutation("post", "/projects").send({ name: "Checkout" }).expect(201)
  ).body;
  const c = (
    await mutation("post", `/projects/${project.id}/cases`)
      .send(content)
      .expect(201)
  ).body;
  await mutation("post", `/cases/${c.id}/approve`).send({}).expect(200);
  const env = (
    await mutation("post", `/projects/${project.id}/environments`)
      .send({ name: "stage" })
      .expect(201)
  ).body;
  const release = (
    await mutation("post", `/projects/${project.id}/releases`)
      .send({ name: "v1" })
      .expect(201)
  ).body;
  const plan = (
    await mutation("post", `/releases/${release.id}/plans`)
      .send({
        name: "Smoke",
        items: [
          {
            versionId: c.versionId,
            environmentId: env.id,
            browser: "chromium",
          },
        ],
      })
      .expect(201)
  ).body;
  const run = (
    await mutation("post", `/plans/${plan.id}/runs`)
      .send({ build: "abc123", kind })
      .expect(201)
  ).body;
  return { project, c, env, release, plan, run };
}
async function get(path: string) {
  return (await agent.get("/api/v1" + path).expect(200)).body;
}
async function importReport(run: string, data: unknown) {
  return mutation("post", `/runs/${run}/imports/playwright`).attach(
    "report",
    Buffer.from(JSON.stringify(data)),
    "results.json",
  );
}
function automationScenario(
  key: string,
  updates: Record<string, unknown> = {},
) {
  return {
    key,
    title: "Email validation is enforced",
    featurePath: "tests/features/authentication.feature",
    gherkin:
      "Scenario: Email validation is enforced\n  When I continue without an email\n  Then validation is shown",
    background: ["Given I am on the sign-in page"],
    steps: [
      { keyword: "When", text: "I continue without an email" },
      { keyword: "Then", text: "validation is shown" },
    ],
    tags: ["authentication", `qh_key_${key}`],
    ...updates,
  };
}
function syncAutomation(
  planId: string,
  scenarios: Record<string, unknown>[],
  token?: string,
  browser = "chromium",
) {
  const req = token
    ? request(app.app)
        .post(`/api/v1/plans/${planId}/automation/sync`)
        .set("Authorization", `Bearer ${token}`)
    : mutation("post", `/plans/${planId}/automation/sync`);
  return req.send({ browser, scenarios });
}
async function addPlanItem(
  releaseId: string,
  name: string,
  versionId: string,
  environmentId: string,
  browser = "chromium",
) {
  return (
    await mutation("post", `/releases/${releaseId}/plans`)
      .send({
        name,
        items: [{ versionId, environmentId, browser }],
      })
      .expect(201)
  ).body;
}
describe("private workspace API", () => {
  it("migrates runner run scope and preserves token/case data from the prior schema", () => {
    const legacyDb = new Database(":memory:");
    try {
      legacyDb.exec(readFileSync(resolve("migrations/0000_flat_venus.sql"), "utf8"));
      legacyDb.exec(readFileSync(resolve("migrations/0001_new_epoch.sql"), "utf8"));
      legacyDb.exec(
        "INSERT INTO projects VALUES ('p','Project',1); INSERT INTO releases VALUES ('r','p','Release',1); INSERT INTO plans VALUES ('plan','r','Plan',1)",
      );
      legacyDb.exec(
        "INSERT INTO tokens (id,name,hash,createdAt,planId) VALUES ('old-runner','Old runner','h1',1,'plan'),('old-upload','Old upload','h2',2,NULL)",
      );
      legacyDb.exec(readFileSync(resolve("migrations/0002_stale_grim_reaper.sql"), "utf8"));
      legacyDb.exec(
        "INSERT INTO cases VALUES ('case','p','draft',3); INSERT INTO automation_sources VALUES ('source','p','sample_key','firefox','case',0,4); INSERT INTO runs (id,planId,build,kind,createdAt) VALUES ('run','plan','build-1','automated',5)",
      );
      legacyDb.exec(readFileSync(resolve("migrations/0003_runner_expected_scope.sql"), "utf8"));
      expect(
        legacyDb.prepare("SELECT scope FROM tokens WHERE id='old-runner'").get(),
      ).toEqual({ scope: "runner" });
      expect(
        legacyDb.prepare("SELECT scope FROM tokens WHERE id='old-upload'").get(),
      ).toEqual({ scope: "upload" });
      const runColumns = legacyDb
        .prepare("PRAGMA table_info(runs)")
        .all()
        .map((column: any) => column.name);
      expect(runColumns).toContain("expectedAutomationKeys");
      expect(runColumns).toContain("browser");
      expect(
        legacyDb
          .prepare("SELECT expectedAutomationKeys,browser FROM runs WHERE id='run'")
          .get(),
      ).toEqual({ expectedAutomationKeys: null, browser: null });
      const sourceColumns = legacyDb
        .prepare("PRAGMA table_info(automation_sources)")
        .all()
        .map((column: any) => column.name);
      expect(sourceColumns).toContain("browser");
      expect(
        legacyDb
          .prepare("SELECT id,browser,caseId FROM automation_sources WHERE id='source'")
          .get(),
      ).toEqual({ id: "source", browser: "firefox", caseId: "case" });
    } finally {
      legacyDb.close();
    }
  });
  it("protects data, csrf, origin, token permissions, and revocation", async () => {
    for (const path of [
      "/projects",
      "/settings",
      "/backup",
      "/evidence/fake/file",
      "/integrations/github/manifest",
    ])
      await request(app.app)
        .get("/api/v1" + path)
        .expect(401);
    await agent.post("/api/v1/projects").send({ name: "bad" }).expect(403);
    await agent
      .post("/api/v1/projects")
      .set("x-csrf-token", csrf)
      .set("Origin", "https://evil.example")
      .send({ name: "bad" })
      .expect(403);
    await mutation("post", "/tokens")
      .send({ name: "unscoped" })
      .expect(400);
    const { plan, project } = await setup();
    const other = await setup();
    await mutation("post", "/tokens")
      .send({ name: "old scope", scope: "runner", planId: plan.id })
      .expect(400);
    const token = (
      await mutation("post", "/tokens")
        .send({ name: "local read-only", planId: plan.id, scope: "read_only" })
        .expect(201)
    ).body;
    await request(app.app)
      .get("/api/v1/projects")
      .set("Authorization", "Bearer " + token.token)
      .expect(200);
    const plans = await request(app.app)
      .get("/api/v1/plans")
      .set("Authorization", "Bearer " + token.token)
      .expect(200);
    expect(plans.body.map((entry: any) => entry.id)).toEqual([plan.id]);
    await request(app.app)
      .get("/api/v1/integrations/github/manifest")
      .set("Authorization", "Bearer " + token.token)
      .expect(403);
    await agent.get("/api/v1/integrations/github/manifest").expect(503);
    const projects = await request(app.app)
      .get("/api/v1/projects")
      .set("Authorization", "Bearer " + token.token)
      .expect(200);
    expect(projects.body.map((entry: any) => entry.id)).toEqual([project.id]);
    await request(app.app)
      .get(`/api/v1/projects/${other.project.id}/state`)
      .set("Authorization", "Bearer " + token.token)
      .expect(403);
    await request(app.app)
      .get(`/api/v1/projects/${project.id}/dashboard?releaseId=${other.release.id}`)
      .set("Authorization", "Bearer " + token.token)
      .expect(403);
    await request(app.app)
      .get("/api/v1/settings")
      .set("Authorization", "Bearer " + token.token)
      .expect(403);
    expect(
      await request(app.app)
        .post(`/api/v1/plans/${plan.id}/automation/sync`)
        .set("Authorization", "Bearer " + token.token)
        .send({ browser: "chromium", scenarios: [] })
        .then((response) => response.status),
    ).toBe(403);
    await mutation("delete", `/tokens/${token.id}`).send({}).expect(200);
    await request(app.app)
      .post("/api/v1/runs/fake/imports/playwright")
      .set("Authorization", "Bearer " + token.token)
      .expect(401);
  });
  it("binds edit tokens to one plan and rejects legacy unscoped writes", async () => {
    const first = await setup("automated");
    const second = await setup("automated");
    app.db.run(
      "INSERT INTO executions (id,runId,title,browser) VALUES (?,?,?,?)",
      "foreign-execution",
      second.run.id,
      "Foreign plan execution",
      "chromium",
    );
    const editToken = (
      await mutation("post", "/tokens")
        .send({ name: "plan edit", planId: first.plan.id, scope: "edit" })
        .expect(201)
    ).body.token;
    const legacyToken = "legacy-unscoped-upload-token";
    app.db.run(
      "INSERT INTO tokens (id,name,hash,planId,scope,createdAt) VALUES (?,?,?,?,?,?)",
      "legacy-upload",
      "Legacy upload",
      createHash("sha256").update(legacyToken).digest("hex"),
      null,
      "upload",
      Date.now(),
    );

    for (const token of [editToken, legacyToken]) {
      await request(app.app)
        .post(`/api/v1/runs/${second.run.id}/imports/playwright`)
        .set("Authorization", `Bearer ${token}`)
        .attach("report", Buffer.from(JSON.stringify(report())), "results.json")
        .expect(403);
      await request(app.app)
        .post("/api/v1/executions/foreign-execution/evidence")
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
    }
  });
  it("scopes edit tokens to one plan and allows sync, run, and result operations", async () => {
    const first = await setup("automated");
    const second = await setup("automated");
    const key = "lokasi-auth-empty-email";
    const syncToken = (
      await mutation("post", "/tokens")
        .send({
          name: "feature edit",
          planId: first.plan.id,
          scope: "edit",
        })
        .expect(201)
    ).body.token;
    const syncResponse = await syncAutomation(
      first.plan.id,
      [automationScenario(key)],
      syncToken,
    ).expect(200);
    expect(syncResponse.body.scenarios[0].status).toBe("draft");

    await request(app.app)
      .post(`/api/v1/plans/${first.plan.id}/runs`)
      .set("Authorization", `Bearer ${syncToken}`)
      .send({ build: "no-run", kind: "automated", automationKeys: [key], browser: "chromium" })
      .expect(409);
    await syncAutomation(second.plan.id, [automationScenario(key)], syncToken)
      .expect(403);

    await mutation("post", `/cases/${syncResponse.body.scenarios[0].caseId}/approve`)
      .send({})
      .expect(200);
    const sourcePlan = await addPlanItem(
      first.release.id,
      "Automation",
      syncResponse.body.scenarios[0].versionId,
      first.env.id,
    );
    const token = (
      await mutation("post", "/tokens")
        .send({ name: "lokasi edit", planId: sourcePlan.id, scope: "edit" })
        .expect(201)
    ).body.token;
    const runner = (method: "post" | "get", path: string) =>
      request(app.app)
        [method]("/api/v1" + path)
        .set("Authorization", `Bearer ${token}`);

    const created = await runner("post", `/plans/${sourcePlan.id}/runs`)
      .send({ build: "ci-42", kind: "automated", automationKeys: [key], browser: "chromium" })
      .expect(201);
    expect(created.body.planId).toBe(sourcePlan.id);
    expect(created.body.kind).toBe("automated");
    expect(
      app.db.one(
        "SELECT expectedAutomationKeys,browser FROM runs WHERE id=?",
        created.body.id,
      ),
    ).toEqual({
      expectedAutomationKeys: JSON.stringify([key]),
      browser: "chromium",
    });
    const preflight = (body: Record<string, unknown>) =>
      runner("post", `/plans/${sourcePlan.id}/automation/preflight`).send(body);
    const existingRunScope = {
      runId: created.body.id,
      automationKeys: [key],
      browser: "chromium",
      build: "ci-42",
    };
    await preflight(existingRunScope).expect(200);
    const buildMismatch = await preflight({
      ...existingRunScope,
      build: "different-build",
    }).expect(409);
    expect(buildMismatch.body.error).toMatch(/QA_BUILD_ID/i);
    const browserMismatch = await preflight({
      ...existingRunScope,
      browser: "firefox",
    }).expect(409);
    expect(browserMismatch.body.error).toMatch(/QA_BROWSER/i);
    await preflight({
      ...existingRunScope,
      automationKeys: ["different_scenario"],
    }).expect(409);

    await runner("post", `/plans/${sourcePlan.id}/runs`)
      .send({ build: "manual-attempt", kind: "manual", automationKeys: [key] })
      .expect(403);
    await runner("post", `/plans/${second.plan.id}/runs`)
      .send({ build: "other-plan", kind: "automated", automationKeys: [key], browser: "chromium" })
      .expect(403);
    await runner("get", "/projects").expect(200);
    await runner("post", `/plans/${sourcePlan.id}/automation/sync`)
      .send({ browser: "chromium", scenarios: [automationScenario(key)] })
      .expect(200);
    await runner("post", `/runs/${second.run.id}/imports/playwright`)
      .attach("report", Buffer.from(JSON.stringify(report())), "results.json")
      .expect(403);

    const imported = await runner(
      "post",
      `/runs/${created.body.id}/imports/playwright`,
    )
      .attach(
        "report",
        Buffer.from(JSON.stringify(report(null, ["passed"], { browser: "firefox" }))),
        "wrong-browser.json",
      )
      .expect(400);
    expect(imported.body.error).toMatch(/browser must match/i);
    expect(app.db.one("SELECT count(*) AS count FROM imports WHERE runId=?", created.body.id).count).toBe(0);
    const successfulImport = await runner(
      "post",
      `/runs/${created.body.id}/imports/playwright`,
    )
      .attach(
        "report",
        Buffer.from(JSON.stringify(report(null, ["passed"], { tags: [`qh_key_${key}`] }))),
        "results.json",
      )
      .expect(201);
    expect(successfulImport.body.executions).toHaveLength(1);
    expect(successfulImport.body.executions[0].planItemId).toBeTruthy();
    expect(successfulImport.body.executions[0].automationKey).toBe(key);
    expect(successfulImport.body.complete).toBe(true);
  });
  it("creates automated drafts idempotently and revisions changed source without changing a frozen plan", async () => {
    const base = await setup();
    const key = "lokasi_auth_empty_email";
    const initial = automationScenario(key);
    const first = await syncAutomation(base.plan.id, [initial]).expect(200);
    const firstCase = first.body.scenarios[0];
    expect(firstCase.status).toBe("draft");
    expect(firstCase.planned).toBe(false);
    expect(firstCase.ready).toBe(false);
    const versionCount = app.db.one(
      "SELECT count(*) AS count FROM versions WHERE caseId=?",
      firstCase.caseId,
    ).count;

    const repeated = await syncAutomation(base.plan.id, [initial]).expect(200);
    expect(repeated.body.scenarios[0].caseId).toBe(firstCase.caseId);
    expect(repeated.body.scenarios[0].versionId).toBe(firstCase.versionId);
    expect(
      app.db.one(
        "SELECT count(*) AS count FROM versions WHERE caseId=?",
        firstCase.caseId,
      ).count,
    ).toBe(versionCount);

    await mutation("post", `/cases/${firstCase.caseId}/approve`)
      .send({})
      .expect(200);
    const frozenPlan = await addPlanItem(
      base.release.id,
      "Frozen automated scope",
      firstCase.versionId,
      base.env.id,
    );
    const frozenItemsBefore = app.db.all(
      "SELECT id,versionId,environmentId,browser FROM plan_items WHERE planId=?",
      frozenPlan.id,
    );
    const oldVersionContent = app.db.one(
      "SELECT content FROM versions WHERE id=?",
      firstCase.versionId,
    ).content;

    const changed = await syncAutomation(frozenPlan.id, [
      automationScenario(key, {
        title: "Email validation remains enforced",
        gherkin:
          "Scenario: Email validation remains enforced\n  When I continue without an email\n  Then validation is still shown",
      }),
    ]).expect(200);
    const changedCase = changed.body.scenarios[0];
    expect(changedCase.caseId).toBe(firstCase.caseId);
    expect(changedCase.versionId).not.toBe(firstCase.versionId);
    expect(changedCase.status).toBe("draft");
    expect(changedCase.planned).toBe(true);
    expect(changedCase.ready).toBe(false);
    expect(
      app.db.all(
        "SELECT id,versionId,environmentId,browser FROM plan_items WHERE planId=?",
        frozenPlan.id,
      ),
    ).toEqual(frozenItemsBefore);
    expect(
      app.db.one("SELECT content FROM versions WHERE id=?", firstCase.versionId)
        .content,
    ).toBe(oldVersionContent);
    expect(app.db.one("SELECT approved FROM versions WHERE id=?", firstCase.versionId).approved).toBe(1);
  });
  it("keeps missing, unkeyed, and unexpected Playwright results incomplete and unmatched", async () => {
    const base = await setup();
    const key = "lokasi_auth_expected_result";
    const synced = await syncAutomation(base.plan.id, [
      automationScenario(key),
    ]).expect(200);
    const { caseId, versionId } = synced.body.scenarios[0];
    await mutation("post", `/cases/${caseId}/approve`).send({}).expect(200);
    const plan = await addPlanItem(
      base.release.id,
      "Expected key scope",
      versionId,
      base.env.id,
    );
    const token = (
      await mutation("post", "/tokens")
        .send({ name: "expected key edit", planId: plan.id, scope: "edit" })
        .expect(201)
    ).body.token;
    const createRun = (build: string) =>
      request(app.app)
        .post(`/api/v1/plans/${plan.id}/runs`)
        .set("Authorization", `Bearer ${token}`)
        .send({ build, kind: "automated", automationKeys: [key], browser: "chromium" })
        .expect(201);

    const missingRun = await createRun("missing-key-build");
    const missingImport = await request(app.app)
      .post(`/api/v1/runs/${missingRun.body.id}/imports/playwright`)
      .set("Authorization", `Bearer ${token}`)
      .attach("report", Buffer.from(JSON.stringify(report(caseId))), "results.json")
      .expect(201);
    expect(missingImport.body.complete).toBe(false);
    expect(missingImport.body.missingAutomationKeys).toEqual([key]);
    expect(missingImport.body.unkeyedResults).toBe(1);
    expect(missingImport.body.executions[0].planItemId).toBeNull();
    expect(
      app.db.one("SELECT complete FROM runs WHERE id=?", missingRun.body.id).complete,
    ).toBe(0);

    const unexpectedRun = await createRun("unexpected-key-build");
    const unexpectedImport = await request(app.app)
      .post(`/api/v1/runs/${unexpectedRun.body.id}/imports/playwright`)
      .set("Authorization", `Bearer ${token}`)
      .attach(
        "report",
        Buffer.from(
          JSON.stringify(
            report(caseId, ["passed"], {
              tags: ["qh_key_unexpected_result"],
            }),
          ),
        ),
        "results.json",
      )
      .expect(201);
    expect(unexpectedImport.body.complete).toBe(false);
    expect(unexpectedImport.body.unexpectedAutomationKeys).toEqual([
      "unexpected_result",
    ]);
    expect(unexpectedImport.body.executions[0].planItemId).toBeNull();
    expect(
      app.db.one("SELECT complete FROM runs WHERE id=?", unexpectedRun.body.id)
        .complete,
    ).toBe(0);
  });
  it("links legacy manual cases while preserving their Hub-authored steps", async () => {
    const base = await setup();
    const legacy = (
      await mutation("post", `/projects/${base.project.id}/cases`)
        .send({
          ...content,
          title: "Existing manual login case",
          preconditions: "Hub-owned account setup",
          steps: [
            { action: "Manually enter a blank email", expected: "Inline warning" },
            { action: "Inspect the recovery link", expected: "Link remains visible" },
          ],
          executionMode: "manual",
        })
        .expect(201)
    ).body;
    const source = automationScenario("lokasi_auth_empty_email", {
      legacyCaseId: legacy.id,
    });
    const sync = await syncAutomation(base.plan.id, [source]).expect(200);
    expect(sync.body.scenarios[0].caseId).toBe(legacy.id);
    let versions = await get(`/cases/${legacy.id}/versions`);
    expect(versions[0].content.executionMode).toBe("both");
    expect(versions[0].content.preconditions).toBe("Hub-owned account setup");
    expect(versions[0].content.steps).toEqual([
      { action: "Manually enter a blank email", expected: "Inline warning" },
      { action: "Inspect the recovery link", expected: "Link remains visible" },
    ]);
    expect(versions[0].content.automationSource.gherkin).toBe(source.gherkin);

    await syncAutomation(base.plan.id, [
      automationScenario("lokasi_auth_empty_email", {
        title: "Revised automated title",
        gherkin: "Scenario: Revised automated title\n  Then a warning remains",
      }),
    ]).expect(200);
    versions = await get(`/cases/${legacy.id}/versions`);
    expect(versions).toHaveLength(3);
    expect(versions[0].content.executionMode).toBe("both");
    expect(versions[0].content.steps).toEqual([
      { action: "Manually enter a blank email", expected: "Inline warning" },
      { action: "Inspect the recovery link", expected: "Link remains visible" },
    ]);
    expect(versions[0].content.automationSource.gherkin).toContain(
      "Revised automated title",
    );
    const edit = await mutation("put", `/cases/${legacy.id}`)
      .send({
        ...content,
        title: "Dashboard title must not override the repository",
        priority: "low",
        steps: [{ action: "Overwrite attempt", expected: "Must stay unchanged" }],
      })
      .expect(200);
    expect(edit.body.title).toBe("Revised automated title");
    versions = await get(`/cases/${legacy.id}/versions`);
    expect(versions[0].content.title).toBe("Revised automated title");
    expect(versions[0].content.priority).toBe("low");
    expect(versions[0].content.executionMode).toBe("both");
    expect(versions[0].content.steps).toEqual([
      { action: "Manually enter a blank email", expected: "Inline warning" },
      { action: "Inspect the recovery link", expected: "Link remains visible" },
    ]);
    expect(versions[0].content.automationSource.gherkin).toContain(
      "Revised automated title",
    );
  });
  it("uses the same stable-key validation for sync and imports and rejects outlines", async () => {
    const base = await setup("automated");
    const invalidKey = "Lokasi_auth_empty_email";
    await syncAutomation(base.plan.id, [
      automationScenario(invalidKey, { tags: [`qh_key_${invalidKey}`] }),
    ]).expect(400);
    const invalidImport = await importReport(
      base.run.id,
      report(null, ["passed"], { tags: [`qh_key_${invalidKey}`] }),
    );
    expect(invalidImport.status).toBe(400);
    await syncAutomation(base.plan.id, [
      automationScenario("lokasi_auth_outline", {
        gherkin: "Scenario Outline: Examples are expanded",
      }),
    ]).expect(400);
    expect((await get(`/runs/${base.run.id}`)).executions).toHaveLength(0);
  });
  it("does not resurrect a deprecated synchronized case", async () => {
    const base = await setup();
    const key = "lokasi_auth_deprecated_case";
    const first = await syncAutomation(base.plan.id, [
      automationScenario(key),
    ]).expect(200);
    const caseId = first.body.scenarios[0].caseId;
    await mutation("post", `/cases/${caseId}/deprecate`).send({}).expect(200);
    const versionCount = app.db.one(
      "SELECT count(*) AS count FROM versions WHERE caseId=?",
      caseId,
    ).count;

    await syncAutomation(base.plan.id, [
      automationScenario(key, { title: "Changed after deprecation" }),
    ]).expect(409);
    expect(app.db.one("SELECT status FROM cases WHERE id=?", caseId).status).toBe(
      "deprecated",
    );
    expect(
      app.db.one(
        "SELECT count(*) AS count FROM versions WHERE caseId=?",
        caseId,
      ).count,
    ).toBe(versionCount);
  });
  it("rejects automation preflight when multiple environments make import ambiguous", async () => {
    const base = await setup();
    const key = "lokasi_auth_ambiguous_environment";
    const synced = await syncAutomation(base.plan.id, [
      automationScenario(key),
    ]).expect(200);
    const { caseId, versionId } = synced.body.scenarios[0];
    await mutation("post", `/cases/${caseId}/approve`).send({}).expect(200);
    const secondEnvironment = (
      await mutation("post", `/projects/${base.project.id}/environments`)
        .send({ name: "qa" })
        .expect(201)
    ).body;
    const ambiguousPlan = (
      await mutation("post", `/releases/${base.release.id}/plans`)
        .send({
          name: "Ambiguous automation scope",
          items: [
            { versionId, environmentId: base.env.id, browser: "chromium" },
            {
              versionId,
              environmentId: secondEnvironment.id,
              browser: "chromium",
            },
          ],
        })
        .expect(201)
    ).body;
    const resync = await syncAutomation(ambiguousPlan.id, [
      automationScenario(key),
    ]).expect(200);
    expect(resync.body.scenarios[0].planned).toBe(true);
    expect(resync.body.scenarios[0].ready).toBe(false);
    expect(resync.body.scenarios[0].reason).toMatch(/multiple planned environment/i);

    const runnerToken = (
      await mutation("post", "/tokens")
        .send({ name: "ambiguous edit", planId: ambiguousPlan.id, scope: "edit" })
        .expect(201)
    ).body.token;
    const before = app.db.one("SELECT count(*) AS count FROM runs").count;
    const rejected = await request(app.app)
      .post(`/api/v1/plans/${ambiguousPlan.id}/runs`)
      .set("Authorization", `Bearer ${runnerToken}`)
      .send({ build: "ambiguous-build", kind: "automated", automationKeys: [key], browser: "chromium" })
      .expect(409);
    expect(rejected.body.scenarios[0].reason).toMatch(/multiple planned environment/i);
    expect(app.db.one("SELECT count(*) AS count FROM runs").count).toBe(before);
  });
  it("requires the synced browser to exist in the exact frozen plan", async () => {
    const base = await setup();
    const key = "lokasi_auth_browser_scope";
    const synced = await syncAutomation(
      base.plan.id,
      [automationScenario(key)],
      undefined,
      "firefox",
    ).expect(200);
    const { caseId, versionId } = synced.body.scenarios[0];
    await mutation("post", `/cases/${caseId}/approve`).send({}).expect(200);
    const firefoxPlan = await addPlanItem(
      base.release.id,
      "Firefox only",
      versionId,
      base.env.id,
      "firefox",
    );
    const token = (
      await mutation("post", "/tokens")
        .send({ name: "browser edit", planId: firefoxPlan.id, scope: "edit" })
        .expect(201)
    ).body.token;
    const before = app.db.one("SELECT count(*) AS count FROM runs").count;
    const response = await request(app.app)
      .post(`/api/v1/plans/${firefoxPlan.id}/runs`)
      .set("Authorization", `Bearer ${token}`)
      .send({ build: "wrong-browser", kind: "automated", automationKeys: [key], browser: "chromium" })
      .expect(409);
    expect(response.body.scenarios[0].reason).toMatch(/not in this plan.*browser/i);
    expect(app.db.one("SELECT count(*) AS count FROM runs").count).toBe(before);
  });
  it("uses the requested browser for readiness without global browser mapping state", async () => {
    const base = await setup();
    const key = "lokasi_auth_multi_browser";
    const synced = await syncAutomation(base.plan.id, [
      automationScenario(key),
    ]).expect(200);
    const { caseId, versionId } = synced.body.scenarios[0];
    await mutation("post", `/cases/${caseId}/approve`).send({}).expect(200);
    const chromiumPlan = await addPlanItem(
      base.release.id,
      "Chromium target",
      versionId,
      base.env.id,
      "chromium",
    );
    const firefoxPlan = await addPlanItem(
      base.release.id,
      "Firefox target",
      versionId,
      base.env.id,
      "firefox",
    );

    const firefoxSync = await syncAutomation(
      firefoxPlan.id,
      [automationScenario(key)],
      undefined,
      "firefox",
    ).expect(200);
    expect(firefoxSync.body.scenarios[0].ready).toBe(true);
    expect(firefoxSync.body.scenarios[0].versionId).toBe(versionId);
    const chromiumSync = await syncAutomation(
      chromiumPlan.id,
      [automationScenario(key)],
      undefined,
      "chromium",
    ).expect(200);
    expect(chromiumSync.body.scenarios[0].ready).toBe(true);
    expect(chromiumSync.body.scenarios[0].versionId).toBe(versionId);
    expect(
      app.db
        .all("PRAGMA table_info(automation_sources)")
        .map((column: any) => column.name),
    ).toContain("browser");
  });
  it("rejects runner creation and reused-run preflight before creating a run when a key is draft", async () => {
    const base = await setup();
    const key = "lokasi_auth_empty_email";
    const synced = await syncAutomation(base.plan.id, [automationScenario(key)]).expect(200);
    await mutation("post", `/cases/${synced.body.scenarios[0].caseId}/approve`)
      .send({})
      .expect(200);
    const scopedPlan = await addPlanItem(
      base.release.id,
      "Runner reuse plan",
      synced.body.scenarios[0].versionId,
      base.env.id,
    );
    const token = (
      await mutation("post", "/tokens")
        .send({ name: "edit preflight", planId: scopedPlan.id, scope: "edit" })
        .expect(201)
    ).body.token;
    const runnerScoped = (path: string) =>
      request(app.app)
        .post(`/api/v1${path}`)
        .set("Authorization", `Bearer ${token}`);
    const created = await runnerScoped(`/plans/${scopedPlan.id}/runs`)
      .send({ build: "reuse-build", kind: "automated", automationKeys: [key], browser: "chromium" })
      .expect(201);
    const before = app.db.one("SELECT count(*) AS count FROM runs").count;

    await syncAutomation(scopedPlan.id, [
      automationScenario(key, { title: "Changed after run creation" }),
    ]).expect(200);
    const rejectedCreate = await runnerScoped(`/plans/${scopedPlan.id}/runs`)
      .send({ build: "blocked-build", kind: "automated", automationKeys: [key], browser: "chromium" })
      .expect(409);
    expect(rejectedCreate.body.scenarios[0].status).toBe("draft");
    expect(rejectedCreate.body.scenarios[0].reason).toMatch(/approval/i);
    const rejectedReuse = await runnerScoped(
      `/plans/${scopedPlan.id}/automation/preflight`,
    )
      .send({ runId: created.body.id, automationKeys: [key], browser: "chromium", build: "reuse-build" })
      .expect(409);
    expect(rejectedReuse.body.ready).toBe(false);
    expect(rejectedReuse.body.scenarios[0].reason).toMatch(/approval/i);
    expect(app.db.one("SELECT count(*) AS count FROM runs").count).toBe(before);
  });
  it("retains frozen case content and prior attempts across revisions; gates are build scoped", async () => {
    const { c, run, release, plan } = await setup();
    const e = (await get(`/runs/${run.id}`)).executions[0];
    await mutation("post", `/executions/${e.id}/attempts`)
      .send({ status: "failed", note: "first try" })
      .expect(201);
    await mutation("post", `/executions/${e.id}/attempts`)
      .send({ status: "passed", note: "fixed" })
      .expect(201);
    await mutation("put", `/cases/${c.id}`)
      .send({ ...content, title: "Updated title" })
      .expect(200);
    const detail = await get(`/runs/${run.id}`);
    expect(detail.executions[0].content.title).toBe(content.title);
    expect(detail.executions[0].attempts).toHaveLength(2);
    expect(
      (await get(`/releases/${release.id}/readiness?build=abc123`)).status,
    ).toBe("At risk");
    expect(
      (await get(`/releases/${release.id}/readiness?build=other`)).status,
    ).toBe("Unknown");
    const next = (
      await mutation("post", `/plans/${plan.id}/runs`).send({
        build: "abc123",
        kind: "manual",
      })
    ).body;
    expect(next.id).toBeTruthy();
    expect(
      (await get(`/releases/${release.id}/readiness?build=abc123`)).status,
    ).toBe("Unknown");
  });
  it("makes critical release defects override passing results", async () => {
    const { run, release, project } = await setup();
    const ex = (await get(`/runs/${run.id}`)).executions[0];
    await mutation("post", `/executions/${ex.id}/attempts`)
      .send({ status: "passed" })
      .expect(201);
    await mutation("post", `/projects/${project.id}/defects`)
      .send({
        releaseId: release.id,
        title: "Lost payment",
        severity: "critical",
      })
      .expect(201);
    const g = await get(`/releases/${release.id}/readiness?build=abc123`);
    expect(g.status).toBe("Blocked");
    expect(g.passRate).toBe(100);
  });
  it("counts a case/environment/browser only once across plans in one release", async () => {
    const { c, env, release } = await setup();
    const secondPlan = (
      await mutation("post", `/releases/${release.id}/plans`)
        .send({
          name: "Expanded smoke",
          items: [
            {
              versionId: c.versionId,
              environmentId: env.id,
              browser: "chromium",
            },
          ],
        })
        .expect(201)
    ).body;
    const secondRun = (
      await mutation("post", `/plans/${secondPlan.id}/runs`)
        .send({ build: "build-two", kind: "manual" })
        .expect(201)
    ).body;
    const execution = (await get(`/runs/${secondRun.id}`)).executions[0];
    await mutation("post", `/executions/${execution.id}/attempts`)
      .send({ status: "passed" })
      .expect(201);
    const gate = await get(`/releases/${release.id}/readiness?build=build-two`);
    expect(gate.rows).toHaveLength(1);
    expect(gate.counts.passed).toBe(1);
    expect(gate.completion).toBe(100);
    expect(gate.status).toBe("Ready");
  });
  it("imports retries exactly once, preserves errors, verifies coverage, rejects corrections", async () => {
    const { run, c, release, project } = await setup("automated");
    const r = report(null, ["failed", "passed"], { tags: [c.id] });
    await (
      await importReport(run.id, r)
    ).status;
    const duplicate = await importReport(run.id, r);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.executions).toHaveLength(1);
    expect(duplicate.body.executions[0].attachments[0].name).toBe("trace");
    const detail = await get(`/runs/${run.id}`);
    expect(detail.executions).toHaveLength(1);
    expect(detail.executions[0].attempts).toHaveLength(2);
    expect(detail.executions[0].attempts[0].error).toContain("confirmation");
    const g = await get(`/releases/${release.id}/readiness?build=abc123`);
    expect(g.status).toBe("At risk");
    expect(g.counts.passed).toBe(1);
    expect(
      (await get(`/projects/${project.id}/state`)).automationCoverage,
    ).toBe(100);
    expect((await importReport(run.id, report(c.id))).status).toBe(409);
  });
  it("allows edit tokens to upload results and read their plan", async () => {
    const { run, c, plan } = await setup("automated");
    const token = (
      await mutation("post", "/tokens")
        .send({ name: "local-editor", planId: plan.id, scope: "edit" })
        .expect(201)
    ).body;
    const imported = await request(app.app)
      .post(`/api/v1/runs/${run.id}/imports/playwright`)
      .set("Authorization", "Bearer " + token.token)
      .attach(
        "report",
        Buffer.from(JSON.stringify(report(c.id))),
        "results.json",
      );
    expect(imported.status).toBe(201);
    expect(imported.body.executions).toHaveLength(1);
    await request(app.app)
      .get(`/api/v1/runs/${run.id}`)
      .set("Authorization", "Bearer " + token.token)
      .expect(200);
  });
  it("keeps malformed imports atomic and unmatched tests out of gate until explicitly mapped", async () => {
    const { run, release, plan } = await setup("automated");
    expect(
      (
        await importReport(run.id, {
          suites: [{ specs: [{ title: "bad", tests: [{}] }] }],
        })
      ).status,
    ).toBe(400);
    expect((await get(`/runs/${run.id}`)).executions).toHaveLength(0);
    expect((await importReport(run.id, report(null))).status).toBe(201);
    let detail = await get(`/runs/${run.id}`);
    expect(detail.unmatched).toHaveLength(1);
    expect(
      (await get(`/releases/${release.id}/readiness?build=abc123`)).status,
    ).toBe("Unknown");
    await mutation("post", `/executions/${detail.unmatched[0].id}/map`)
      .send({ planItemId: plan.items[0].id })
      .expect(200);
    expect(
      (await get(`/releases/${release.id}/readiness?build=abc123`)).status,
    ).toBe("Ready");
  });
  it("stores validated screenshots, rejects invalid/quota uploads without removing results, and restores backup", async () => {
    const { run } = await setup();
    const ex = (await get(`/runs/${run.id}`)).executions[0];
    await mutation("post", `/executions/${ex.id}/attempts`)
      .send({ status: "passed" })
      .expect(201);
    await mutation("post", `/executions/${ex.id}/evidence`)
      .attach("screenshot", Buffer.from("not an image"), "fake.png")
      .expect(400);
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#247357" },
    })
      .png()
      .toBuffer();
    const ev = (
      await mutation("post", `/executions/${ex.id}/evidence`)
        .attach("screenshot", png, "proof.png")
        .expect(201)
    ).body;
    await request(app.app).get(`/api/v1/evidence/${ev.id}/file`).expect(401);
    await agent.get(`/api/v1/evidence/${ev.id}/file`).expect(200);
    process.env.VOLUME_CAPACITY_BYTES = "100";
    await mutation("post", `/executions/${ex.id}/evidence`)
      .attach("screenshot", png, "quota.png")
      .expect(507);
    expect((await get(`/runs/${run.id}`)).executions[0].attempts).toHaveLength(
      1,
    );
    delete process.env.VOLUME_CAPACITY_BYTES;
    const backup = await createBackup(app.db);
    const target = join(dir, "restored");
    try {
      await restoreBackup(backup.path, target);
      const restored = createApp({
        dataDir: target,
        ownerEmail: "qa@example.com",
        passwordHash,
        quiet: true,
      });
      expect(restored.db.one("SELECT count(*) n FROM attempts").n).toBe(1);
      expect(restored.db.one("SELECT count(*) n FROM sessions").n).toBe(0);
      expect(restored.db.one("SELECT count(*) n FROM evidence").n).toBe(1);
      restored.db.sqlite.close();
      await expect(restoreBackup(backup.path, target)).rejects.toThrow("empty");
    } finally {
      backup.cleanup();
    }
  });
  it("attaches automatic screenshots once even after an upload retry", async () => {
    const { run, plan } = await setup("automated");
    const execution = (await importReport(run.id, report())).body.executions[0];
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#247357" },
    })
      .png()
      .toBuffer();
    const hash = createHash("sha256").update(image).digest("hex");
    const token = (
      await mutation("post", "/tokens")
        .send({
          name: "screenshot-uploader",
          planId: plan.id,
          scope: "edit",
        })
        .expect(201)
    ).body.token;
    const upload = (sourceHash: string) =>
      request(app.app)
        .post(`/api/v1/executions/${execution.id}/evidence`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-qa-evidence-sha256", sourceHash)
        .attach("screenshot", image, "capture.png");
    const first = await upload(hash).expect(201);
    const second = await upload(hash).expect(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);
    await upload("0".repeat(64)).expect(400);
    expect((await get(`/runs/${run.id}`)).executions[0].evidence).toHaveLength(
      1,
    );
  });
  it("keeps data and sessions after restart and rejects cross-project links", async () => {
    const { project, c } = await setup();
    const other = (await mutation("post", "/projects").send({ name: "Other" }))
      .body;
    await mutation("post", `/projects/${other.id}/suites`)
      .send({ name: "Wrong", caseIds: [c.id] })
      .expect(400);
    app.db.sqlite.close();
    app = createApp({
      dataDir: dir,
      ownerEmail: "qa@example.com",
      passwordHash,
      quiet: true,
    });
    const rows = app.db.all("SELECT * FROM projects WHERE id=?", project.id);
    expect(rows).toHaveLength(1);
  });
});
