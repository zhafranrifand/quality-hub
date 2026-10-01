import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { openStore } from "../server/db";
import { releaseGate, projectState } from "../server/reporting";
mkdirSync(resolve("../../work/harness"), { recursive: true });
const dir = mkdtempSync(resolve("../../work/harness/benchmark-"));
const db = openStore(dir);
try {
  const content = JSON.stringify({
    title: "Checkout benchmark",
    preconditions: "",
    steps: [{ action: "Submit", expected: "Saved" }],
    component: "Checkout",
    tags: [],
    priority: "medium",
  });
  db.sqlite.transaction(() => {
    db.run("INSERT INTO projects VALUES (?,?,?)", "p", "Benchmark", 1);
    db.run("INSERT INTO environments VALUES (?,?,?)", "env", "p", "stage");
    db.run("INSERT INTO releases VALUES (?,?,?,?)", "rel", "p", "v1", 1);
    db.run("INSERT INTO plans VALUES (?,?,?,?)", "plan", "rel", "Smoke", 1);
    const caseStmt = db.sqlite.prepare("INSERT INTO cases VALUES (?,?,?,?)"),
      versionStmt = db.sqlite.prepare(
        "INSERT INTO versions VALUES (?,?,?,?,?,?)",
      ),
      itemStmt = db.sqlite.prepare("INSERT INTO plan_items VALUES (?,?,?,?,?)"),
      execStmt = db.sqlite.prepare(
        "INSERT INTO executions (id,runId,planItemId,title,browser,flaky) VALUES (?,?,?,?,?,0)",
      ),
      attemptStmt = db.sqlite.prepare(
        "INSERT INTO attempts (id,executionId,status,duration,error,note,retry,attachments,createdAt) VALUES (?,?,?,?,?,?,0,?,?)",
      );
    for (let n = 0; n < 2000; n++) {
      caseStmt.run("c" + n, "p", "approved", n);
      versionStmt.run("v" + n, "c" + n, 1, content, 1, n);
      itemStmt.run("i" + n, "plan", "v" + n, "env", "chromium");
    }
    for (let r = 0; r < 25; r++) {
      db.run(
        "INSERT INTO runs (id,planId,build,kind,createdAt,imported,complete) VALUES (?,?,?,?,?,1,1)",
        "r" + r,
        "plan",
        "b" + r,
        "automated",
        r,
      );
      for (let n = 0; n < 2000; n++) {
        const key = `e${r}-${n}`;
        execStmt.run(key, "r" + r, "i" + n, "Checkout", "chromium");
        attemptStmt.run("a" + key, key, "passed", 20, "", "", "[]", r);
      }
    }
  })();
  const timings: number[] = [];
  let peakRss = process.memoryUsage().rss;
  for (let i = 0; i < 12; i++) {
    const start = performance.now();
    const state = projectState(db, "p");
    const gate = releaseGate(db, "rel", "b24");
    for (let r = 15; r < 25; r++) releaseGate(db, "rel", "b" + r);
    if (state.cases.length !== 2000 || gate.status !== "Ready")
      throw new Error("Benchmark data invariant failed");
    timings.push(performance.now() - start);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const sorted = timings.slice(2).sort((a, b) => a - b),
    p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const maxRss = Math.max(peakRss, process.resourceUsage().maxRSS * 1024);
  console.log(
    JSON.stringify(
      {
        cases: 2000,
        executions: 50000,
        dashboardWithTenBuildTrendP95Ms: Math.round(p95),
        peakMemoryMB: Math.round(maxRss / 1024 / 1024),
        latencyTargetMet: p95 < 1000,
        memoryTargetMet: maxRss < 400 * 1024 * 1024,
        environment: "Local Node process; not Railway measurements",
      },
      null,
      2,
    ),
  );
  if (p95 >= 1000 || maxRss >= 400 * 1024 * 1024) process.exitCode = 1;
} finally {
  db.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
}
