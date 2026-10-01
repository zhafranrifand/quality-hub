import { expect } from "@playwright/test";
import { createBdd, test } from "playwright-bdd";
import type { Page } from "@playwright/test";

const { Given, When, Then } = createBdd(test);
const target =
  process.env.LOKASI_BASE_URL || "https://dev.lokasi.com/intelligence";
const datasetName =
  "Bank and Financial Institution - POI Latest (ID - Jakarta)";

async function openLogin(page: Page) {
  await page.goto(target);
  await expect(
    page.getByRole("heading", { name: "Welcome Back" }),
  ).toBeVisible();
}

async function signIn(page: Page) {
  test.setTimeout(90000);
  const email = process.env.LOKASI_EMAIL;
  const password = process.env.LOKASI_PASSWORD;
  test.skip(!email || !password, "Set LOKASI_EMAIL and LOKASI_PASSWORD");
  if (!email || !password) return;

  await page.goto(target);
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
}

async function finishOnboarding(page: Page) {
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
}

When("I open the LOKASI sign-in page", async ({ page }) => openLogin(page));

Then("the email entry and Continue button are visible", async ({ page }) => {
  await expect(
    page.getByRole("textbox", { name: "Email Address" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

Then(
  "Continue is disabled and password recovery is available",
  async ({ page }) => {
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Forgot password?" }),
    ).toBeVisible();
  },
);

When(
  "I open the sign-in page on a {int} pixel viewport",
  async ({ page }, width: number) => {
    await page.setViewportSize({ width, height: 844 });
    await openLogin(page);
  },
);

Then(
  "the sign-in controls fit without horizontal overflow",
  async ({ page }) => {
    await expect(
      page.getByRole("textbox", { name: "Email Address" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      contentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.contentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
  },
);

When("I continue with the configured account email", async ({ page }) => {
  const email = process.env.LOKASI_EMAIL;
  test.skip(!email, "Set LOKASI_EMAIL to exercise the account lookup step");
  if (!email) return;

  const responses: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname === "dev.lokasi.com" && url.pathname.startsWith("/api")) {
      responses.push(`${response.status()} ${url.pathname}`);
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "dev.lokasi.com") {
      responses.push(`FAILED ${url.pathname}`);
    }
  });
  await page.getByRole("textbox", { name: "Email Address" }).fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  try {
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible({
      timeout: 8000,
    });
  } catch (error) {
    console.log(
      `Sign-in API responses: ${responses.join(", ") || "none captured"}`,
    );
    throw error;
  }
});

Then("the password entry is displayed", async ({ page }) => {
  await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
});

Given("I am signed in to the LOKASI workspace", async ({ page }) => {
  await signIn(page);
  await finishOnboarding(page);
});

When("I open each primary Intelligence module", async ({ page }) => {
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
        const dialog = page.getByRole("dialog");
        await expect(
          dialog.getByRole("heading", {
            name: "Get started with spatial analysis",
          }),
        ).toBeVisible();
        await dialog.getByRole("button", { name: "Close" }).click();
      }
      await expect(page).toHaveURL(/\/intelligence/);
      if (moduleName === "Agentic AI") {
        await expect(page).toHaveURL(/\/intelligence\/agentic-ai$/);
        await expect(
          page.getByRole("heading", { name: "AI Intelligence" }),
        ).toBeVisible();
      }
      if (
        moduleName === "Dataset Explorer" ||
        moduleName === "Dataset Management"
      ) {
        await expect(
          page.getByRole("heading", { name: moduleName }),
        ).toBeVisible();
      }
      if (moduleName === "Dataset Management") {
        await expect(page).toHaveURL(/\/intelligence\/dataset-management$/);
      }
      if (moduleName === "Historical Analysis") {
        await expect(page).toHaveURL(/\/intelligence\/analysis-history$/);
      }
      const closeOverlay = page
        .getByRole("button", { name: /^Close(?: |$)/ })
        .filter({ visible: true })
        .first();
      if (await closeOverlay.isVisible()) await closeOverlay.click();
    });
  }
});

Then(
  "each module loads inside the Intelligence workspace",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/intelligence/);
  },
);

When("I search for Jakarta International Stadium", async ({ page }) => {
  test.setTimeout(90000);
  const searchButton = page.getByRole("button", {
    name: "Search",
    exact: true,
  });
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
  const suggestion = page
    .getByText("Jakarta International Stadium", { exact: false })
    .filter({ visible: true })
    .first();
  await expect(suggestion).toBeVisible({ timeout: 15000 });
  await suggestion.click();
});

Then("the selected place is marked on the map", async ({ page }) => {
  const marker = page
    .getByRole("button", { name: /Map marker/i })
    .or(page.getByRole("img", { name: /Map marker/i }))
    .or(page.locator('[aria-label="Map marker"], [title="Map marker"]'))
    .first();
  await expect(marker).toBeVisible({ timeout: 15000 });
});

