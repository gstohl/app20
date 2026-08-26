import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 20 * 60_000,
  expect: {
    timeout: 30_000,
  },
  reporter: [["list"]],
  outputDir: "test-results/playwright",
  use: {
    baseURL: process.env.APP20_TEST_BASE_URL ?? "http://127.0.0.1:5173",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1_440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
