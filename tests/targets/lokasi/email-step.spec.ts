import { expect, test } from "@playwright/test";

test("known account advances from email to password", async ({ page }) => {
  if (process.env.LOKASI_CASE_EMAIL_STEP) {
    test.info().annotations.push({
      type: "case",
      description: process.env.LOKASI_CASE_EMAIL_STEP,
    });
  }
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

  await page.goto(
    process.env.LOKASI_BASE_URL || "https://dev.lokasi.com/intelligence",
  );
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
