import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", workers: 1, fullyParallel: false, timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:5388", screenshot: "only-on-failure", trace: "retain-on-failure" },
  reporter: [["list"]],
  webServer: [
    { command: "python3 -B ../scripts/serve_test_api.py", url: "http://127.0.0.1:5399/api/health", reuseExistingServer: false },
    { command: "npm run dev -- --port 5388", url: "http://127.0.0.1:5388", env: { SAAS_API_TARGET: "http://127.0.0.1:5399" }, reuseExistingServer: false },
  ],
});
