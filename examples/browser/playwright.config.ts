import { defineConfig } from "@playwright/test";
import fs from "node:fs";
const protocol = fs.existsSync("../../certs/localhost.pem") ? "https" : "http";
export default defineConfig({
  testDir: "test",
  use: {
    baseURL: `${protocol}://localhost:5173`,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: "npm run dev",
    url: `${protocol}://localhost:5173`,
    reuseExistingServer: true,
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", channel: "chrome" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
