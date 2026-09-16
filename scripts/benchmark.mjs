import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ ignoreHTTPSErrors: true });
await page.goto("http://localhost:5173/benchmark.html");
await page.waitForFunction(
  () => !document.querySelector("pre")?.textContent?.includes("running"),
  null,
  { timeout: 120000 },
);
console.log(await page.locator("pre").textContent());
await browser.close();
