import { z } from "zod";
export const idSchema = z.string().min(1).max(100);
export const nameSchema = z.string().trim().min(1).max(200);
export const textSchema = z.string().max(20000);
export const statusSchema = z.enum([
  "passed",
  "failed",
  "blocked",
  "skipped",
  "not_run",
  "expected_failure",
  "interrupted",
]);
export type ExecutionStatus = z.infer<typeof statusSchema>;
export const executionModeSchema = z.enum(["manual", "automated", "both"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export const caseInput = z.object({
  title: nameSchema,
  preconditions: textSchema.default(""),
  steps: z
    .array(
      z.object({
        action: nameSchema.or(z.string().min(1).max(5000)),
        expected: z.string().max(5000),
      }),
    )
    .min(1)
    .max(100),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  component: z.string().max(100).default(""),
  tags: z.array(z.string().max(50)).max(30).default([]),
  executionMode: executionModeSchema.default("both"),
});
export type CaseContent = Omit<z.infer<typeof caseInput>, "executionMode"> & {
  executionMode?: ExecutionMode;
};
export type Attempt = {
  status: ExecutionStatus;
  duration: number;
  error: string;
  retry: number;
  expectedStatus?: string;
  actualStatus?: string;
  attachments?: { name: string; path?: string; contentType?: string }[];
};
export type ImportedTest = {
  key: string;
  title: string;
  projectName: string;
  browser: string;
  caseId: string | null;
  attempts: Attempt[];
  flaky: boolean;
};
export type GateRow = {
  id: string;
  caseId: string;
  title: string;
  environment: string;
  browser: string;
  status: ExecutionStatus;
  flaky: boolean;
  executionId?: string;
  runId?: string;
};
export type Gate = {
  status: "Blocked" | "Unknown" | "At risk" | "Ready";
  reasons: string[];
  rows: GateRow[];
  completion: number | null;
  passRate: number | null;
  counts: Record<ExecutionStatus, number>;
};
export function evaluateGate(
  rows: GateRow[],
  defects: { severity: string; status: string }[],
  incomplete = false,
): Gate {
  const counts = {
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    not_run: 0,
    expected_failure: 0,
    interrupted: 0,
  };
  rows.forEach((r) => counts[r.status]++);
  const reasons: string[] = [];
  const critical = defects.filter(
    (d) => d.status !== "closed" && d.severity === "critical",
  ).length;
  const high = defects.filter(
    (d) => d.status !== "closed" && d.severity === "high",
  ).length;
  const missing = rows.filter((r) =>
    ["skipped", "not_run", "interrupted", "expected_failure"].includes(
      r.status,
    ),
  ).length;
  let status: Gate["status"] = "Ready";
  if (critical || counts.failed || counts.blocked) {
    status = "Blocked";
    if (critical) reasons.push(`${critical} open critical defect(s)`);
    if (counts.failed) reasons.push(`${counts.failed} required test(s) failed`);
    if (counts.blocked)
      reasons.push(`${counts.blocked} required test(s) blocked`);
  } else if (!rows.length || missing || incomplete) {
    status = "Unknown";
    if (!rows.length) reasons.push("No approved scope defined");
    if (missing)
      reasons.push(
        `${missing} required result(s) missing, skipped, interrupted, or expected to fail`,
      );
    if (incomplete)
      reasons.push("An automated run is awaiting a complete import");
  } else if (high || rows.some((r) => r.flaky)) {
    status = "At risk";
    if (high) reasons.push(`${high} open high-severity defect(s)`);
    if (rows.some((r) => r.flaky))
      reasons.push("Required tests recovered after a failure");
  } else
    reasons.push(
      "All required tests passed cleanly; no critical or high defects",
    );
  return {
    status,
    reasons,
    rows,
    counts,
    completion: rows.length
      ? (100 *
          (counts.passed +
            counts.failed +
            counts.blocked +
            counts.expected_failure)) /
        rows.length
      : null,
    passRate:
      counts.passed + counts.failed
        ? (100 * counts.passed) / (counts.passed + counts.failed)
        : null,
  };
}