async function openJakartaPartnerPreview(page: Page) {
  test.setTimeout(90000);
  const welcomeHeading = page.getByRole("heading", {
    name: "Welcome to LOKASI",
  });
  const workspaceHeading = page.getByRole("heading", {
    name: "LOKASI Workspace",
  });
  const explorerButton = page.getByRole("button", {
    name: "Dataset Explorer",
    exact: true,
  });
  const sidebarButton = page.getByRole("button", { name: "Toggle Sidebar" });
  const surface = async () => {
    if (await welcomeHeading.isVisible()) return "welcome";
    if (await workspaceHeading.isVisible()) return "workspace";
    if (await explorerButton.isVisible()) return "explorer";
    if (await sidebarButton.isVisible()) return "sidebar";
    return "loading";
  };
  let opened = false;
  for (let attempt = 0; attempt < 6 && !opened; attempt++) {
    await expect.poll(surface, { timeout: 20000 }).not.toBe("loading");
    const current = await surface();
    if (current === "welcome") {
      await page
        .getByRole("button", { name: "Continue to workspace tour" })
        .click();
      await expect(welcomeHeading).toBeHidden();
      await expect(workspaceHeading).toBeVisible();
    } else if (current === "workspace") {
      await workspaceHeading.locator("..").getByRole("button").first().click();
      await expect(workspaceHeading).toBeHidden();
    } else if (current === "sidebar") {
      try {
        await sidebarButton.click({ timeout: 5000 });
      } catch (error) {
        if (
          !(await welcomeHeading.isVisible()) &&
          !(await workspaceHeading.isVisible())
        )
          throw error;
      }
    } else if (current === "explorer") {
      try {
        await explorerButton.click({ timeout: 5000 });
        opened = true;
      } catch (error) {
        if (
          !(await welcomeHeading.isVisible()) &&
          !(await workspaceHeading.isVisible())
        )
          throw error;
      }
    }
  }
  expect(opened, "Dataset Explorer should open after onboarding").toBe(true);

  await expect(
    page.getByRole("heading", { name: "Dataset Explorer" }),
  ).toBeVisible();
  await expect(page.getByText("Data Explorer", { exact: true })).toBeVisible();
  await expect(page.getByText("POI Parameter", { exact: true })).toBeVisible();
  await expect(page.getByText(/All Datasets/i).first()).toBeVisible();
  for (const label of ["Country", "Data Source", "Spatial Aggregation"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/License/i).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bvarta & Partner Data" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "My Organization" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("checkbox", { name: /Bvarta/i })
      .or(page.getByRole("button", { name: /^Bvarta$/i }))
      .first(),
  ).toBeVisible();
  const dataset = page.getByText(datasetName, { exact: true }).first();
  await expect(dataset).toBeVisible();
  const previewButton = page.getByRole("button", {
    name: "Preview Dataset",
  });
  await expect(previewButton).toBeDisabled();
  await dataset.click();
  await expect(previewButton).toBeEnabled();
  await previewButton.click();
  await expect(
    page.getByText(datasetName, { exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByText(/Bvarta/i).first()).toBeVisible();
  const grid = page.getByRole("table").or(page.getByRole("grid")).last();
  await expect(grid).toBeVisible();
  await expect
    .poll(async () => grid.getByRole("row").count())
    .toBeGreaterThanOrEqual(10);
  await expect(
    page
      .getByRole("textbox", { name: /search and filter/i })
      .or(page.getByPlaceholder(/search and filter/i))
      .first(),
  ).toBeVisible();
}

When(
  "I open Dataset Explorer and preview the Jakarta partner dataset",
  async ({ page }) => openJakartaPartnerPreview(page),
);

When("I preview the Jakarta partner dataset", async ({ page }) =>
  openJakartaPartnerPreview(page),
);

Then(
  "its provider, sample rows, and search control are visible",
  async ({ page }) => {
    await expect(page.getByText(/Bvarta/i).first()).toBeVisible();
    await expect(
      page
        .getByRole("textbox", { name: /search and filter/i })
        .or(page.getByPlaceholder(/search and filter/i))
        .first(),
    ).toBeVisible();
  },
);

Then(
  "filtering the preview and clearing the filter restores the sample rows",
  async ({ page }) => {
    const grid = page.getByRole("grid").last();
    const dataRows = grid.getByRole("rowgroup").last().getByRole("row");
    const initialRowCount = await dataRows.count();
    expect(initialRowCount).toBeGreaterThanOrEqual(10);

    const firstDataRow = dataRows.first();
    await expect(firstDataRow).toBeVisible();
    const firstCell = firstDataRow.getByRole("gridcell").first();
    const searchValue = (await firstCell.innerText()).trim();
    expect(
      searchValue,
      "the first sample row should have a searchable value",
    ).not.toBe("");

    const search = page
      .getByRole("textbox", { name: /search and filter/i })
      .or(page.getByPlaceholder(/search and filter/i))
      .first();
    await search.click();
    await expect(
      search,
      "Search and filter should become editable when the user activates it",
    ).toBeEditable({ timeout: 5000 });
    await search.fill(searchValue);
    await expect
      .poll(async () => dataRows.count(), {
        message: "the search should narrow sample rows",
      })
      .toBeLessThan(initialRowCount);
    await expect(
      grid.getByRole("gridcell", { name: searchValue, exact: true }).first(),
    ).toBeVisible();

    await search.fill("");
    await expect
      .poll(async () => dataRows.count(), {
        message: "clearing search should restore sample rows",
      })
      .toBe(initialRowCount);
  },
);

When("I open analysis and leave the filter area invalid", async ({ page }) => {
  test.setTimeout(90000);
  const analysisButton = page.getByRole("button", {
    name: "Analysis",
    exact: true,
  });
  if (!(await analysisButton.isVisible())) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }
  await analysisButton.click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Get started with spatial analysis",
    }),
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

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

Then("Save remains disabled", async ({ page }) => {
  await expect(
    page
      .getByRole("button", { name: "Save", exact: true })
      .filter({ visible: true })
      .last(),
  ).toBeDisabled();
});
