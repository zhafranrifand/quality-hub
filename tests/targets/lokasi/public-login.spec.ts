import { test, expect, type Page } from "@playwright/test";

async function openLogin(page: Page) {
  await page.goto(
    process.env.LOKASI_BASE_URL || "https://dev.lokasi.com/intelligence",
  );
  await expect(
    page.getByRole("heading", { name: "Welcome Back" }),
  ).toBeVisible();
}

function linkCase(id: string | undefined) {
  if (id) test.info().annotations.push({ type: "case", description: id });
}

test("sign-in entry point renders", async ({ page }) => {
  linkCase(process.env.LOKASI_CASE_SIGNIN);
  await openLogin(page);
  await expect(
    page.getByRole("textbox", { name: "Email Address" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

test("continue is disabled without an email", async ({ page }) => {
  linkCase(process.env.LOKASI_CASE_EMPTY_EMAIL);
  await openLogin(page);
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Forgot password?" }),
  ).toBeVisible();
});

test("sign-in entry point works on a phone-sized screen", async ({ page }) => {
  linkCase(process.env.LOKASI_CASE_MOBILE);
  await page.setViewportSize({ width: 390, height: 844 });
  await openLogin(page);
  await expect(
    page.getByRole("textbox", { name: "Email Address" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});
