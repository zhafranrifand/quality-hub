import { test, expect } from "@playwright/test";
import { content } from "../fixtures";

test("case table paginates and execution-method filtering resets the page", async ({
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

  const post = async (path: string, body: unknown) => {
    const result = await page.evaluate(
      async ({ path, body }) => {
        const session = await (await fetch("/api/v1/session")).json();
        const response = await fetch(`/api/v1${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": session.csrf,
          },
          body: JSON.stringify(body),
        });
        return { status: response.status, data: await response.json() };
      },
      { path, body },
    );
    expect(result.status, path).toBeLessThan(300);
    return result.data;
  };

  const project = await post("/projects", { name: "Paged cases" });
  for (let index = 1; index <= 12; index++) {
    await post(`/projects/${project.id}/cases`, {
      ...content,
      title: `Case ${String(index).padStart(2, "0")}`,
      executionMode: index <= 8 ? "manual" : index <= 10 ? "automated" : "both",
    });
  }

  await page.reload();
  await page
    .getByRole("combobox", { name: "Project" })
    .selectOption(project.id);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Test Cases", exact: true })
    .click();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(10);
  await expect(page.getByText("Showing 1–10 of 12")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("Showing 11–12 of 12")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Execution method filter" })
    .selectOption("manual");
  await expect(rows).toHaveCount(8);
  await expect(page.getByText("Showing 1–8 of 8")).toBeVisible();
  await page.getByRole("button", { name: "New test case" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("combobox", { name: /Execution method/ }),
  ).toHaveValue("both");
});
