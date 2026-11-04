import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const REAL = !!process.env.SAAS_E2E_REAL;
test.skip(!REAL, "Real-catalog acceptance uses the restored formal SQL snapshot and live official images.");
const OUT = "../docs/product-visuals";
const CURATED = ["github:572984571", "github:24459441", "github:43160685", "github:568098118", "github:48769241",
  "github:202291859", "github:500289888", "github:193833307", "github:7569578", "github:71485542"];

async function loaded(page: Page, selector: string) {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(selector).evaluateAll((imgs: HTMLImageElement[]) => imgs.every(i => i.complete && i.naturalWidth > 0)), { timeout: 20_000 }).toBe(true);
}

test("real catalog: all ten curated products show official logos, screenshots and typed resources", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await mkdir(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const id of CURATED) {
    await page.goto(`/products/${encodeURIComponent(id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await loaded(page, ".product-header .product-logo img");
    await loaded(page, ".screenshot-grid img");
    const kinds = await page.locator("#resources .resource-card strong").allInnerTexts();
    expect(kinds).toEqual(expect.arrayContaining(["官网", "代码仓库", "文档", "部署指南", "更新记录"]));
    const hrefs = await page.locator("#resources .resource-card").evaluateAll((links: HTMLAnchorElement[]) => links.map(a => a.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    await expect(page.locator(".repo-facts")).toContainText("GitHub 仓库信息");
  }
  await page.goto(`/products/${encodeURIComponent("github:48769241")}`);
  await loaded(page, ".screenshot-grid img");
  await expect(page.locator(".product-actions .demo-button")).toHaveCount(2);
  await page.screenshot({ path: `${OUT}/detail-penpot-desktop.png`, fullPage: true });
  await page.goto(`/products/${encodeURIComponent("github:202291859")}`);
  await loaded(page, ".screenshot-grid img");
  await page.screenshot({ path: `${OUT}/detail-chatwoot-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: /放大查看/ }).first().click();
  await expect(page.locator("dialog.lightbox img")).toBeVisible();
  await page.screenshot({ path: `${OUT}/lightbox-desktop.png` });
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("real catalog: discovery from home, search filter and type page to a visual product", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const showcase = page.getByRole("region", { name: "已整理界面与资源的产品" });
  await expect(showcase.locator(".showcase-item")).toHaveCount(12);
  await loaded(page, ".showcase-item img");
  await page.screenshot({ path: `${OUT}/home-desktop.png` });
  await page.goto("/search?q=CRM");
  await loaded(page, ".product-card .product-logo img");
  await page.screenshot({ path: `${OUT}/search-cards-desktop.png` });
  await page.getByLabel("官方资源", { exact: true }).selectOption("1");
  await expect(page.locator(".product-card")).toHaveCount(8);
  await page.goto("/types/customer-relationship-management-crm");
  await expect(page.getByRole("region", { name: "相关类型" })).toBeVisible();
  await page.locator(".application-card").filter({ hasText: "Twenty" }).getByRole("link", { name: "Twenty", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Twenty");
  const similar = page.getByRole("region", { name: "同类型其他产品" });
  await expect(similar.locator(".similar-card").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "返回应用类型" })).toBeVisible();
});

test("real catalog: mobile detail, gallery and search stay readable", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ["/", "/search?q=CRM", `/products/${encodeURIComponent("github:71485542")}`, "/types/customer-relationship-management-crm", "/shortlist"]) {
    await page.goto(url);
    await expect(page.locator("main h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await page.goto(`/products/${encodeURIComponent("github:71485542")}`);
  await loaded(page, ".screenshot-grid img");
  await page.screenshot({ path: `${OUT}/detail-kimai-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: /放大查看/ }).first().click();
  await expect(page.locator("dialog.lightbox img")).toBeVisible();
  await page.screenshot({ path: `${OUT}/lightbox-mobile.png` });
  await page.getByRole("button", { name: "关闭截图" }).click();
  await page.goto("/search?q=CRM");
  await loaded(page, ".product-card .product-logo img");
  await page.screenshot({ path: `${OUT}/search-cards-mobile.png` });
});

const SECOND_BATCH = ["github:6899875", "github:674295265", "github:1529160", "github:78243781", "github:266033395", "github:419635982", "github:12063996", "github:14346979", "github:39182755", "github:12204147", "github:32042787", "github:3305384", "github:664013991", "github:542931741", "github:486815039", "github:21298446", "github:1864233", "github:501292795", "github:9852918", "github:43441403", "github:8162715", "github:479657569", "github:111364256", "github:9193949", "github:382496361", "github:72495579", "github:642497346", "github:24594933", "github:203587744", "github:60243197", "github:15225670"];

test("real catalog: second batch products show logos, screenshots, docs and deployment resources", async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const id of SECOND_BATCH) {
    await page.goto(`/products/${encodeURIComponent(id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await loaded(page, ".product-header .product-logo img");
    await loaded(page, ".screenshot-grid img");
    const kinds = await page.locator("#resources .resource-card strong").allInnerTexts();
    expect(kinds).toEqual(expect.arrayContaining(["官网", "代码仓库", "文档", "部署指南"]));
    const hrefs = await page.locator("#resources .resource-card").evaluateAll((links: HTMLAnchorElement[]) => links.map(a => a.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    await expect(page.locator(".repo-facts")).toContainText("GitHub 仓库信息");
  }
  expect(errors).toEqual([]);
});
