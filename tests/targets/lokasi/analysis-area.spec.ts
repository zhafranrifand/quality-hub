import { expect, test } from "@playwright/test";

test("analysis area configuration keeps Save disabled without a valid area", async ({
  page,
}) => {
  test.setTimeout(90000);
  if (process.env.LOKASI_CASE_ANALYSIS_AREA) {
    test.info().annotations.push({
      type: "case",
      description: process.env.LOKASI_CASE_ANALYSIS_AREA,
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

  const analysisButton = page.getByRole("button", {
    name: "Analysis",
    exact: true,
  });
  if (!(await analysisButton.isVisible())) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }
  await analysisButton.click();

  const templateDialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Get started with spatial analysis",
    }),
  });
  await expect(templateDialog).toBeVisible();
  await templateDialog.getByRole("button", { name: "Close" }).click();
  await expect(templateDialog).toBeHidden();

  const spatialSettings = page
    .getByText("Spatial Settings", { exact: true })
    .filter({ visible: true })
    .first();
  if (await spatialSettings.isVisible()) {
    await test.info().attach("spatial-settings-options", {
      body: await spatialSettings.locator("..").innerText(),
      contentType: "text/plain",
    });
  }

  await page.getByRole("button", { name: "Set Filter Area" }).click();
  const saveButton = page
    .getByRole("button", { name: "Save", exact: true })
    .filter({ visible: true })
    .last();
  await expect(saveButton).toBeVisible();
  await expect(saveButton).toBeDisabled();
});
