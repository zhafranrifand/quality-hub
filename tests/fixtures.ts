export const content = {
  title: "Complete checkout",
  preconditions: "An active account",
  steps: [{ action: "Submit order", expected: "Order confirmed" }],
  priority: "high",
  component: "Checkout",
  tags: ["smoke"],
};
export function report(
  caseId: string | null = "TC-123",
  statuses = ["passed"],
  options: {
    expectedStatus?: string;
    errors?: unknown[];
    browser?: string;
    tags?: string[];
  } = {},
) {
  return {
    config: { projects: [{ name: options.browser || "chromium" }] },
    suites: [
      {
        title: "checkout.spec.ts",
        file: "checkout.spec.ts",
        specs: [
          {
            title: "Complete checkout",
            file: "checkout.spec.ts",
            tags: options.tags || [],
            tests: [
              {
                projectName: options.browser || "chromium",
                expectedStatus: options.expectedStatus || "passed",
                annotations: caseId
                  ? [{ type: "case", description: caseId }]
                  : [],
                results: statuses.map((status, retry) => ({
                  status,
                  retry,
                  duration: 42,
                  errors:
                    status === "failed"
                      ? [{ message: "Expected confirmation" }]
                      : [],
                  attachments: [
                    {
                      name: "trace",
                      path: "test-results/trace.zip",
                      contentType: "application/zip",
                    },
                  ],
                })),
              },
            ],
          },
        ],
      },
    ],
    errors: options.errors || [],
  };
}
