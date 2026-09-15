import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("two browser pages exchange cursors through LISTEN/NOTIFY", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    process.env.PGQUIC_E2E !== "1",
    "set PGQUIC_E2E=1 with the Docker Compose stack running",
  );
  test.skip(
    browserName !== "chromium",
    "the end-to-end cursor test requires Chromium WebTransport",
  );

  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.grantPermissions", {
    permissions: ["localNetworkAccess"],
  });
  const peer = await context.newPage();
  const demoUrl = pathToFileURL(resolve("dist", "cursors.html")).href;
  await Promise.all([page.goto(demoUrl), peer.goto(demoUrl)]);

  await expect(page.locator("#connection-status")).toHaveText("Live", {
    timeout: 30_000,
  });
  await expect(peer.locator("#connection-status")).toHaveText("Live", {
    timeout: 30_000,
  });
  await page.mouse.move(180, 220);

  await expect(peer.locator(".remote-cursor")).toHaveCount(2, {
    timeout: 10_000,
  });
  await expect(peer.locator("#presence-count")).toHaveText("2 people");
});
