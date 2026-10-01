import type { Store } from "./db.js";
import {
  evaluateGate,
  type GateRow,
  type CaseContent,
} from "../shared/contracts.js";
export function releaseGate(db: Store, releaseId: string, build: string) {
  const items = db.all(
    `SELECT i.*,v.caseId,v.content,e.name AS environment FROM plan_items i JOIN plans p ON p.id=i.planId JOIN versions v ON v.id=i.versionId JOIN environments e ON e.id=i.environmentId WHERE p.releaseId=? ORDER BY p.createdAt DESC,p.rowid DESC,i.rowid DESC`,
    releaseId,
  );
  const latest = db.all(
    `SELECT e.id AS executionId,e.flaky,r.id AS runId,v.caseId,i.environmentId,i.browser,a.status FROM executions e JOIN runs r ON r.id=e.runId JOIN plans p ON p.id=r.planId JOIN plan_items i ON i.id=e.planItemId JOIN versions v ON v.id=i.versionId LEFT JOIN attempts a ON a.id=(SELECT id FROM attempts WHERE executionId=e.id ORDER BY createdAt DESC,rowid DESC LIMIT 1) WHERE p.releaseId=? AND r.build=? ORDER BY r.createdAt DESC,r.rowid DESC,e.rowid DESC`,
    releaseId,
    build,
  );
  const key = (caseId: string, environmentId: string, browser: string) =>
    `${caseId}:${environmentId}:${browser}`;
  const byCombination = new Map<string, any>();
  for (const e of latest) {
    const combination = key(e.caseId, e.environmentId, e.browser);
    if (!byCombination.has(combination)) byCombination.set(combination, e);
  }
  const seen = new Set<string>();
  const rows: GateRow[] = items.flatMap((i) => {
    const combination = key(i.caseId, i.environmentId, i.browser);
    if (seen.has(combination)) return [];
    seen.add(combination);
    const e = byCombination.get(combination);
    return {
      id: i.id,
      caseId: i.caseId,
      title: (JSON.parse(i.content) as CaseContent).title,
      environment: i.environment,
      browser: i.browser,
      status: e?.status || "not_run",
      flaky: !!e?.flaky,
      executionId: e?.executionId,
      runId: e?.runId,
    };
  });
  const incomplete = !!db.one(
    `SELECT r.id FROM runs r JOIN plans p ON p.id=r.planId WHERE p.releaseId=? AND r.build=? AND r.kind='automated' AND r.complete=0 AND NOT EXISTS (SELECT 1 FROM runs newer WHERE newer.planId=r.planId AND newer.build=r.build AND newer.kind='automated' AND (newer.createdAt>r.createdAt OR (newer.createdAt=r.createdAt AND newer.rowid>r.rowid))) LIMIT 1`,
    releaseId,
    build,
  );
  return evaluateGate(
    rows,
    db.all("SELECT severity,status FROM defects WHERE releaseId=?", releaseId),
    incomplete,
  );
}
export function projectState(db: Store, projectId: string) {
  const cases = db
    .all(
      `SELECT c.*,v.id AS versionId,v.number,v.content,v.approved FROM cases c JOIN versions v ON v.id=(SELECT id FROM versions WHERE caseId=c.id ORDER BY number DESC LIMIT 1) WHERE c.projectId=? ORDER BY c.createdAt DESC`,
      projectId,
    )
    .map((c) => {
      const content = JSON.parse(c.content) as CaseContent;
      return {
        ...c,
        ...content,
        executionMode: content.executionMode ?? "both",
        content: undefined,
      };
    });
  const releases = db.all(
    "SELECT * FROM releases WHERE projectId=? ORDER BY createdAt DESC",
    projectId,
  );
  const plans = db
    .all(
      "SELECT p.* FROM plans p JOIN releases r ON r.id=p.releaseId WHERE r.projectId=?",
      projectId,
    )
    .map((p) => ({
      ...p,
      items: db
        .all(
          "SELECT i.*,v.caseId,v.content FROM plan_items i JOIN versions v ON v.id=i.versionId WHERE i.planId=?",
          p.id,
        )
        .map((i) => ({
          ...i,
          title: JSON.parse(i.content).title,
          content: undefined,
        })),
    }));
  const requirements = db
    .all("SELECT * FROM requirements WHERE projectId=?", projectId)
    .map((r) => ({
      ...r,
      caseIds: db
        .all("SELECT caseId FROM requirement_cases WHERE requirementId=?", r.id)
        .map((c) => c.caseId),
    }));
  const mappings = db.all(
    "SELECT * FROM mappings WHERE projectId=?",
    projectId,
  );
  const active = cases.filter((c) => c.status === "approved" && c.approved);
  return {
    cases,
    releases,
    plans,
    requirements,
    mappings,
    environments: db.all(
      "SELECT * FROM environments WHERE projectId=?",
      projectId,
    ),
    suites: db
      .all("SELECT * FROM suites WHERE projectId=?", projectId)
      .map((s) => ({
        ...s,
        caseIds: db
          .all("SELECT caseId FROM suite_cases WHERE suiteId=?", s.id)
          .map((c) => c.caseId),
      })),
    runs: db.all(
      "SELECT r.*,p.name AS planName,p.releaseId FROM runs r JOIN plans p ON p.id=r.planId JOIN releases rel ON rel.id=p.releaseId WHERE rel.projectId=? ORDER BY r.createdAt DESC,r.rowid DESC LIMIT 200",
      projectId,
    ),
    defects: db.all(
      "SELECT * FROM defects WHERE projectId=? ORDER BY createdAt DESC",
      projectId,
    ),
    automationCoverage: active.length
      ? (100 *
          active.filter(
            (c) =>
              c.executionMode !== "manual" &&
              mappings.some((m) => m.caseId === c.id && m.verified),
          ).length) /
        active.length
      : null,
    requirementCoverage: requirements.length
      ? (100 *
          requirements.filter((r) =>
            r.caseIds.some((id: string) => active.some((c) => c.id === id)),
          ).length) /
        requirements.length
      : null,
  };
}
