import { expect, test } from "@playwright/test";

test("streams trigger notifications into the React dashboard", async ({
  page,
  browserName,
}) => {
  test.skip(
    process.env.PGQUIC_E2E !== "1",
    "set PGQUIC_E2E=1 with the Docker Compose stack running",
  );
  await page.goto("/commerce.html");
  const supported = await page.evaluate(() => "WebTransport" in globalThis);
  test.skip(
    !supported,
    `${browserName} does not expose WebTransport in this runtime`,
  );

  await expect(page.getByText("live", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await expect(page.locator(".activity-item").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".activity-item").first()).toContainText(
    /orders|products|customers/,
  );
});
