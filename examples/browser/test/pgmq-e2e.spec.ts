import { expect, test } from "@playwright/test";

test("inspect ordered PGMQ messages and archives over pgquic", async ({
  page,
  browserName,
}) => {
  test.skip(
    process.env.PGQUIC_E2E !== "1",
    "set PGQUIC_E2E=1 with the Docker Compose stack running",
  );
  await page.goto("/pgmq.html");
  const supported = await page.evaluate(() => "WebTransport" in globalThis);
  test.skip(
    !supported,
    `${browserName} does not expose WebTransport in this runtime`,
  );

  await expect(page.locator("#connection-status")).toHaveText("connected", {
    timeout: 30_000,
  });
  await expect(page.locator("#queue-count")).toHaveText("3");
  const queue = page.locator(".queue").filter({ hasText: "order_events" });
  await expect(queue).toContainText("NEXT");
  await expect(queue).toContainText("order.paid");
  await expect(queue).toContainText("trace-id");

  await queue.getByRole("button", { name: "Inspect queue" }).click();
  const messages = page.locator("#messages-list .message");
  await expect(messages).toHaveCount(2);
  await expect(messages.first()).toContainText("order.paid");
  await expect(messages.first().getByText("Body", { exact: true })).toBeVisible();
  await expect(
    messages.first().getByText("Headers", { exact: true }),
  ).toBeVisible();
  await expect(
    messages.first().getByRole("button", { name: "Archive" }),
  ).toBeVisible();
  await expect(
    messages.first().getByRole("button", { name: "Delete permanently" }),
  ).toBeVisible();

  const archived = page.locator("#archive-list .message").filter({
    hasText: "order_events",
  });
  await expect(archived).toContainText("order.created");
  await expect(archived).toContainText("trace-id");
});
