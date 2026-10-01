import { expect, test } from "@playwright/test";

const datasetName =
  "Bank and Financial Institution - POI Latest (ID - Jakarta)";

test("inspect source controls and preview a Bvarta dataset", async ({
  page,
}) => {
  test.setTimeout(90000);
  if (process.env.LOKASI_CASE_DATASET_PREVIEW) {
    test.info().annotations.push({
      type: "case",
      description: process.env.LOKASI_CASE_DATASET_PREVIEW,
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

  let explorerOpened = false;
  for (let attempt = 0; attempt < 6 && !explorerOpened; attempt++) {
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
        ) {
          throw error;
        }
      }
    } else if (current === "explorer") {
      try {
        await explorerButton.click({ timeout: 5000 });
        explorerOpened = true;
      } catch (error) {
        if (
          !(await welcomeHeading.isVisible()) &&
          !(await workspaceHeading.isVisible())
        ) {
          throw error;
        }
      }
    }
  }
  expect(explorerOpened, "Dataset Explorer should open after onboarding").toBe(
    true,
  );

  // This panel is visually modal, but does not expose role="dialog".
  const explorer = page;
  await expect(
    explorer.getByRole("heading", { name: "Dataset Explorer" }),
  ).toBeVisible();
  await expect(
    explorer.getByText("Data Explorer", { exact: true }),
  ).toBeVisible();
  await expect(
    explorer.getByText("POI Parameter", { exact: true }),
  ).toBeVisible();
  await expect(explorer.getByText(/All Datasets/i).first()).toBeVisible();

  for (const label of ["Country", "Data Source", "Spatial Aggregation"]) {
    await expect(
      explorer.getByText(label, { exact: true }).first(),
    ).toBeVisible();
  }
  await expect(explorer.getByText(/License/i).first()).toBeVisible();

  await expect(
    explorer.getByRole("button", { name: "Bvarta & Partner Data" }),
  ).toBeVisible();
  await expect(
    explorer.getByRole("button", { name: "My Organization" }),
  ).toBeVisible();
  await expect(
    explorer
      .getByRole("checkbox", { name: /Bvarta/i })
      .or(explorer.getByRole("button", { name: /^Bvarta$/i }))
      .first(),
  ).toBeVisible();

  const dataset = explorer.getByText(datasetName, { exact: true }).first();
  await expect(dataset).toBeVisible();
  const previewButton = explorer.getByRole("button", {
    name: "Preview Dataset",
  });
  await expect(previewButton).toBeDisabled();
  await dataset.click();
  await expect(previewButton).toBeEnabled();
  await previewButton.click();

  const preview = page;
  await expect(
    preview.getByText(datasetName, { exact: true }).last(),
  ).toBeVisible();
  await expect(preview.getByText(/Bvarta/i).first()).toBeVisible();
  const sampleGrid = preview
    .getByRole("table")
    .or(preview.getByRole("grid"))
    .last();
  await expect(sampleGrid).toBeVisible();
  await expect
    .poll(async () => sampleGrid.getByRole("row").count())
    .toBeGreaterThanOrEqual(10);
  await expect(
    preview
      .getByRole("textbox", { name: /search and filter/i })
      .or(preview.getByPlaceholder(/search and filter/i))
      .first(),
  ).toBeVisible();
});
