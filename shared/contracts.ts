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
export const automationKeySchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/);
export const gherkinStepSchema = z.object({
  keyword: z.enum(["Given", "When", "Then", "And", "But", "*"]),
  text: z.string().trim().min(1).max(5000),
});
export const automationSourceSchema = z.object({
  key: automationKeySchema,
  featurePath: z.string().trim().min(1).max(500),
  gherkin: z.string().trim().min(1).max(20000),
  background: z.array(z.string().trim().min(1).max(5000)).max(50),
  steps: z.array(gherkinStepSchema).min(1).max(100),
  tags: z.array(z.string().trim().min(1).max(50)).max(30),
});
export const automationSyncRequestSchema = z
  .object({
    browser: nameSchema,
    scenarios: z
      .array(
        automationSourceSchema.extend({
          title: nameSchema,
          legacyCaseId: z
            .string()
            .regex(/^TC-[A-Z0-9][A-Z0-9_-]*$/i)
            .optional(),
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine(({ scenarios }, ctx) => {
    const keys = new Set<string>();
    scenarios.forEach((scenario, index) => {
      if (keys.has(scenario.key))
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", index, "key"],
          message: "Scenario keys must be unique in a sync request",
        });
      keys.add(scenario.key);
      const sourceTags = scenario.tags
        .map((tag) => tag.replace(/^@/, ""))
        .filter((tag) => tag.startsWith("qh_key_"));
      if (
        sourceTags.length > 1 ||
        (sourceTags.length === 1 && sourceTags[0] !== `qh_key_${scenario.key}`)
      )
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", index, "tags"],
          message: "The qh_key tag must match the scenario key",
        });
      if (/^\s*Scenario\s+Outline\s*:/im.test(scenario.gherkin))
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", index, "gherkin"],
          message: "Scenario Outlines are not supported by automation sync v1",
        });
    });
  });
export const automationRunRequestSchema = z
  .object({
    build: nameSchema,
    kind: z.enum(["manual", "automated"]),
    automationKeys: z.array(automationKeySchema).min(1).max(500).optional(),
    browser: nameSchema.optional(),
  })
  .superRefine(({ automationKeys }, ctx) => {
    if (
      automationKeys &&
      new Set(automationKeys).size !== automationKeys.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["automationKeys"],
        message: "Automation keys must be unique",
      });
  });
export const automationPreflightRequestSchema = z
  .object({
    automationKeys: z.array(automationKeySchema).min(1).max(500),
    browser: nameSchema,
    build: nameSchema,
    runId: idSchema.optional(),
  })
  .superRefine(({ automationKeys }, ctx) => {
    if (new Set(automationKeys).size !== automationKeys.length)
      ctx.addIssue({
        code: "custom",
        path: ["automationKeys"],
        message: "Automation keys must be unique",
      });
  });
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
export const caseVersionSchema = caseInput.extend({
  automationSource: automationSourceSchema.optional(),
});
export type CaseContent = Omit<z.infer<typeof caseInput>, "executionMode"> & {
  executionMode?: ExecutionMode;
  automationSource?: z.infer<typeof automationSourceSchema>;
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
  automationKey?: string | null;
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
