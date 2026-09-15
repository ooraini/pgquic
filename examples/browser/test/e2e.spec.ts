import { test, expect } from "@playwright/test";
test("real PostgreSQL multiplexing demonstration", async ({
  page,
  browserName,
}) => {
  test.skip(
    process.env.PGQUIC_E2E !== "1",
    "set PGQUIC_E2E=1 with the Docker Compose stack running",
  );
  await page.goto("/");
  const supported = await page.evaluate(() => "WebTransport" in globalThis);
  test.skip(
    !supported,
    `${browserName} does not expose WebTransport in this runtime`,
  );
  await page
    .getByRole("button", { name: "Run complete demonstration" })
    .click();
  await expect(
    page.getByText(/Three Pool clients active over session/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("Three independent transactions committed"),
  ).toBeVisible();
  await expect(
    page.getByText("LISTEN/NOTIFY crossed separate connections"),
  ).toBeVisible();
  await expect(
    page.getByText("Cancellation used a temporary WebTransport stream"),
  ).toBeVisible();
  await expect(page.locator("#sessions")).toHaveText("1");
});
