import { test, expect } from "@playwright/test";
import { report, content } from "../fixtures";
test("owner completes manual release cycle, links coverage, and sees critical gate", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill("qa@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Harness-private-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clearer view of quality." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^(Create project|New project)$/ })
    .click();
  await page.getByLabel("Project name").fill("Checkout platform");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Test Cases", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New test case", exact: true })
    .click();
  await page.getByLabel("Case title").fill("Place order successfully");
  await page.getByLabel("Step 1 action").fill("Submit a valid order");
  await page
    .getByLabel("Step 1 expected result")
    .fill("Order confirmation appears");
  await page
    .getByRole("button", { name: "Create test case", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Approve Place order successfully",
      exact: true,
    })
    .click();
  await expect(page.locator("td .badge.approved").first()).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Plans & Releases", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add environment", exact: true })
    .click();
  await page.getByLabel("Environment name").fill("staging");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByRole("button", { name: "New release", exact: true }).click();
  await page.getByLabel("Release name").fill("v1.0");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByRole("button", { name: "Create plan", exact: true }).click();
  await page.getByLabel("Plan name").fill("Checkout smoke");
  await page
    .getByRole("checkbox", { name: /Place order successfully/ })
    .check();
  await page.getByRole("checkbox", { name: "staging", exact: true }).check();
  await page.getByRole("button", { name: "Freeze plan", exact: true }).click();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await page.getByLabel("Build identifier").fill("build-001");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start run", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record result", exact: true })
    .click();
  await expect(page.getByText("passed", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Release readiness Ready/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Defects", exact: true })
    .click();
  await page.getByRole("button", { name: "New defect", exact: true }).click();
  await page.getByLabel("Defect title").fill("Payment recorded twice");
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Severity" })
    .selectOption("critical");
  await page
    .getByRole("button", { name: "Create defect", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Release readiness Blocked/ }),
  ).toBeVisible();
  await expect(
    page.getByText("1 open critical defect(s)", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../work/harness/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "A clearer view of quality." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../work/harness/dashboard-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("unauthenticated workspace returns to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  const res = await page.request.get("/api/v1/backup");
  expect(res.status()).toBe(401);
});
test("local Playwright report upload shows a flaky result and permits explicit mapping", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("qa@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Harness-private-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clearer view of quality." }),
  ).toBeVisible();
  const post = async (path: string, data: unknown) => {
    const r = await page.evaluate(
      async ({ path, data }) => {
        const session = await (await fetch("/api/v1/session")).json();
        const response = await fetch("/api/v1" + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.csrf,
          },
          body: JSON.stringify(data),
        });
        return { status: response.status, body: await response.json() };
      },
      { path, data },
    );
    expect(r.status, `${path}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
    return r.body;
  };
  const project = await post("/projects", { name: "Automation sample" });
  const c = await post(`/projects/${project.id}/cases`, content);
  await post(`/cases/${c.id}/approve`, {});
  const env = await post(`/projects/${project.id}/environments`, {
    name: "staging",
  });
  const release = await post(`/projects/${project.id}/releases`, {
    name: "v2.0",
  });
  const plan = await post(`/releases/${release.id}/plans`, {
    name: "Automated smoke",
    items: [
      { versionId: c.versionId, environmentId: env.id, browser: "chromium" },
    ],
  });
  const run = await post(`/plans/${plan.id}/runs`, {
    build: "build-002",
    kind: "automated",
  });
  await page.reload();
  await page
    .getByRole("combobox", { name: "Project" })
    .selectOption(project.id);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Test Runs", exact: true })
    .click();
  await page.getByRole("button", { name: "Open run", exact: true }).click();
  await page.getByLabel("Playwright JSON report").setInputFiles({
    name: "results.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(report(null, ["failed", "passed"]))),
  });
  await page
    .getByRole("button", { name: "Import report", exact: true })
    .click();
  await expect(
    page.getByText("Map this result to planned scope"),
  ).toBeVisible();
  await page.getByLabel("Planned case").selectOption(plan.items[0].id);
  await page
    .getByRole("button", { name: "Verify mapping", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Release readiness At risk/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Required tests recovered after a failure", { exact: true }),
  ).toBeVisible();
  const detail = await (
    await page.request.get("/api/v1/runs/" + run.id)
  ).json();
  expect(detail.executions[0].attempts).toHaveLength(2);
});
