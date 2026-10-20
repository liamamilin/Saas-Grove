// Browser helpers. Uses Playwright's bundled Chromium when installed; otherwise
// falls back to ACCEPTANCE_CHROMIUM_PATH or the newest headless shell already in
// the local Playwright cache, so the suite does not need to download a browser.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { BASE_URL } from "./client";

function cachedHeadlessShell(): string | undefined {
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  if (!fs.existsSync(cache)) return undefined;
  const dirs = fs
    .readdirSync(cache)
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    for (const sub of fs.readdirSync(path.join(cache, d))) {
      const exe = path.join(cache, d, sub, "chrome-headless-shell");
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

async function launch(): Promise<Browser> {
  const explicit = process.env.ACCEPTANCE_CHROMIUM_PATH;
  if (explicit) return chromium.launch({ executablePath: explicit });
  try {
    return await chromium.launch();
  } catch (error) {
    const fallback = cachedHeadlessShell();
    if (!fallback) throw error;
    return chromium.launch({ executablePath: fallback });
  }
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

export async function uiLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}
