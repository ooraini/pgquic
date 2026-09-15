import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dashboardURL = pathToFileURL(resolve("dist/dashboard.html")).href;

test("portable dashboard is self-contained and runs from file://", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    process.env.PGQUIC_E2E !== "1",
    "set PGQUIC_E2E=1 with the Docker Compose stack running",
  );
  const artifact = readFileSync("dist/dashboard.html", "utf8");
  expect(artifact).not.toMatch(/<script\b[^>]*\bsrc=/i);
  expect(artifact).not.toMatch(/<link\b[^>]*\brel="stylesheet"/i);
  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Browser.grantPermissions", {
      permissions: ["localNetworkAccess"],
    });
  }
  await page.goto(dashboardURL);
  const runtime = await page.evaluate(() => ({
    secure: window.isSecureContext,
    webTransport: "WebTransport" in window,
    protocol: location.protocol,
  }));
  expect(runtime.secure).toBe(true);
  expect(runtime.protocol).toBe("file:");
  test.skip(
    !runtime.webTransport,
    `${browserName} does not expose WebTransport in this runtime`,
  );
  await expect(page.getByText("Portable file mode active")).toBeVisible();

  const env = readFileSync("../../deploy/.env", "utf8");
  const hash = /^PGQUIC_CERT_HASH=(.+)$/m.exec(env)?.[1];
  if (hash) {
    await page.locator("#certificate-hash").fill(hash);
    await page.getByRole("button", { name: "Close & recreate pool" }).click();
  }
  await page
    .getByRole("button", { name: "Run complete demonstration" })
    .click();
  await expect(
    page.getByText(/Three Pool clients active over session/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("LISTEN/NOTIFY crossed separate connections"),
  ).toBeVisible();
  await expect(
    page.getByText("Cancellation used a temporary WebTransport stream"),
  ).toBeVisible();
  await expect(
    page.getByText(/Large-result exercise returned 10000 rows/),
  ).toBeVisible();
  await expect(page.locator("#sessions")).toHaveText("1");
});
