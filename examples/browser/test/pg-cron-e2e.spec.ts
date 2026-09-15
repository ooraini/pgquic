import { expect, test } from "@playwright/test";

test("manage a pg_cron job over pgquic", async ({ page, browserName }) => {
  test.skip(
    process.env.PGQUIC_E2E !== "1",
    "set PGQUIC_E2E=1 with the Docker Compose stack running",
  );
  await page.goto("/pg-cron.html");
  const supported = await page.evaluate(() => "WebTransport" in globalThis);
  test.skip(
    !supported,
    `${browserName} does not expose WebTransport in this runtime`,
  );

  await expect(page.locator("#connection-status")).toHaveText("connected", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "New job" }).click();
  await page.locator("#job-name").fill("pgquic-e2e-cron");
  await page.locator("#job-schedule").fill("1 second");
  await page.locator("#job-command").fill("SELECT 1");
  await page.getByRole("button", { name: "Create job" }).click();

  const job = page.locator("#jobs-body tr").filter({
    hasText: "pgquic-e2e-cron",
  });
  await expect(job).toBeVisible();
  await expect(job.locator(".badge")).toHaveText("succeeded", {
    timeout: 30_000,
  });

  await job.getByRole("button", { name: "Pause" }).click();
  await expect(job.getByRole("button", { name: "Resume" })).toBeVisible();

  page.once("dialog", (confirmation) => confirmation.accept());
  await job.getByRole("button", { name: "Delete" }).click();
  await expect(job).toHaveCount(0);
});
