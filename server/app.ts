import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { z } from "zod";
import { openStore, type Store } from "./db.js";
import * as t from "./schema.js";
import {
  caseInput,
  nameSchema,
  statusSchema,
  idSchema,
  automationRunRequestSchema,
  automationPreflightRequestSchema,
  automationSyncRequestSchema,
  caseVersionSchema,
} from "../shared/contracts.js";
import { digest, secret, verifyPassword, cookieToken } from "./auth.js";
import { parseReport } from "./playwright.js";
import { projectState, releaseGate } from "./reporting.js";
import {
  storageInfo,
  assertStorage,
  saveScreenshot,
  createBackup,
  backupRunning,
} from "./storage.js";
import { loadGithubManifest, type GithubSourceConfig } from "./github-source.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const urlSchema = z
  .string()
  .url()
  .max(2000)
  .refine((s) => new URL(s).protocol === "https:", "Use an HTTPS link");
const id = () => randomUUID();
export type AppConfig = {
  dataDir: string;
  ownerEmail: string;
  passwordHash: string;
  publicOrigin?: string;
  production?: boolean;
  quiet?: boolean;
  githubSource?: GithubSourceConfig;
};
export function createApp(config: AppConfig) {
  const db = openStore(config.dataDir),
    app = express();
  const origin = config.publicOrigin || "http://localhost:3000";
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "blob:", "data:"],
          "script-src": ["'self'"],
          "connect-src": ["'self'"],
        },
      },
      strictTransportSecurity: config.production ? undefined : false,
    }),
  );
  app.use((req, res, next) => {
    const requestId = id();
    res.setHeader("X-Request-ID", requestId);
    res.locals.requestId = requestId;
    const start = Date.now();
    res.on("finish", () => {
      if (!config.quiet)
        console.log(
          JSON.stringify({
            requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Date.now() - start,
          }),
        );
    });
    next();
  });
  app.get("/api/health", (_req, res) => {
    try {
      db.one("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  const api = express.Router();
  app.use("/api/v1", api);
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
  });
  const githubManifestLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  api.post("/auth/login", loginLimit, (req, res) => {
    if (req.headers.origin && req.headers.origin !== origin)
      fail(403, "Invalid origin");
    const b = z
      .object({
        email: z.string().email().max(200),
        password: z.string().min(1).max(1000),
      })
      .parse(req.body);
    if (
      b.email.toLowerCase() !== config.ownerEmail.toLowerCase() ||
      !verifyPassword(b.password, config.passwordHash)
    )
      fail(401, "Invalid email or password");
    const token = secret(),
      csrf = secret();
    db.run("DELETE FROM sessions WHERE expires<?", Date.now());
    db.insert(t.sessions, {
      hash: digest(token),
      csrf,
      expires: Date.now() + 7 * 86400000,
    });
    res.cookie("qh_session", token, {
      httpOnly: true,
      secure: !!config.production,
      sameSite: "strict",
      maxAge: 7 * 86400000,
      path: "/",
    });
    res.json({ email: config.ownerEmail, csrf });
  });
  api.use((req, res, next) => {
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    if (bearer) {
      const token = db.one(
        "SELECT id,planId,scope FROM tokens WHERE hash=?",
        digest(bearer),
      );
      if (!token) fail(401, "Invalid or revoked API token");
      const tokenScope =
        (token.scope as string | undefined) ||
        (token.planId ? "runner" : "upload");
      const scopedPlanId = token.planId as string | null;
      const scopedProject = scopedPlanId
        ? db.one(
            `SELECT rel.projectId FROM plans p
             JOIN releases rel ON rel.id=p.releaseId WHERE p.id=?`,
            scopedPlanId,
          )
        : null;
      const projectPath = req.path.match(/^\/projects\/([^/]+)\/(builds|state|dashboard)$/);
      const projectPathAllowed =
        !!projectPath &&
        projectPath[1] === scopedProject?.projectId &&
        (projectPath[2] !== "dashboard" ||
          typeof req.query.releaseId !== "string" ||
          !!db.one(
            "SELECT id FROM releases WHERE id=? AND projectId=?",
            req.query.releaseId,
            scopedProject.projectId,
          ));
      const caseVersionsPath = req.path.match(/^\/cases\/([^/]+)\/versions$/);
      const runPath = req.path.match(/^\/runs\/([^/]+)$/);
      const defectPath = req.path.match(/^\/defects\/([^/]+)$/);
      const evidencePath = req.path.match(/^\/evidence\/([^/]+)\/file$/);
      const readinessPath = req.path.match(/^\/releases\/([^/]+)\/readiness$/);
      const canReadScopedData =
        ["GET", "HEAD"].includes(req.method) &&
        !!scopedPlanId &&
        !!scopedProject &&
        (req.path === "/plans" ||
          req.path === "/projects" ||
          projectPathAllowed ||
          (!!caseVersionsPath &&
            db.one(
              "SELECT id FROM cases WHERE id=? AND projectId=?",
              caseVersionsPath[1],
              scopedProject.projectId,
            )) ||
          (!!runPath &&
            db.one(
              "SELECT id FROM runs WHERE id=? AND planId=?",
              runPath[1],
              scopedPlanId,
            )) ||
          (!!defectPath &&
            db.one(
              `SELECT d.id FROM defects d
               JOIN releases rel ON rel.id=d.releaseId
               WHERE d.id=? AND rel.projectId=?`,
              defectPath[1],
              scopedProject.projectId,
            )) ||
          (!!evidencePath &&
            db.one(
              `SELECT e.id FROM evidence e
               JOIN executions x ON x.id=e.executionId
               JOIN runs r ON r.id=x.runId
               WHERE e.id=? AND r.planId=?`,
              evidencePath[1],
              scopedPlanId,
            )) ||
          (!!readinessPath &&
            db.one(
              "SELECT id FROM releases WHERE id=? AND projectId=?",
              readinessPath[1],
              scopedProject.projectId,
            )));
      const canRead =
        ["read_only", "edit"].includes(tokenScope) && canReadScopedData;
      const runCreation = req.path.match(/^\/plans\/([^/]+)\/runs$/);
      const automationSync = req.path.match(
        /^\/plans\/([^/]+)\/automation\/sync$/,
      );
      const automationPreflight = req.path.match(
        /^\/plans\/([^/]+)\/automation\/preflight$/,
      );
      const reportImport = req.path.match(
        /^\/runs\/([^/]+)\/imports\/playwright$/,
      );
      const evidenceUpload = req.path.match(
        /^\/executions\/([^/]+)\/evidence$/,
      );
      const canCreateRun =
        ["edit", "runner"].includes(tokenScope) &&
        req.method === "POST" &&
        !!scopedPlanId &&
        runCreation?.[1] === scopedPlanId;
      const canSyncAutomation =
        ["edit", "automation_sync"].includes(tokenScope) &&
        req.method === "POST" &&
        !!scopedPlanId &&
        automationSync?.[1] === scopedPlanId;
      const canPreflightAutomation =
        ["edit", "runner"].includes(tokenScope) &&
        req.method === "POST" &&
        !!scopedPlanId &&
        automationPreflight?.[1] === scopedPlanId;
      const canImportReport =
        ["edit", "runner", "upload"].includes(tokenScope) &&
        req.method === "POST" &&
        !!reportImport &&
        !!scopedPlanId &&
        db.one(
          "SELECT id FROM runs WHERE id=? AND planId=?",
          reportImport[1],
          scopedPlanId,
        );
      const canUploadEvidence =
        ["edit", "runner", "upload"].includes(tokenScope) &&
        req.method === "POST" &&
        !!evidenceUpload &&
        !!scopedPlanId &&
        db.one(
          "SELECT e.id FROM executions e JOIN runs r ON r.id=e.runId WHERE e.id=? AND r.planId=?",
          evidenceUpload[1],
          scopedPlanId,
        );
      if (
        !canRead &&
        !canCreateRun &&
        !canSyncAutomation &&
        !canPreflightAutomation &&
        !canImportReport &&
        !canUploadEvidence
      )
        fail(403, "Token scope does not authorize this operation");
      if (canRead && req.path === "/plans")
        res.locals.apiTokenReadPlanId = scopedPlanId;
      if (canRead && req.path === "/projects")
        res.locals.apiTokenReadProjectId = scopedProject.projectId;
      res.locals.uploadToken = true;
      res.locals.uploadTokenPlanId = scopedPlanId;
      res.locals.tokenScope = tokenScope;
      res.locals.apiToken = true;
      return next();
    }
    const session = db.one(
      "SELECT * FROM sessions WHERE hash=? AND expires>?",
      digest(cookieToken(req)),
      Date.now(),
    );
    if (!session) fail(401, "Sign in to continue");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("x-csrf-token") !== session.csrf ||
        req.headers.origin !== origin)
    )
      fail(403, "Invalid request origin or CSRF token");
    res.locals.session = session;
    next();
  });
  api.get("/session", (_req, res) =>
    res.json({ email: config.ownerEmail, csrf: res.locals.session.csrf }),
  );
  api.post("/auth/logout", (req, res) => {
    db.run("DELETE FROM sessions WHERE hash=?", digest(cookieToken(req)));
    res.clearCookie("qh_session", { path: "/" });
    res.json({ ok: true });
  });
  const must = (table: string, key: string) =>
    db.one(`SELECT * FROM ${table} WHERE id=?`, key) ||
    fail(404, "Record not found");
  const param = (req: Request, key = "id") => String(req.params[key]);
  const ownCase = (caseId: string, projectId: string) => {
    const c = must("cases", caseId);
    if (c.projectId !== projectId) fail(400, "Case belongs to another project");
    return c;
  };
  const runContext = (runId: string) =>
    db.one(
      "SELECT r.*,p.releaseId,rel.projectId FROM runs r JOIN plans p ON p.id=r.planId JOIN releases rel ON rel.id=p.releaseId WHERE r.id=?",
      runId,
    ) || fail(404, "Run not found");
  const automationAssessment = (
    planId: string,
    projectId: string,
    key: string,
    browser: string,
  ) => {
    const source = db.one(
      "SELECT s.caseId,c.status FROM automation_sources s JOIN cases c ON c.id=s.caseId WHERE s.projectId=? AND s.key=?",
      projectId,
      key,
    );
    if (!source)
      return {
        key,
        caseId: null,
        versionId: null,
        status: "missing" as const,
        planned: false,
        ready: false,
        reason: "Scenario key has not been synced",
      };
    const latest = db.one(
      "SELECT id,approved FROM versions WHERE caseId=? ORDER BY number DESC LIMIT 1",
      source.caseId,
    );
    const planned = db.one(
      `SELECT i.versionId FROM plan_items i
       JOIN versions v ON v.id=i.versionId
       WHERE i.planId=? AND v.caseId=? AND i.browser=? LIMIT 1`,
      planId,
      source.caseId,
      browser,
    );
    const matchCounts = db.one(
      `SELECT count(*) AS candidates,
              sum(CASE WHEN i.versionId=? THEN 1 ELSE 0 END) AS latestMatches
       FROM plan_items i JOIN versions v ON v.id=i.versionId
       WHERE i.planId=? AND v.caseId=? AND i.browser=?`,
      latest?.id || "",
      planId,
      source.caseId,
      browser,
    );
    const ambiguous = matchCounts.candidates > 1;
    const ready =
      !!latest &&
      !!latest.approved &&
      source.status === "approved" &&
      matchCounts.candidates === 1 &&
      matchCounts.latestMatches === 1;
    return {
      key,
      caseId: source.caseId,
      versionId: latest?.id || null,
      status: source.status,
      planned: !!planned,
      ready,
      reason: ready
        ? null
        : source.status === "deprecated"
          ? "Case is deprecated; restore or duplicate it in Quality Hub before syncing"
          : source.status !== "approved" || !latest?.approved
          ? "Latest case version requires approval"
          : ambiguous
            ? "Multiple planned environment combinations match this case and browser; keep one to make import unambiguous"
            : "Latest approved version is not in this plan for the requested browser",
    };
  };
  const latestAutomationChecks = (
    planId: string,
    keys: string[],
    browser: string,
  ) => {
    const plan = db.one(
      `SELECT rel.projectId FROM plans p
       JOIN releases rel ON rel.id=p.releaseId WHERE p.id=?`,
      planId,
    );
    if (!plan) fail(404, "Plan not found");
    return keys.map((key) => {
      const source = db.one(
        "SELECT caseId FROM automation_sources WHERE projectId=? AND key=?",
        plan.projectId,
        key,
      );
      if (!source)
        return {
          key,
          caseId: null,
          versionId: null,
          status: "missing",
          planned: false,
          ready: false,
          reason: "Scenario key has not been synced",
        };
      return automationAssessment(
        planId,
        plan.projectId,
        key,
        browser,
      );
    });
  };
  const executionContext = (executionId: string) => {
    const ex = must("executions", executionId);
    return { ex, run: runContext(ex.runId) };
  };
  const checkedCaseIds = (caseIds: string[], projectId: string) => {
    if (new Set(caseIds).size !== caseIds.length) fail(400, "Duplicate cases");
    caseIds.forEach((c) => ownCase(c, projectId));
  };
  const createCase = (
    projectId: string,
    content: z.infer<typeof caseInput>,
  ) => {
    const caseId = `TC-${id().slice(0, 8).toUpperCase()}`,
      versionId = id();
    db.sqlite.transaction(() => {
      db.insert(t.cases, { id: caseId, projectId, createdAt: Date.now() });
      db.insert(t.versions, {
        id: versionId,
        caseId,
        number: 1,
        content: JSON.stringify(content),
        createdAt: Date.now(),
      });
      db.log("case.created", caseId);
    })();
    return { ...must("cases", caseId), versionId, ...content };
  };
  api.get("/projects", (_req, res) =>
    res.json(
      res.locals.apiTokenReadProjectId
        ? db.all(
            "SELECT * FROM projects WHERE id=? ORDER BY createdAt,id",
            res.locals.apiTokenReadProjectId,
          )
        : db.all("SELECT * FROM projects ORDER BY createdAt,id"),
    ),
  );
  api.get("/plans", (_req, res) =>
    res.json(
      res.locals.apiTokenReadPlanId
        ? db.all(
            `SELECT p.id,p.name,p.releaseId,r.name AS releaseName,
                    r.projectId,pr.name AS projectName
             FROM plans p
             JOIN releases r ON r.id=p.releaseId
             JOIN projects pr ON pr.id=r.projectId
             WHERE p.id=? ORDER BY pr.name,r.createdAt DESC,p.name`,
            res.locals.apiTokenReadPlanId,
          )
        : db.all(
            `SELECT p.id,p.name,p.releaseId,r.name AS releaseName,
                    r.projectId,pr.name AS projectName
             FROM plans p
             JOIN releases r ON r.id=p.releaseId
             JOIN projects pr ON pr.id=r.projectId
             ORDER BY pr.name,r.createdAt DESC,p.name`,
          ),
    ),
  );
  api.post("/plans/:id/automation/sync", (req, res) => {
    const planId = param(req),
      plan = db.one(
        `SELECT rel.projectId FROM plans p
         JOIN releases rel ON rel.id=p.releaseId WHERE p.id=?`,
        planId,
      );
    if (!plan) fail(404, "Plan not found");
    if (
      res.locals.uploadToken &&
      (!["automation_sync", "edit"].includes(res.locals.tokenScope) ||
        res.locals.uploadTokenPlanId !== planId)
    )
      fail(403, "Use an Edit token bound to this plan");
    const body = automationSyncRequestSchema.parse(req.body);
    const normalizedScenarios = body.scenarios.map((scenario) => ({
      ...scenario,
      tags: [...new Set(scenario.tags)].sort(),
    }));

    db.sqlite
      .transaction(() => {
        for (const scenario of normalizedScenarios) {
          let source = db.one(
            "SELECT * FROM automation_sources WHERE projectId=? AND key=?",
            plan.projectId,
            scenario.key,
          );
          let testCase: any;
          let created = false;
          if (source) {
            testCase = db.one(
              "SELECT * FROM cases WHERE id=? AND projectId=?",
              source.caseId,
              plan.projectId,
            );
            if (testCase.status === "deprecated")
              fail(
                409,
                `Deprecated case ${testCase.id} cannot be synchronized; restore or duplicate it in Quality Hub`,
              );
            if (
              scenario.legacyCaseId &&
              scenario.legacyCaseId.toUpperCase() !== testCase.id.toUpperCase()
            )
              fail(409, `Scenario key ${scenario.key} is already linked to another case`);
          } else {
            if (scenario.legacyCaseId) {
              testCase = db.one(
                "SELECT * FROM cases WHERE id=? COLLATE NOCASE AND projectId=?",
                scenario.legacyCaseId,
                plan.projectId,
              );
              if (!testCase)
                fail(
                  400,
                  `Legacy case ${scenario.legacyCaseId} does not exist in this project`,
                );
              if (testCase.status === "deprecated")
                fail(409, `Deprecated case ${scenario.legacyCaseId} cannot be linked`);
              const linked = db.one(
                "SELECT key FROM automation_sources WHERE caseId=?",
                testCase.id,
              );
              if (linked)
                fail(409, `Case ${testCase.id} is already linked to scenario key ${linked.key}`);
            } else {
              testCase = {
                id: `TC-${id().slice(0, 8).toUpperCase()}`,
                projectId: plan.projectId,
                status: "draft",
                createdAt: Date.now(),
              };
              db.insert(t.cases, testCase);
              created = true;
            }
            db.insert(t.automationSources, {
              id: id(),
              projectId: plan.projectId,
              key: scenario.key,
              browser: body.browser,
              caseId: testCase.id,
              preserveManualSteps: !!scenario.legacyCaseId,
              createdAt: Date.now(),
            });
            source = {
              caseId: testCase.id,
              preserveManualSteps: !!scenario.legacyCaseId,
            };
          }

          const latest = db.one(
            "SELECT id,number,content FROM versions WHERE caseId=? ORDER BY number DESC LIMIT 1",
            testCase.id,
          );
          const previous = latest
            ? caseVersionSchema.parse(JSON.parse(latest.content))
            : null;
          const preserveManualSteps = !!source?.preserveManualSteps;
          const automationSource = {
            key: scenario.key,
            featurePath: scenario.featurePath,
            gherkin: scenario.gherkin,
            background: scenario.background,
            steps: scenario.steps,
            tags: scenario.tags,
          };
          const nextContent = caseVersionSchema.parse({
            title: scenario.title,
            preconditions: preserveManualSteps
              ? previous?.preconditions || ""
              : scenario.background.join("\n"),
            steps: preserveManualSteps
              ? previous?.steps
              : scenario.steps.map(({ keyword, text }) => ({
                  action: `${keyword} ${text}`,
                  expected: "",
                })),
            priority: previous?.priority || "medium",
            component: previous?.component || "",
            tags: preserveManualSteps
              ? [...new Set([...(previous?.tags || []), ...scenario.tags])].sort()
              : scenario.tags,
            executionMode: preserveManualSteps
              ? previous?.executionMode === "manual"
                ? "both"
                : previous?.executionMode || "both"
              : "automated",
            automationSource,
          });
          const previousContent = previous
            ? JSON.stringify(previous)
            : null;
          const contentJson = JSON.stringify(nextContent);
          const changed = previousContent !== contentJson;
          if (changed) {
            const versionId = id();
            db.insert(t.versions, {
              id: versionId,
              caseId: testCase.id,
              number: (latest?.number || 0) + 1,
              content: contentJson,
              createdAt: Date.now(),
            });
            db.run("UPDATE cases SET status='draft' WHERE id=?", testCase.id);
            db.log(created ? "case.created" : "case.revised", testCase.id);
          }
        }
      })
      .immediate();

    const scenarioResults = body.scenarios.map((scenario) =>
      automationAssessment(planId, plan.projectId, scenario.key, body.browser),
    );
    res.json({
      planId,
      browser: body.browser,
      ready: scenarioResults.every((scenario) => scenario.ready),
      scenarios: scenarioResults,
    });
  });
  api.post("/plans/:id/automation/preflight", (req, res) => {
    const planId = param(req);
    if (
      res.locals.uploadToken &&
      (!["runner", "edit"].includes(res.locals.tokenScope) ||
        res.locals.uploadTokenPlanId !== planId)
    )
      fail(403, "Use an Edit token bound to this plan");
    const body = automationPreflightRequestSchema.parse(req.body);
    if (body.runId) {
      const run = runContext(body.runId);
      if (run.planId !== planId || run.kind !== "automated")
        fail(409, "The existing run does not belong to this automated plan");
      if (run.imported)
        fail(409, "The existing run already has an imported report");
      if (run.build !== body.build)
        fail(409, "QA_BUILD_ID does not match the existing run build");
      if (run.browser !== body.browser)
        fail(409, "QA_BROWSER does not match the existing run browser");
      const expected = run.expectedAutomationKeys
        ? (JSON.parse(run.expectedAutomationKeys) as string[])
        : null;
      const requested = [...body.automationKeys].sort();
      if (
        !expected ||
        JSON.stringify([...expected].sort()) !== JSON.stringify(requested)
      )
        fail(
          409,
          "Automation keys do not match the existing run's stored scope; create a new run",
        );
    }
    const scenarios = latestAutomationChecks(
      planId,
      body.automationKeys,
      body.browser,
    );
    const ready = scenarios.every((scenario) => scenario.ready);
    res.status(ready ? 200 : 409).json({ ready, scenarios });
  });
  api.get("/projects/:id/builds", (req, res) => {
    const projectId = param(req);
    must("projects", projectId);
    const builds = db.all(
      `SELECT p.releaseId AS releaseId,r.build AS build,MAX(r.createdAt) AS createdAt
       FROM runs r
       JOIN plans p ON p.id=r.planId
       JOIN releases rel ON rel.id=p.releaseId
       WHERE rel.projectId=?
       GROUP BY p.releaseId,r.build
       ORDER BY createdAt DESC,p.releaseId,r.build`,
      projectId,
    );
    res.json(builds);
  });
  api.post("/projects", (req, res) => {
    const b = z.object({ name: nameSchema }).parse(req.body),
      project = { id: id(), ...b, createdAt: Date.now() };
    db.insert(t.projects, project);
    res.status(201).json(project);
  });
  api.get("/projects/:id/state", (req, res) => {
    must("projects", param(req));
    res.json(projectState(db, param(req)));
  });
  api.post("/projects/:id/cases", (req, res) => {
    must("projects", param(req));
    res.status(201).json(createCase(param(req), caseInput.parse(req.body)));
  });
  api.put("/cases/:id", (req, res) => {
    const c = must("cases", param(req));
    let content = caseInput.parse(req.body);
    if (c.status === "deprecated")
      fail(
        409,
        "Deprecated cases cannot be edited; duplicate this case instead",
      );
    const latest = db.one(
      "SELECT content FROM versions WHERE caseId=? ORDER BY number DESC LIMIT 1",
      c.id,
    );
    const currentContent = latest
      ? caseVersionSchema.parse(JSON.parse(latest.content))
      : null;
    if (currentContent?.automationSource)
      content = caseVersionSchema.parse({
        ...content,
        title: currentContent.title,
        preconditions: currentContent.preconditions,
        steps: currentContent.steps,
        tags: currentContent.tags,
        executionMode: currentContent.executionMode,
        automationSource: currentContent.automationSource,
      });
    const versionId = id();
    db.sqlite.transaction(() => {
      const n = db.one(
        "SELECT MAX(number) AS n FROM versions WHERE caseId=?",
        c.id,
      ).n;
      db.insert(t.versions, {
        id: versionId,
        caseId: c.id,
        number: n + 1,
        content: JSON.stringify(content),
        createdAt: Date.now(),
      });
      db.run("UPDATE cases SET status='draft' WHERE id=?", c.id);
      db.log("case.revised", c.id);
    })();
    res.json({ ...c, ...content, status: "draft", versionId });
  });
  api.get("/cases/:id/versions", (req, res) => {
    must("cases", param(req));
    res.json(
      db
        .all(
          "SELECT * FROM versions WHERE caseId=? ORDER BY number DESC",
          param(req),
        )
        .map((v) => ({
          ...v,
          content: { executionMode: "both", ...JSON.parse(v.content) },
        })),
    );
  });
  api.post("/cases/:id/approve", (req, res) => {
    const c = must("cases", param(req));
    if (c.status === "deprecated")
      fail(409, "Duplicate a deprecated case to restore it");
    db.sqlite.transaction(() => {
      db.run(
        "UPDATE versions SET approved=1 WHERE id=(SELECT id FROM versions WHERE caseId=? ORDER BY number DESC LIMIT 1)",
        c.id,
      );
      db.run("UPDATE cases SET status='approved' WHERE id=?", c.id);
      db.log("case.approved", c.id);
    })();
    res.json(must("cases", c.id));
  });
  api.post("/cases/:id/deprecate", (req, res) => {
    must("cases", param(req));
    db.run("UPDATE cases SET status='deprecated' WHERE id=?", param(req));
    db.log("case.deprecated", param(req));
    res.json({ ok: true });
  });
  api.post("/cases/:id/duplicate", (req, res) => {
    const c = must("cases", param(req)),
      v = db.one(
        "SELECT content FROM versions WHERE caseId=? ORDER BY number DESC LIMIT 1",
        c.id,
      );
    res.status(201).json(
      createCase(c.projectId, {
        ...JSON.parse(v.content),
        title: JSON.parse(v.content).title + " (copy)",
      }),
    );
  });
  api.post("/projects/:id/environments", (req, res) => {
    must("projects", param(req));
    const b = z.object({ name: nameSchema }).parse(req.body),
      row = { id: id(), projectId: param(req), ...b };
    db.insert(t.environments, row);
    res.status(201).json(row);
  });
  api.post("/projects/:id/requirements", (req, res) => {
    must("projects", param(req));
    const b = z
        .object({
          title: nameSchema,
          description: z.string().max(20000).default(""),
        })
        .parse(req.body),
      row = { id: id(), projectId: param(req), ...b };
    db.insert(t.requirements, row);
    res.status(201).json(row);
  });
  api.put("/requirements/:id/cases", (req, res) => {
    const r = must("requirements", param(req)),
      b = z.object({ caseIds: z.array(idSchema).max(2000) }).parse(req.body);
    checkedCaseIds(b.caseIds, r.projectId);
    db.sqlite.transaction(() => {
      db.run("DELETE FROM requirement_cases WHERE requirementId=?", r.id);
      b.caseIds.forEach((caseId) =>
        db.insert(t.requirementCases, { requirementId: r.id, caseId }),
      );
    })();
    res.json({ ...r, ...b });
  });
  const suiteInput = z.object({
    name: nameSchema,
    caseIds: z.array(idSchema).max(2000).default([]),
  });
  api.post("/projects/:id/suites", (req, res) => {
    must("projects", param(req));
    const b = suiteInput.parse(req.body);
    checkedCaseIds(b.caseIds, param(req));
    const row = { id: id(), projectId: param(req), name: b.name };
    db.sqlite.transaction(() => {
      db.insert(t.suites, row);
      b.caseIds.forEach((caseId) =>
        db.insert(t.suiteCases, { suiteId: row.id, caseId }),
      );
    })();
    res.status(201).json({ ...row, caseIds: b.caseIds });
  });
  api.put("/suites/:id", (req, res) => {
    const s = must("suites", param(req)),
      b = suiteInput.parse(req.body);
    checkedCaseIds(b.caseIds, s.projectId);
    db.sqlite.transaction(() => {
      db.run("UPDATE suites SET name=? WHERE id=?", b.name, s.id);
      db.run("DELETE FROM suite_cases WHERE suiteId=?", s.id);
      b.caseIds.forEach((caseId) =>
        db.insert(t.suiteCases, { suiteId: s.id, caseId }),
      );
    })();
    res.json({ ...s, ...b });
  });
  api.post("/projects/:id/releases", (req, res) => {
    must("projects", param(req));
    const b = z.object({ name: nameSchema }).parse(req.body),
      row = { id: id(), projectId: param(req), ...b, createdAt: Date.now() };
    db.insert(t.releases, row);
    res.status(201).json(row);
  });
  api.post("/releases/:id/plans", (req, res) => {
    const rel = must("releases", param(req));
    const b = z
      .object({
        name: nameSchema,
        items: z
          .array(
            z.object({
              versionId: idSchema,
              environmentId: idSchema,
              browser: nameSchema,
            }),
          )
          .min(1)
          .max(5000),
      })
      .parse(req.body);
    const seen = new Set<string>();
    for (const item of b.items) {
      const v = must("versions", item.versionId);
      const c = ownCase(v.caseId, rel.projectId);
      if (!v.approved || c.status !== "approved")
        fail(400, "Plans require approved cases and versions");
      if (must("environments", item.environmentId).projectId !== rel.projectId)
        fail(400, "Environment belongs to another project");
      const key = [v.caseId, item.environmentId, item.browser].join(":");
      if (seen.has(key))
        fail(400, "Duplicate case/environment/browser combination");
      seen.add(key);
    }
    const row = {
      id: id(),
      releaseId: rel.id,
      name: b.name,
      createdAt: Date.now(),
    };
    db.sqlite.transaction(() => {
      db.insert(t.plans, row);
      b.items.forEach((item) =>
        db.insert(t.planItems, { id: id(), planId: row.id, ...item }),
      );
      db.log("plan.frozen", row.id);
    })();
    res.status(201).json({
      ...row,
      items: db.all("SELECT * FROM plan_items WHERE planId=?", row.id),
    });
  });
  api.post("/plans/:id/runs", (req, res) => {
    const plan = must("plans", param(req));
    const b = automationRunRequestSchema.parse(req.body);
    if (["runner", "edit"].includes(res.locals.tokenScope)) {
      if (res.locals.uploadTokenPlanId !== plan.id || b.kind !== "automated")
        fail(403, "Edit tokens can only create automated runs for their plan");
      if (!b.automationKeys)
        fail(400, "Runner-created runs require automationKeys for preflight");
      if (!b.browser)
        fail(400, "Runner-created runs require browser for exact report validation");
    }
    if (b.automationKeys) {
      const browser = b.browser || "chromium";
      const scenarios = latestAutomationChecks(plan.id, b.automationKeys, browser);
      if (scenarios.some((scenario) => !scenario.ready))
        return res.status(409).json({
          error: "Automation scenarios are not approved and in this frozen plan",
          ready: false,
          scenarios,
        });
    }
    const row = {
      id: id(),
      planId: plan.id,
      build: b.build,
      kind: b.kind,
      expectedAutomationKeys:
        ["runner", "edit"].includes(res.locals.tokenScope) && b.automationKeys
          ? JSON.stringify([...b.automationKeys].sort())
          : null,
      browser: ["runner", "edit"].includes(res.locals.tokenScope)
        ? b.browser!
        : b.browser || null,
      createdAt: Date.now(),
    };
    db.sqlite.transaction(() => {
      db.insert(t.runs, row);
      if (b.kind === "manual")
        for (const item of db.all(
          "SELECT i.*,v.content FROM plan_items i JOIN versions v ON v.id=i.versionId WHERE i.planId=?",
          plan.id,
        ))
          db.insert(t.executions, {
            id: id(),
            runId: row.id,
            planItemId: item.id,
            title: JSON.parse(item.content).title,
            browser: item.browser,
          });
      db.log("run.created", row.id);
    })();
    res.status(201).json(row);
  });
  api.get("/runs/:id", (req, res) => {
    const run = runContext(param(req));
    const executions = db
      .all(
        "SELECT e.*,i.versionId,v.caseId,v.content,env.name AS environment FROM executions e LEFT JOIN plan_items i ON i.id=e.planItemId LEFT JOIN versions v ON v.id=i.versionId LEFT JOIN environments env ON env.id=i.environmentId WHERE e.runId=?",
        run.id,
      )
      .map((e) => ({
        ...e,
        content: e.content ? JSON.parse(e.content) : null,
        attempts: db
          .all(
            "SELECT * FROM attempts WHERE executionId=? ORDER BY createdAt,rowid",
            e.id,
          )
          .map((a) => ({ ...a, attachments: JSON.parse(a.attachments) })),
        evidence: db.all(
          "SELECT id,executionId,name,url,mime,size,createdAt FROM evidence WHERE executionId=?",
          e.id,
        ),
        defects: db.all(
          "SELECT d.* FROM defects d JOIN execution_defects l ON l.defectId=d.id WHERE l.executionId=?",
          e.id,
        ),
      }));
    res.json({
      run,
      executions,
      unmatched: executions.filter((e) => !e.planItemId),
    });
  });
  api.get("/defects/:id", (req, res) => {
    const defect = must("defects", param(req));
    const linkedExecutions = db
      .all(
        `SELECT e.id AS executionId,r.id AS runId,p.id AS planId,p.name AS planName,
                r.build AS build,r.kind AS runKind,rel.id AS releaseId,
                rel.name AS releaseName,v.caseId AS caseId,v.content AS caseContent,
                e.title AS executionTitle,e.flaky AS flaky,a.status AS latestStatus
         FROM execution_defects link
         JOIN executions e ON e.id=link.executionId
         JOIN runs r ON r.id=e.runId
         JOIN plans p ON p.id=r.planId
         JOIN releases rel ON rel.id=p.releaseId
         LEFT JOIN plan_items i ON i.id=e.planItemId
         LEFT JOIN versions v ON v.id=i.versionId
         LEFT JOIN attempts a ON a.id=(
           SELECT id FROM attempts WHERE executionId=e.id
           ORDER BY createdAt DESC,rowid DESC LIMIT 1
         )
         WHERE link.defectId=?
         ORDER BY r.createdAt DESC,r.rowid DESC,e.rowid DESC`,
        defect.id,
      )
      .map((execution) => ({
        executionId: execution.executionId,
        runId: execution.runId,
        planId: execution.planId,
        planName: execution.planName,
        build: execution.build,
        runKind: execution.runKind,
        releaseId: execution.releaseId,
        releaseName: execution.releaseName,
        caseId: execution.caseId || null,
        caseTitle: execution.caseContent
          ? JSON.parse(execution.caseContent).title
          : execution.executionTitle,
        latestStatus: execution.latestStatus || null,
        flaky: !!execution.flaky,
      }));
    res.json({ defect, linkedExecutions });
  });
  api.post("/executions/:id/attempts", (req, res) => {
    const { ex, run } = executionContext(param(req));
    if (run.kind !== "manual")
      fail(409, "Automated results are immutable; create a new run");
    const b = z
      .object({
        status: statusSchema.refine(
          (s) => !["expected_failure", "interrupted"].includes(s),
        ),
        note: z.string().max(20000).default(""),
      })
      .parse(req.body);
    const row = {
      id: id(),
      executionId: ex.id,
      ...b,
      duration: 0,
      error: "",
      retry: db.one(
        "SELECT count(*) AS n FROM attempts WHERE executionId=?",
        ex.id,
      ).n,
      createdAt: Date.now(),
    };
    db.insert(t.attempts, row);
    const flaky =
      !!ex.flaky ||
      (b.status === "passed" &&
        !!db.one(
          "SELECT id FROM attempts WHERE executionId=? AND status='failed' AND (createdAt<? OR (createdAt=? AND rowid<(SELECT rowid FROM attempts WHERE id=?))) LIMIT 1",
          ex.id,
          row.createdAt,
          row.createdAt,
          row.id,
        ));
    if (flaky !== !!ex.flaky)
      db.run("UPDATE executions SET flaky=? WHERE id=?", flaky ? 1 : 0, ex.id);
    db.log("execution.recorded", ex.id);
    res.status(201).json({ ...row, flaky });
  });
  const reportUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
  }).single("report");
  const importKeyCoverage = (
    expectedJson: string | null,
    tests: { automationKey?: string | null }[],
  ) => {
    const expected = expectedJson
      ? (JSON.parse(expectedJson) as string[])
      : null;
    const observed = tests
      .map((test) => test.automationKey || null)
      .filter((key): key is string => !!key);
    const expectedSet = new Set(expected || []);
    const observedSet = new Set(observed);
    const counts = new Map<string, number>();
    observed.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
    const missingAutomationKeys = expected
      ? expected.filter((key) => !observedSet.has(key))
      : [];
    const unexpectedAutomationKeys = expected
      ? [...observedSet].filter((key) => !expectedSet.has(key)).sort()
      : [];
    const duplicateAutomationKeys = [...counts]
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
      .sort();
    const unkeyedResults = expected
      ? tests.filter((test) => !test.automationKey).length
      : 0;
    const matchesExpectedScope =
      !expected ||
      (missingAutomationKeys.length === 0 &&
        unexpectedAutomationKeys.length === 0 &&
        duplicateAutomationKeys.length === 0 &&
        unkeyedResults === 0);
    return {
      expectedAutomationKeys: expected,
      observedAutomationKeys: [...observedSet].sort(),
      missingAutomationKeys,
      unexpectedAutomationKeys,
      duplicateAutomationKeys,
      unkeyedResults,
      matchesExpectedScope,
    };
  };
  api.post("/runs/:id/imports/playwright", reportUpload, (req, res) => {
    const run = runContext(param(req));
    if (run.kind !== "automated") fail(400, "Choose an automated run");
    if (!req.file) fail(400, "Attach the JSON file using the report field");
    const file = req.file!;
    const hash = digest(file.buffer.toString("utf8")),
      existing = db.one("SELECT * FROM imports WHERE runId=?", run.id);
    if (existing) {
      if (existing.hash !== hash)
        fail(409, "A different report already exists; create a new run");
      const executions = db
        .all("SELECT * FROM executions WHERE runId=?", run.id)
        .map((execution) => ({
          ...execution,
          attachments: db
            .all(
              "SELECT attachments FROM attempts WHERE executionId=? ORDER BY createdAt,rowid",
              execution.id,
            )
            .flatMap((attempt) => JSON.parse(attempt.attachments || "[]")),
        }));
      return res.json({
        ...existing,
        duplicate: true,
        executions,
        unmatched: executions.filter((execution) => !execution.planItemId)
          .length,
        ...importKeyCoverage(run.expectedAutomationKeys, executions),
        complete: !!run.complete,
      });
    }
    assertStorage(db, file.size * 20);
    let raw: unknown;
    try {
      raw = JSON.parse(file.buffer.toString("utf8"));
    } catch {
      fail(400, "Invalid JSON report");
    }
    const parsed = (() => {
      try {
        return parseReport(raw);
      } catch (e) {
        return fail(
          400,
          e instanceof z.ZodError
            ? "Unsupported Playwright JSON shape"
            : (e as Error).message,
        );
      }
    })();
    if (
      run.expectedAutomationKeys &&
      parsed.tests.some((test) => test.browser !== run.browser)
    )
      fail(
        400,
        `Playwright report browser must match this run's ${run.browser} browser`,
      );
    const keyCoverage = importKeyCoverage(
      run.expectedAutomationKeys,
      parsed.tests,
    );
    const expectedKeySet = keyCoverage.expectedAutomationKeys
      ? new Set(keyCoverage.expectedAutomationKeys)
      : null;
    const items = db.all(
      "SELECT i.*,v.caseId FROM plan_items i JOIN versions v ON v.id=i.versionId WHERE i.planId=?",
      run.planId,
    );
    const assigned = new Set<string>();
    const importId = id();
    const out: any[] = [];
    const resolvedTests = parsed.tests.map((test) => {
      const expectedKey =
        !expectedKeySet ||
        (!!test.automationKey && expectedKeySet.has(test.automationKey));
      const source = test.automationKey && expectedKey
        ? db.one(
            "SELECT caseId FROM automation_sources WHERE projectId=? AND key=?",
            run.projectId,
            test.automationKey,
          )
        : null;
      const mapping = db.one(
        "SELECT caseId FROM mappings WHERE projectId=? AND externalKey=? AND verified=1",
        run.projectId,
        test.key,
      );
      const caseIds = expectedKey
        ? [test.caseId, source?.caseId, mapping?.caseId].filter(
        (caseId): caseId is string => !!caseId,
          )
        : [];
      if (new Set(caseIds).size > 1)
        fail(
          400,
          `Conflicting case mappings for Playwright test ${test.title}`,
        );
      return { test, caseId: caseIds[0] || null };
    });
    db.sqlite.transaction(() => {
      for (const { test, caseId } of resolvedTests) {
        const mapping = db.one(
          "SELECT caseId FROM mappings WHERE projectId=? AND externalKey=? AND verified=1",
          run.projectId,
          test.key,
        );
        const candidates = items.filter(
          (i) => i.caseId === caseId && i.browser === test.browser,
        );
        let match = candidates.length === 1 ? candidates[0] : null;
        if (match && assigned.has(match.id)) match = null;
        if (match) assigned.add(match.id);
        const execution = {
          id: id(),
          runId: run.id,
          planItemId: match?.id || null,
          title: test.title,
          automationKey: test.automationKey,
          externalKey: test.key,
          projectName: test.projectName,
          browser: test.browser,
          flaky: test.flaky,
        };
        db.insert(t.executions, execution);
        for (const [n, a] of test.attempts.entries())
          db.insert(t.attempts, {
            id: id(),
            executionId: execution.id,
            ...a,
            attachments: JSON.stringify(a.attachments || []),
            createdAt: Date.now() + n,
          });
        if (match && !mapping)
          db.run(
            "INSERT INTO mappings (id,caseId,projectId,externalKey,verified) VALUES (?,?,?,?,1) ON CONFLICT(projectId,externalKey) DO UPDATE SET caseId=excluded.caseId,verified=1",
            id(),
            match.caseId,
            run.projectId,
            test.key,
          );
        out.push({
          ...execution,
          attachments: test.attempts.flatMap((a) => a.attachments || []),
        });
      }
      db.insert(t.imports, {
        id: importId,
        runId: run.id,
        hash,
        createdAt: Date.now(),
      });
      db.run(
        "UPDATE runs SET imported=1,complete=? WHERE id=?",
        parsed.complete && keyCoverage.matchesExpectedScope ? 1 : 0,
        run.id,
      );
      db.log("playwright.imported", run.id);
    })();
    res.status(201).json({
      id: importId,
      runId: run.id,
      executions: out,
      unmatched: out.filter((e) => !e.planItemId).length,
      ...keyCoverage,
      complete: parsed.complete && keyCoverage.matchesExpectedScope,
    });
  });
  api.post("/executions/:id/map", (req, res) => {
    const { ex, run } = executionContext(param(req)),
      b = z.object({ planItemId: idSchema }).parse(req.body),
      item = must("plan_items", b.planItemId);
    if (run.kind !== "automated" || ex.planItemId)
      fail(409, "Only unmatched automated results can be mapped");
    if (item.planId !== run.planId || item.browser !== ex.browser)
      fail(400, "Choose an item from this run with the same browser");
    if (
      db.one(
        "SELECT id FROM executions WHERE runId=? AND planItemId=?",
        run.id,
        item.id,
      )
    )
      fail(409, "This planned item already has an execution");
    const version = must("versions", item.versionId);
    db.sqlite.transaction(() => {
      db.run("UPDATE executions SET planItemId=? WHERE id=?", item.id, ex.id);
      db.run(
        "INSERT INTO mappings (id,caseId,projectId,externalKey,verified) VALUES (?,?,?,?,1) ON CONFLICT(projectId,externalKey) DO UPDATE SET caseId=excluded.caseId,verified=1",
        id(),
        version.caseId,
        run.projectId,
        ex.externalKey,
      );
      db.log("execution.mapped", ex.id);
    })();
    res.json({ ok: true });
  });
  api.post("/projects/:id/defects", (req, res) => {
    must("projects", param(req));
    const b = z
      .object({
        releaseId: idSchema,
        title: nameSchema,
        severity: z.enum(["critical", "high", "medium", "low"]),
        status: z.enum(["open", "in_progress", "closed"]).default("open"),
        url: urlSchema.optional(),
      })
      .parse(req.body);
    if (must("releases", b.releaseId).projectId !== param(req))
      fail(400, "Release belongs to another project");
    const row = {
      id: id(),
      projectId: param(req),
      ...b,
      createdAt: Date.now(),
    };
    db.insert(t.defects, row);
    db.log("defect.created", row.id);
    res.status(201).json(row);
  });
  api.patch("/defects/:id", (req, res) => {
    must("defects", param(req));
    const b = z
      .object({
        status: z.enum(["open", "in_progress", "closed"]).optional(),
        severity: z.enum(["critical", "high", "medium", "low"]).optional(),
      })
      .parse(req.body);
    if (b.status)
      db.run("UPDATE defects SET status=? WHERE id=?", b.status, param(req));
    if (b.severity)
      db.run(
        "UPDATE defects SET severity=? WHERE id=?",
        b.severity,
        param(req),
      );
    db.log("defect.updated", param(req));
    res.json(must("defects", param(req)));
  });
  api.post("/executions/:id/defects", (req, res) => {
    const { ex, run } = executionContext(param(req)),
      b = z.object({ defectId: idSchema }).parse(req.body),
      d = must("defects", b.defectId);
    if (d.releaseId !== run.releaseId)
      fail(400, "Defect belongs to another release");
    db.run(
      "INSERT OR IGNORE INTO execution_defects(executionId,defectId) VALUES (?,?)",
      ex.id,
      d.id,
    );
    res.json({ ok: true });
  });
  const screenshotUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
  }).single("screenshot");
  api.post("/executions/:id/evidence", screenshotUpload, async (req, res) => {
    executionContext(param(req));
    if (!req.file) fail(400, "Attach a screenshot");
    const file = req.file!;
    const sourceHash = req.get("x-qa-evidence-sha256");
    if (sourceHash) {
      if (
        !/^[a-f0-9]{64}$/.test(sourceHash) ||
        createHash("sha256").update(file.buffer).digest("hex") !== sourceHash
      )
        fail(400, "Screenshot hash does not match its upload key");
      const name = `playwright-${sourceHash}.webp`;
      const existing = db.one(
        "SELECT * FROM evidence WHERE executionId=? AND name=?",
        param(req),
        name,
      );
      if (existing) return res.json({ ...existing, duplicate: true });
      const row = await saveScreenshot(db, param(req), file.buffer, name);
      return res.status(201).json(row);
    }
    const row = await saveScreenshot(
      db,
      param(req),
      file.buffer,
      file.originalname,
    );
    res.status(201).json(row);
  });
  api.post("/executions/:id/links", (req, res) => {
    executionContext(param(req));
    const b = z.object({ name: nameSchema, url: urlSchema }).parse(req.body),
      row = {
        id: id(),
        executionId: param(req),
        ...b,
        size: 0,
        createdAt: Date.now(),
      };
    db.insert(t.evidence, row);
    res.status(201).json(row);
  });
  api.get("/evidence/:id/file", (req, res) => {
    const e = must("evidence", param(req));
    if (!e.path) fail(404, "This evidence is an external link");
    res.setHeader("Content-Type", e.mime);
    res.setHeader("Content-Disposition", "inline");
    res.sendFile(resolve(db.dir, "screenshots", e.path));
  });
  api.delete("/evidence/:id", (req, res) => {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    if (backupRunning(db))
      fail(409, "Wait for the current backup before deleting evidence");
    const e = must("evidence", param(req));
    db.run("DELETE FROM evidence WHERE id=?", e.id);
    if (e.path && existsSync(resolve(db.dir, "screenshots", e.path)))
      unlinkSync(resolve(db.dir, "screenshots", e.path));
    db.log("evidence.deleted", e.id);
    res.json({ ok: true });
  });
  api.get("/releases/:id/readiness", (req, res) => {
    must("releases", param(req));
    const build = nameSchema.parse(req.query.build);
    res.json(releaseGate(db, param(req), build));
  });
  api.get("/projects/:id/dashboard", (req, res) => {
    const state = projectState(db, param(req)),
      releaseId =
        typeof req.query.releaseId === "string"
          ? req.query.releaseId
          : state.releases[0]?.id;
    if (releaseId && must("releases", releaseId).projectId !== param(req))
      fail(400, "Release belongs to another project");
    const build = typeof req.query.build === "string" ? req.query.build : "";
    const builds = releaseId
      ? db.all(
          "SELECT r.build,MAX(r.createdAt) AS ts FROM runs r JOIN plans p ON p.id=r.planId WHERE p.releaseId=? GROUP BY r.build ORDER BY ts DESC LIMIT 10",
          releaseId,
        )
      : [];
    res.json({
      gate: releaseId && build ? releaseGate(db, releaseId, build) : null,
      automationCoverage: state.automationCoverage,
      requirementCoverage: state.requirementCoverage,
      recentRuns: state.runs.slice(0, 8),
      trend: builds.reverse().map((b) => ({
        build: b.build,
        passRate: releaseGate(db, releaseId, b.build).passRate,
      })),
    });
  });
  api.get("/settings", (_req, res) =>
    res.json({
      email: config.ownerEmail,
      storage: storageInfo(db),
      githubSync: config.githubSource
        ? {
            configured: true,
            repository: config.githubSource.repository,
            branch: config.githubSource.branch,
            featureRoot: config.githubSource.featureRoot,
            browser: config.githubSource.browser || "chromium",
          }
        : { configured: false },
      tokens: db.all(
        `SELECT t.id,t.name,t.planId,t.scope,p.name AS planName,t.createdAt
         FROM tokens t LEFT JOIN plans p ON p.id=t.planId
         ORDER BY t.createdAt DESC`,
      ),
    }),
  );
  api.get("/integrations/github/manifest", githubManifestLimit, async (_req, res) => {
    const githubSource = config.githubSource;
    if (!githubSource) {
      res.status(503).json({
        error:
          "Repository sync is not configured. Set GITHUB_REPOSITORY, GITHUB_BRANCH, and GITHUB_FEATURE_ROOT in the app environment.",
      });
      return;
    }
    const manifest = await loadGithubManifest(githubSource);
    res.json(manifest);
  });
  api.post("/tokens", (req, res) => {
    const b = z
      .object({
        name: nameSchema,
        planId: idSchema.nullable().optional(),
        scope: z.enum(["read_only", "edit"]).optional(),
      })
      .parse(req.body);
    const planId = b.planId || null;
    const scope = b.scope || "edit";
    const requiredPlanId =
      planId || fail(400, "Automation tokens must be bound to a plan");
    const token = secret();
    const row = {
      id: id(),
      name: b.name,
      hash: digest(token),
      planId,
      scope,
      createdAt: Date.now(),
    };
    must("plans", requiredPlanId);
    db.insert(t.tokens, row);
    res.status(201).json({ id: row.id, token });
  });
  api.delete("/tokens/:id", (req, res) => {
    must("tokens", param(req));
    db.run("DELETE FROM tokens WHERE id=?", param(req));
    res.json({ ok: true });
  });
  api.get("/backup", async (_req, res) => {
    const backup = await createBackup(db);
    res.download(
      backup.path,
      `quality-hub-${new Date().toISOString().slice(0, 10)}.zip`,
      () => backup.cleanup(),
    );
  });
  api.use((_req, res) =>
    res.status(404).json({ error: "API endpoint not found" }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found" }),
  );
  const publicDir = resolve("dist/public");
  app.use(express.static(publicDir, { index: false }));
  app.get("/{*path}", (_req, res) => {
    if (existsSync(resolve(publicDir, "index.html")))
      res.sendFile(resolve(publicDir, "index.html"));
    else
      res
        .status(200)
        .send(
          "API running. Start the Vite development server or run npm run build.",
        );
  });
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      err instanceof z.ZodError
        ? 400
        : err instanceof multer.MulterError
          ? 413
          : err.status ||
            (/quota|capacity|storage|space/i.test(err.message) ? 507 : 500);
    if (!config.quiet)
      console.error(
        JSON.stringify({
          requestId: res.locals.requestId,
          status,
          type: err.name,
        }),
      );
    res.status(status).json({
      error:
        err instanceof z.ZodError
          ? err.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : status === 500
            ? "Something went wrong; see the server request ID"
            : err.message,
    });
  });
  return { app, db };
}
