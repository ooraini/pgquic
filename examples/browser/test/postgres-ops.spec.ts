import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("Postgres operations dashboard is a no-build single HTML file", async ({
  page,
}) => {
  const html = readFileSync("postgres-ops.html", "utf8");

  expect(html).toContain("@ooraini/pgquic@0.1.0/dist/index.js");
  expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
  expect(html).not.toMatch(/<link\b[^>]*\brel=["']stylesheet["']/i);

  await page.addInitScript(() => {
    if (!("WebTransport" in window)) {
      Object.defineProperty(window, "WebTransport", { value: class {} });
    }
  });
  await page.route("https://cdn.jsdelivr.net/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
        export class PgWebTransport extends EventTarget {
          constructor() {
            super();
            this.state = { status: "connected" };
          }
          async close() {}
        }
        export class Pool {
          async end() {}
          async query(sql) {
            if (sql.includes("current_database() as database_name")) return { rows: [{
              database_name: "app", current_user: "ops_monitor",
              server_version: "17.2", started_at: new Date(Date.now() - 3_600_000).toISOString(),
              database_bytes: "26214400", live_rows: "980", dead_rows: "20"
            }] };
            if (sql.includes("from pg_stat_database")) return { rows: [{
              numbackends: 4, xact_commit: "900", xact_rollback: "5",
              blks_read: "19", blks_hit: "981"
            }] };
            if (sql.includes("from pg_stat_activity")) return { rows: [{
              pid: 4242, usename: "app_user", client: "10.0.0.8", state: "active",
              wait_event_type: null, wait_event: null, backend_type: "client backend",
              elapsed_seconds: 12, query: "select * from orders"
            }] };
            if (sql.includes("from pg_stat_user_tables")) return { rows: [{
              schemaname: "public", relname: "orders", seq_scan: "10", idx_scan: "90",
              n_live_tup: "980", n_dead_tup: "20", last_autovacuum: null,
              total_bytes: "1048576"
            }] };
            if (sql.includes("from pg_locks")) return { rows: [{
              mode: "AccessShareLock", granted: true, count: 3
            }] };
            if (sql.includes("from pg_settings")) return { rows: [
              { name: "max_connections", setting: "100", unit: null },
              { name: "shared_buffers", setting: "16384", unit: "8kB" },
              { name: "track_activities", setting: "on", unit: null }
            ] };
            return { rows: [] };
          }
        }
      `,
    }),
  );
  await page.goto("/postgres-ops.html");

  await expect(page).toHaveTitle(/Postgres operations/i);
  await expect(
    page.getByRole("heading", { name: "Database health" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Session activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Table health" }),
  ).toBeVisible();
  await expect(
    page.getByText("pg_stat_activity", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("pg_stat_user_tables", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("#connections")).toHaveText("4");
  await expect(page.locator("#cache-hit")).toHaveText("98.1%");
  await expect(page.getByText("app_user", { exact: true })).toBeVisible();
  await expect(page.getByText("orders", { exact: true })).toBeVisible();
});
