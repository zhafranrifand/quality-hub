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
        "SELECT id FROM tokens WHERE hash=?",
        digest(bearer),
      );
      if (!token) fail(401, "Invalid or revoked upload token");
      if (
        req.method !== "POST" ||
        !(
          /^\/runs\/[^/]+\/imports\/playwright$/.test(req.path) ||
          /^\/executions\/[^/]+\/evidence$/.test(req.path)
        )
      )
        fail(403, "Upload tokens can only submit reports and screenshots");
      res.locals.uploadToken = true;
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
    res.json(db.all("SELECT * FROM projects ORDER BY createdAt,id")),
  );
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
    const c = must("cases", param(req)),
      content = caseInput.parse(req.body);
    if (c.status === "deprecated")
      fail(
        409,
        "Deprecated cases cannot be edited; duplicate this case instead",
      );
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
    const plan = must("plans", param(req)),
      b = z
        .object({ build: nameSchema, kind: z.enum(["manual", "automated"]) })
        .parse(req.body),
      row = { id: id(), planId: plan.id, ...b, createdAt: Date.now() };
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
    const items = db.all(
      "SELECT i.*,v.caseId FROM plan_items i JOIN versions v ON v.id=i.versionId WHERE i.planId=?",
      run.planId,
    );
    const assigned = new Set<string>();
    const importId = id();
    const out: any[] = [];
    db.sqlite.transaction(() => {
      for (const test of parsed.tests) {
        const mapping = db.one(
          "SELECT caseId FROM mappings WHERE projectId=? AND externalKey=? AND verified=1",
          run.projectId,
          test.key,
        );
        const caseId = test.caseId || mapping?.caseId;
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
        parsed.complete ? 1 : 0,
        run.id,
      );
      db.log("playwright.imported", run.id);
    })();
    res.status(201).json({
      id: importId,
      runId: run.id,
      complete: parsed.complete,
      executions: out,
      unmatched: out.filter((e) => !e.planItemId).length,
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
      tokens: db.all(
        "SELECT id,name,createdAt FROM tokens ORDER BY createdAt DESC",
      ),
    }),
  );
  api.post("/tokens", (req, res) => {
    const b = z.object({ name: nameSchema }).parse(req.body),
      token = secret(),
      row = {
        id: id(),
        name: b.name,
        hash: digest(token),
        createdAt: Date.now(),
      };
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
