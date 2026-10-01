import { expect, test } from "@playwright/test";

test("authorized account can open Intelligence modules", async ({ page }) => {
  test.setTimeout(90000);
  if (process.env.LOKASI_CASE_AUTH_NAV) {
    test.info().annotations.push({
      type: "case",
      description: process.env.LOKASI_CASE_AUTH_NAV,
    });
  }
  const email = process.env.LOKASI_EMAIL;
  const password = process.env.LOKASI_PASSWORD;
  test.skip(!email || !password, "Set LOKASI_EMAIL and LOKASI_PASSWORD");
  if (!email || !password) return;

  await page.goto(
    process.env.LOKASI_BASE_URL || "https://dev.lokasi.com/intelligence",
  );
  await page.getByRole("textbox", { name: "Email Address" }).fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: /sign in|continue|log in/i }).click();

  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/intelligence") &&
      !url.pathname.includes("/sso/callback"),
    { timeout: 30000 },
  );
  await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeHidden({
    timeout: 15000,
  });
  await expect
    .poll(async () => (await page.locator("body").innerText()).length, {
      timeout: 20000,
    })
    .toBeGreaterThan(40);

  const welcomeHeading = page.getByRole("heading", {
    name: "Welcome to LOKASI",
  });
  if (await welcomeHeading.isVisible()) {
    await page
      .getByRole("button", { name: "Continue to workspace tour" })
      .click();
    await expect(welcomeHeading).toBeHidden();
    const workspaceHeading = page.getByRole("heading", {
      name: "LOKASI Workspace",
    });
    await expect(workspaceHeading).toBeVisible();
    await workspaceHeading.locator("..").getByRole("button").first().click();
    await expect(workspaceHeading).toBeHidden();
  }
  if (!(await page.getByRole("button", { name: "Agentic AI" }).isVisible())) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }

  for (const moduleName of [
    "Agentic AI",
    "Analysis",
    "Dataset Explorer",
    "Dataset Management",
    "Search",
    "Historical Analysis",
  ]) {
    await test.step(`open ${moduleName}`, async () => {
      await page.getByRole("button", { name: moduleName, exact: true }).click({
        timeout: 5000,
      });
      if (moduleName === "Analysis") {
        const templateDialog = page.getByRole("dialog");
        await expect(
          templateDialog.getByRole("heading", {
            name: "Get started with spatial analysis",
          }),
        ).toBeVisible();
        await templateDialog.getByRole("button", { name: "Close" }).click();
      }
      await expect(page).toHaveURL(/\/intelligence/);
      if (moduleName === "Agentic AI") {
        await expect(page).toHaveURL(/\/intelligence\/agentic-ai$/);
        await expect(
          page.getByRole("heading", { name: "AI Intelligence" }),
        ).toBeVisible();
      }
      if (moduleName === "Dataset Explorer") {
        await expect(
          page.getByRole("heading", { name: moduleName }),
        ).toBeVisible();
      }
      if (moduleName === "Dataset Management") {
        await expect(page).toHaveURL(/\/intelligence\/dataset-management$/);
        await expect(
          page.getByRole("heading", { name: moduleName }),
        ).toBeVisible();
      }
      if (moduleName === "Historical Analysis") {
        await expect(page).toHaveURL(/\/intelligence\/analysis-history$/);
        await expect(
          page.getByRole("heading", { name: moduleName }),
        ).toBeVisible();
      }
      const closeOverlay = page
        .getByRole("button", { name: /^Close(?: |$)/ })
        .filter({ visible: true })
        .first();
      if (await closeOverlay.isVisible()) await closeOverlay.click();
    });
  }
});
