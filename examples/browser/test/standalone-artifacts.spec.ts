import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const artifacts = [
  { file: "dashboard.html", title: /pgquic laboratory/i },
  { file: "benchmark.html", title: /pgquic benchmark/i },
  { file: "pg-cron.html", title: /pg_cron control room/i },
  { file: "commerce.html", title: /live commerce/i },
  { file: "cursors.html", title: /shared cursors/i },
];

for (const artifact of artifacts) {
  test(`${artifact.file} is a self-contained file artifact`, async ({
    page,
  }) => {
    const path = resolve("dist", artifact.file);
    const html = readFileSync(path, "utf8");
    expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
    expect(html).not.toMatch(
      /<link\b[^>]*\brel="(?:stylesheet|modulepreload)"/i,
    );
    expect(html).not.toMatch(/\b(?:src|href)="\/?assets\//i);

    await page.goto(pathToFileURL(path).href);
    await expect(page).toHaveTitle(artifact.title);
  });
}

test("pg_cron demo exposes the complete management surface", async ({
  page,
}) => {
  await page.goto(pathToFileURL(resolve("dist", "pg-cron.html")).href);
  await expect(
    page.getByRole("heading", { name: "Control room" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent runs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "pg_cron settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New job" }).click();
  await expect(
    page.getByRole("heading", { name: "Create a job" }),
  ).toBeVisible();
  await expect(page.getByText("schedule_in_database")).toBeVisible();
});

test("commerce demo exposes its live dashboard surface", async ({ page }) => {
  await page.goto(pathToFileURL(resolve("dist", "commerce.html")).href);
  await expect(
    page.getByRole("heading", { name: "Store pulse" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent orders" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await expect(page.getByText("Waiting for table events")).toBeVisible();
});

test("shared cursor demo exposes its collaboration surface", async ({
  page,
}) => {
  await page.goto(pathToFileURL(resolve("dist", "cursors.html")).href);
  await expect(
    page.getByRole("heading", { name: "Move together." }),
  ).toBeVisible();
  await expect(page.getByText("pg_notify", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Your display name")).toBeVisible();
  await expect(page.locator("#open-settings")).toBeVisible();
});
