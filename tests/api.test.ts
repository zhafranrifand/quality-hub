import { beforeEach, afterEach, describe, it, expect } from "vitest";
import request from "supertest";
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
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
describe("private workspace API", () => {
  it("protects data, csrf, origin, upload token permissions, and revocation", async () => {
    for (const path of [
      "/projects",
      "/settings",
      "/backup",
      "/evidence/fake/file",
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
    const token = (
      await mutation("post", "/tokens").send({ name: "local" }).expect(201)
    ).body;
    await request(app.app)
      .get("/api/v1/projects")
      .set("Authorization", "Bearer " + token.token)
      .expect(403);
    await mutation("delete", `/tokens/${token.id}`).send({}).expect(200);
    await request(app.app)
      .post("/api/v1/runs/fake/imports/playwright")
      .set("Authorization", "Bearer " + token.token)
      .expect(401);
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
    const r = report(c.id, ["failed", "passed"]);
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
  it("accepts uploads with a dedicated token but does not grant read access", async () => {
    const { run, c } = await setup("automated");
    const token = (
      await mutation("post", "/tokens")
        .send({ name: "local-uploader" })
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
      .expect(403);
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
    const { run } = await setup("automated");
    const execution = (await importReport(run.id, report())).body.executions[0];
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#247357" },
    })
      .png()
      .toBuffer();
    const hash = createHash("sha256").update(image).digest("hex");
    const token = (
      await mutation("post", "/tokens")
        .send({ name: "screenshot-uploader" })
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
