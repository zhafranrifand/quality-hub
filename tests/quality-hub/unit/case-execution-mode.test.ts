import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../server/app";
import { hashPassword } from "../../../server/auth";
import { caseInput } from "../../../shared/contracts";
import { content } from "../fixtures";

const origin = "http://localhost:3000";
const password = "Case-execution-mode-test-password-123";
let dir: string;
let app: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;
let csrf: string;

const mutation = (method: "post" | "put", path: string) =>
  agent[method](`/api/v1${path}`)
    .set("Origin", origin)
    .set("x-csrf-token", csrf);
const get = (path: string) => agent.get(`/api/v1${path}`).expect(200);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "quality-hub-execution-mode-"));
  app = createApp({
    dataDir: dir,
    ownerEmail: "qa@example.com",
    passwordHash: hashPassword(password),
    publicOrigin: origin,
    quiet: true,
  });
  agent = request.agent(app.app);
  const login = await agent
    .post("/api/v1/auth/login")
    .send({ email: "qa@example.com", password })
    .expect(200);
  csrf = login.body.csrf;
});

afterEach(() => {
  if (app.db.sqlite.open) app.db.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

async function createCase() {
  const project = (
    await mutation("post", "/projects")
      .send({ name: "Execution mode project" })
      .expect(201)
  ).body;
  const testCase = (
    await mutation("post", `/projects/${project.id}/cases`)
      .send(content)
      .expect(201)
  ).body;
  return { project, testCase };
}

describe("test case execution mode contract", () => {
  it("defaults omitted API input to both and rejects invalid values", async () => {
    expect(caseInput.parse(content).executionMode).toBe("both");
    for (const mode of ["manual", "automated", "both"])
      expect(
        caseInput.parse({ ...content, executionMode: mode }).executionMode,
      ).toBe(mode);

    const project = (
      await mutation("post", "/projects")
        .send({ name: "Execution mode project" })
        .expect(201)
    ).body;
    await mutation("post", `/projects/${project.id}/cases`)
      .send({ ...content, executionMode: "scripted" })
      .expect(400);

    const testCase = (
      await mutation("post", `/projects/${project.id}/cases`)
        .send(content)
        .expect(201)
    ).body;
    expect(testCase.executionMode).toBe("both");
    await mutation("put", `/cases/${testCase.id}`)
      .send({ ...content, executionMode: "scripted" })
      .expect(400);
    expect((await get(`/cases/${testCase.id}/versions`)).body).toHaveLength(1);
    const defaultedRevision = (
      await mutation("put", `/cases/${testCase.id}`)
        .send({ ...content, title: "Defaulted revision" })
        .expect(200)
    ).body;
    expect(defaultedRevision.executionMode).toBe("both");
  });

  it("reads a legacy approved version as both in project state without changing stored JSON", async () => {
    const { project, testCase } = await createCase();
    await mutation("post", `/cases/${testCase.id}/approve`)
      .send({})
      .expect(200);
    const legacyContent = JSON.stringify(content);
    app.db.run(
      "UPDATE versions SET content=? WHERE id=?",
      legacyContent,
      testCase.versionId,
    );

    const state = (await get(`/projects/${project.id}/state`)).body;
    expect(state.cases[0].executionMode).toBe("both");
    expect(state.cases[0].approved).toBe(1);
    expect(
      (await get(`/cases/${testCase.id}/versions`)).body[0].content
        .executionMode,
    ).toBe("both");
    expect(
      app.db.one("SELECT content FROM versions WHERE id=?", testCase.versionId)
        .content,
    ).toBe(legacyContent);
  });

  it("includes mode in a PUT revision while preserving the prior raw version", async () => {
    const { project, testCase } = await createCase();
    await mutation("post", `/cases/${testCase.id}/approve`)
      .send({})
      .expect(200);
    const legacyContent = JSON.stringify(content);
    app.db.run(
      "UPDATE versions SET content=? WHERE id=?",
      legacyContent,
      testCase.versionId,
    );

    const revised = (
      await mutation("put", `/cases/${testCase.id}`)
        .send({
          ...content,
          title: "Revised checkout",
          executionMode: "manual",
        })
        .expect(200)
    ).body;
    expect(revised.executionMode).toBe("manual");
    const versions = (await get(`/cases/${testCase.id}/versions`)).body;
    expect(versions.map((v: { number: number }) => v.number)).toEqual([2, 1]);
    expect(versions[0].content.executionMode).toBe("manual");
    expect(versions[0].content.title).toBe("Revised checkout");
    expect(versions[1].content.title).toBe(content.title);
    expect(versions[1].content.executionMode).toBe("both");
    expect(versions[1].approved).toBe(1);
    expect(
      app.db.one("SELECT content FROM versions WHERE id=?", testCase.versionId)
        .content,
    ).toBe(legacyContent);
    expect(
      (await get(`/projects/${project.id}/state`)).body.cases[0].executionMode,
    ).toBe("manual");
  });
});
