import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const isCi = Boolean(process.env.CI);
const reuseExistingServer = !isCi;

const webBaseUrl = (
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");

const apiBaseUrl = (
  process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:4000"
).replace(/\/$/, "");

const usesExternalDeployment = Boolean(
  process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_API_BASE_URL,
);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  // Shared AAL2 fixtures must run serially: concurrent TOTP challenges can
  // invalidate one another and create false authentication failures.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: webBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],

  webServer: usesExternalDeployment
    ? undefined
    : [
        {
          name: "NestJS API",
          command: "npm run start:e2e",
          cwd: "../api",
          url: `${apiBaseUrl}/api/v1`,
          reuseExistingServer,
          timeout: 120_000,
          stdout: "ignore",
          stderr: "pipe",
        },
        {
          name: "Next.js Web",
          command: "npm run start:e2e",
          cwd: ".",
          url: `${webBaseUrl}/login`,
          reuseExistingServer,
          timeout: 120_000,
          stdout: "ignore",
          stderr: "pipe",
        },
      ],

  outputDir: "test-results",
});
