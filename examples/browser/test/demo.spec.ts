import { test, expect } from "@playwright/test";
test("demo surface and WebTransport support", async ({ page, browserName }) => {
  await page.goto("/");
  expect(await page.title()).toContain("pgquic");
  const supported = await page.evaluate(() => "WebTransport" in globalThis);
  test.skip(
    !supported,
    `${browserName} does not expose WebTransport in this runtime`,
  );
  await expect(page.getByText("One session.")).toBeVisible();
});
