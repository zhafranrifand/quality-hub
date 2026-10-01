import { expect, test } from "@playwright/test";

test("searching for a place selects it on the map", async ({ page }) => {
  test.setTimeout(90000);
  if (process.env.LOKASI_CASE_SEARCH_MAP) {
    test.info().annotations.push({
      type: "case",
      description: process.env.LOKASI_CASE_SEARCH_MAP,
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

  const searchButton = page.getByRole("button", { name: "Search", exact: true });
  if (!(await searchButton.isVisible())) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }
  await searchButton.click();

  const searchInput = page
    .getByRole("textbox", { name: "search-autocomplete" })
    .or(page.getByPlaceholder("Enter location or coordinates"))
    .first();
  await expect(searchInput).toBeVisible();
  await searchInput.fill("Jakarta");

  const stadiumSuggestion = page
    .getByText("Jakarta International Stadium", { exact: false })
    .filter({ visible: true })
    .first();
  await expect(stadiumSuggestion).toBeVisible({ timeout: 15000 });
  await stadiumSuggestion.click();

  const mapMarker = page
    .getByRole("button", { name: /Map marker/i })
    .or(page.getByRole("img", { name: /Map marker/i }))
    .or(page.locator('[aria-label="Map marker"], [title="Map marker"]'))
    .first();
  await expect(mapMarker).toBeVisible({ timeout: 15000 });
});
