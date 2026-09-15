import { expect, test } from "@playwright/test";

test.describe("Leaveboard PostgreSQL security", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      process.env.PGQUIC_E2E !== "1",
      "set PGQUIC_E2E=1 with the Docker Compose stack running",
    );
    await page.goto("/security.html");
    const supported = await page.evaluate(() => "WebTransport" in globalThis);
    test.skip(
      !supported,
      `${browserName} does not expose WebTransport in this runtime`,
    );
  });

  test("employee login sees only its own request", async ({ page }) => {
    await page.getByRole("button", { name: /Ava/ }).click();
    await page
      .getByRole("button", { name: /Connect directly to PostgreSQL/ })
      .click();

    await expect(
      page.getByRole("heading", { name: "Vacation requests" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".request")).toHaveCount(1);
    await expect(page.getByText("ava_employee", { exact: true })).toBeVisible();
  });

  test("manager login sees direct reports and approval controls", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Maya/ }).click();
    await page
      .getByRole("button", { name: /Connect directly to PostgreSQL/ })
      .click();

    await expect(page.locator(".request")).toHaveCount(4, {
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
  });
});
