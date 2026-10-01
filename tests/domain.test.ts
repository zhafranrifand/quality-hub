import { describe, it, expect } from "vitest";
import { evaluateGate, type GateRow } from "../shared/contracts";
import { parseReport } from "../server/playwright";
import { report } from "./fixtures";
const row = (status: GateRow["status"] = "passed", flaky = false): GateRow => ({
  id: "i",
  caseId: "c",
  title: "Checkout",
  environment: "stage",
  browser: "chromium",
  status,
  flaky,
});
describe("release gates", () => {
  it("requires scope and evidence", () => {
    expect(evaluateGate([], []).status).toBe("Unknown");
    for (const s of [
      "not_run",
      "skipped",
      "interrupted",
      "expected_failure",
    ] as const)
      expect(evaluateGate([row(s)], []).status).toBe("Unknown");
    expect(evaluateGate([row()], [], true).status).toBe("Unknown");
  });
  it("blocks critical defects despite a 100% pass rate", () => {
    const g = evaluateGate([row()], [{ severity: "critical", status: "open" }]);
    expect(g.status).toBe("Blocked");
    expect(g.passRate).toBe(100);
  });
  it("applies blocked before unknown before risk", () => {
    expect(evaluateGate([row("failed"), row("not_run")], []).status).toBe(
      "Blocked",
    );
    expect(
      evaluateGate([row("not_run")], [{ severity: "high", status: "open" }])
        .status,
    ).toBe("Unknown");
    expect(evaluateGate([row("passed", true)], []).status).toBe("At risk");
    expect(
      evaluateGate([row()], [{ severity: "high", status: "open" }]).status,
    ).toBe("At risk");
    expect(
      evaluateGate([row()], [{ severity: "critical", status: "closed" }])
        .status,
    ).toBe("Ready");
  });
  it("calculates explicit denominators without counting skipped as complete", () => {
    const g = evaluateGate(
      [row(), row("failed"), row("skipped"), row("not_run")],
      [],
    );
    expect(g.completion).toBe(50);
    expect(g.passRate).toBe(50);
    expect(g.counts.skipped).toBe(1);
  });
});
describe("Playwright parser", () => {
  it("retains attempts and marks pass after retry flaky", () => {
    const p = parseReport(report("TC-1", ["failed", "passed"]));
    expect(p.tests).toHaveLength(1);
    expect(p.tests[0].attempts).toHaveLength(2);
    expect(p.tests[0].flaky).toBe(true);
    expect(p.tests[0].caseId).toBe("TC-1");
    expect(p.tests[0].attempts[0].attachments?.[0].path).toContain("trace.zip");
  });
  it("does not turn expected failures or unexpected passes into passes", () => {
    expect(
      parseReport(report("TC-1", ["failed"], { expectedStatus: "failed" }))
        .tests[0].attempts[0].status,
    ).toBe("expected_failure");
    expect(
      parseReport(report("TC-1", ["passed"], { expectedStatus: "failed" }))
        .tests[0].attempts[0].status,
    ).toBe("failed");
  });
  it("detects incomplete reports and missing attempts", () => {
    expect(parseReport(report(null, ["interrupted"])).complete).toBe(false);
    expect(parseReport(report(null, [])).complete).toBe(false);
    expect(
      parseReport(
        report(null, ["passed"], { errors: [{ message: "worker failed" }] }),
      ).complete,
    ).toBe(false);
  });
  it("rejects malformed/empty reports and preserves unmapped identity", () => {
    expect(() => parseReport({ hello: "world" })).toThrow();
    expect(() => parseReport({ suites: [] })).toThrow();
    expect(parseReport(report(null)).tests[0].caseId).toBeNull();
  });
});
