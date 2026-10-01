import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const projects = sqliteTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: integer().notNull(),
});
export const cases = sqliteTable(
  "cases",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    status: text().notNull().default("draft"),
    createdAt: integer().notNull(),
  },
  (t) => [index("cases_project").on(t.projectId)],
);
export const versions = sqliteTable(
  "versions",
  {
    id: text().primaryKey(),
    caseId: text()
      .notNull()
      .references(() => cases.id),
    number: integer().notNull(),
    content: text().notNull(),
    approved: integer({ mode: "boolean" }).notNull().default(false),
    createdAt: integer().notNull(),
  },
  (t) => [uniqueIndex("case_version").on(t.caseId, t.number)],
);
export const requirements = sqliteTable("requirements", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  title: text().notNull(),
  description: text().notNull().default(""),
});
export const requirementCases = sqliteTable(
  "requirement_cases",
  {
    requirementId: text()
      .notNull()
      .references(() => requirements.id),
    caseId: text()
      .notNull()
      .references(() => cases.id),
  },
  (t) => [uniqueIndex("requirement_case").on(t.requirementId, t.caseId)],
);
export const suites = sqliteTable("suites", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  name: text().notNull(),
});
export const suiteCases = sqliteTable(
  "suite_cases",
  {
    suiteId: text()
      .notNull()
      .references(() => suites.id),
    caseId: text()
      .notNull()
      .references(() => cases.id),
  },
  (t) => [uniqueIndex("suite_case").on(t.suiteId, t.caseId)],
);
export const environments = sqliteTable("environments", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  name: text().notNull(),
});
export const releases = sqliteTable("releases", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  name: text().notNull(),
  createdAt: integer().notNull(),
});
export const plans = sqliteTable("plans", {
  id: text().primaryKey(),
  releaseId: text()
    .notNull()
    .references(() => releases.id),
  name: text().notNull(),
  createdAt: integer().notNull(),
});
export const planItems = sqliteTable(
  "plan_items",
  {
    id: text().primaryKey(),
    planId: text()
      .notNull()
      .references(() => plans.id),
    versionId: text()
      .notNull()
      .references(() => versions.id),
    environmentId: text()
      .notNull()
      .references(() => environments.id),
    browser: text().notNull(),
  },
  (t) => [index("plan_item_plan").on(t.planId)],
);
export const runs = sqliteTable(
  "runs",
  {
    id: text().primaryKey(),
    planId: text()
      .notNull()
      .references(() => plans.id),
    build: text().notNull(),
    kind: text().notNull(),
    expectedAutomationKeys: text(),
    browser: text(),
    createdAt: integer().notNull(),
    imported: integer({ mode: "boolean" }).notNull().default(false),
    complete: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("run_build").on(t.planId, t.build, t.createdAt)],
);
export const executions = sqliteTable(
  "executions",
  {
    id: text().primaryKey(),
    runId: text()
      .notNull()
      .references(() => runs.id),
    planItemId: text().references(() => planItems.id),
    title: text().notNull(),
    automationKey: text(),
    externalKey: text(),
    projectName: text(),
    browser: text().notNull(),
    flaky: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("execution_run").on(t.runId),
    index("execution_item").on(t.planItemId),
  ],
);
export const attempts = sqliteTable(
  "attempts",
  {
    id: text().primaryKey(),
    executionId: text()
      .notNull()
      .references(() => executions.id),
    status: text().notNull(),
    duration: integer().notNull(),
    error: text().notNull(),
    note: text().notNull().default(""),
    retry: integer().notNull(),
    expectedStatus: text(),
    actualStatus: text(),
    attachments: text().notNull().default("[]"),
    createdAt: integer().notNull(),
  },
  (t) => [index("attempt_execution").on(t.executionId, t.createdAt)],
);
export const defects = sqliteTable("defects", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  releaseId: text()
    .notNull()
    .references(() => releases.id),
  title: text().notNull(),
  severity: text().notNull(),
  status: text().notNull().default("open"),
  url: text(),
  createdAt: integer().notNull(),
});
export const executionDefects = sqliteTable(
  "execution_defects",
  {
    executionId: text()
      .notNull()
      .references(() => executions.id),
    defectId: text()
      .notNull()
      .references(() => defects.id),
  },
  (t) => [uniqueIndex("execution_defect").on(t.executionId, t.defectId)],
);
export const mappings = sqliteTable(
  "mappings",
  {
    id: text().primaryKey(),
    caseId: text()
      .notNull()
      .references(() => cases.id),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    externalKey: text().notNull(),
    verified: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("mapping_key").on(t.projectId, t.externalKey)],
);
export const automationSources = sqliteTable(
  "automation_sources",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    key: text().notNull(),
    // Retained for compatibility with older source mappings; plan targets now
    // determine the browser used for execution.
    browser: text().notNull(),
    caseId: text()
      .notNull()
      .references(() => cases.id),
    preserveManualSteps: integer({ mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("automation_source_project_key").on(t.projectId, t.key),
    uniqueIndex("automation_source_case").on(t.caseId),
  ],
);
export const imports = sqliteTable(
  "imports",
  {
    id: text().primaryKey(),
    runId: text()
      .notNull()
      .references(() => runs.id),
    hash: text().notNull(),
    createdAt: integer().notNull(),
  },
  (t) => [uniqueIndex("import_run").on(t.runId)],
);
export const evidence = sqliteTable("evidence", {
  id: text().primaryKey(),
  executionId: text()
    .notNull()
    .references(() => executions.id),
  name: text().notNull(),
  path: text(),
  url: text(),
  mime: text(),
  size: integer().notNull(),
  createdAt: integer().notNull(),
});
export const sessions = sqliteTable("sessions", {
  hash: text().primaryKey(),
  csrf: text().notNull(),
  expires: integer().notNull(),
});
export const tokens = sqliteTable("tokens", {
  id: text().primaryKey(),
  name: text().notNull(),
  hash: text().notNull(),
  planId: text().references(() => plans.id),
  scope: text().notNull().default("upload"),
  createdAt: integer().notNull(),
});
export const audit = sqliteTable("audit", {
  id: text().primaryKey(),
  action: text().notNull(),
  entityId: text().notNull(),
  createdAt: integer().notNull(),
});
