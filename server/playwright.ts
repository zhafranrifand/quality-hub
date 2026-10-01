import { z } from "zod";
import type { ImportedTest, Attempt } from "../shared/contracts.js";
const annotation = z.object({
  type: z.string(),
  description: z.string().optional(),
});
const result = z.object({
  status: z.enum(["passed", "failed", "timedOut", "skipped", "interrupted"]),
  duration: z.number().nonnegative().default(0),
  retry: z.number().int().nonnegative().default(0),
  errors: z
    .array(
      z.object({
        message: z.string().optional(),
        stack: z.string().optional(),
      }),
    )
    .default([]),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        path: z.string().optional(),
        contentType: z.string().optional(),
      }),
    )
    .default([]),
});
const test = z.object({
  projectName: z.string().default(""),
  projectId: z.string().default(""),
  expectedStatus: z.enum(["passed", "failed", "skipped"]).default("passed"),
  annotations: z.array(annotation).default([]),
  results: z.array(result),
  status: z.enum(["expected", "unexpected", "flaky", "skipped"]).optional(),
});
const spec = z.object({
  title: z.string(),
  id: z.string().optional(),
  file: z.string().optional(),
  tests: z.array(test),
});
const suite: z.ZodType<any> = z.lazy(() =>
  z.object({
    title: z.string().default(""),
    file: z.string().optional(),
    specs: z.array(spec).default([]),
    suites: z.array(suite).default([]),
  }),
);
const report = z.object({
  suites: z.array(suite),
  config: z
    .object({
      projects: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string(),
            metadata: z.record(z.string(), z.unknown()).optional(),
            use: z.object({ browserName: z.string().optional() }).optional(),
          }),
        )
        .default([]),
    })
    .optional(),
  errors: z.array(z.unknown()).default([]),
  stats: z
    .object({
      startTime: z.string().optional(),
      duration: z.number().optional(),
    })
    .optional(),
});
export function parseReport(input: unknown) {
  const data = report.parse(input);
  const tests: ImportedTest[] = [];
  let incomplete = data.errors.length > 0;
  const walk = (s: any, parents: string[]) => {
    for (const raw of s.specs) {
      const sp = spec.parse(raw);
      for (const t of sp.tests) {
        if (tests.length >= 5000)
          throw new Error("Report exceeds 5,000 tests; split the run.");
        const project = data.config?.projects.find(
          (p) => p.name === t.projectName || p.id === t.projectId,
        );
        const browser =
          project?.use?.browserName ||
          String(project?.metadata?.browserName || t.projectName || "chromium");
        const explicit = t.annotations
          .filter((a) => a.type === "case" && a.description)
          .map((a) => a.description!);
        if (explicit.length > 1)
          throw new Error("Use one case annotation per test.");
        const attempts: Attempt[] = t.results.map((r) => ({
          status:
            r.status === "timedOut"
              ? "failed"
              : r.status === "failed" && t.expectedStatus === "failed"
                ? "expected_failure"
                : r.status === "passed" && t.expectedStatus !== "passed"
                  ? "failed"
                  : r.status,
          duration: Math.round(r.duration),
          retry: r.retry,
          error: r.errors
            .map((e) => e.message || e.stack || "")
            .join("\n")
            .slice(0, 20000),
          actualStatus: r.status,
          expectedStatus: t.expectedStatus,
          attachments: r.attachments,
        }));
        if (!attempts.length) {
          incomplete = true;
          attempts.push({
            status: "not_run",
            duration: 0,
            retry: 0,
            error: "",
          });
        }
        if (attempts.some((a) => a.status === "interrupted")) incomplete = true;
        const title = [...parents, sp.title].filter(Boolean).join(" › ");
        const key = JSON.stringify([
          sp.file || s.file || "",
          title,
          t.projectName,
        ]);
        tests.push({
          key,
          title,
          projectName: t.projectName,
          browser,
          caseId: explicit[0] || null,
          attempts,
          flaky:
            attempts.at(-1)?.status === "passed" &&
            attempts.slice(0, -1).some((a) => a.status === "failed"),
        });
      }
    }
    for (const child of s.suites)
      walk(child, [...parents, ...(child.file ? [] : [child.title])]);
  };
  data.suites.forEach((s) => walk(s, []));
  if (!tests.length)
    throw new Error(
      "Report contains no tests. Export a Playwright JSON report.",
    );
  if (new Set(tests.map((t) => t.key)).size !== tests.length)
    throw new Error(
      "Duplicate test identities; split repeated tests into separate runs.",
    );
  return { tests, complete: !incomplete };
}
