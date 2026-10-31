import { test, expect } from "@playwright/test";
test.skip(!!process.env.SAAS_E2E_REAL, "Synthetic contract tests run separately from the real catalog acceptance.");
const CRM = "/types/customer-relationship-management-crm";

test("cards show loaded logos, fall back on broken ones, and filter curated products", async ({ page }) => {
  await page.goto("/search?q=CRM系统");
  const open = page.locator(".product-card").filter({ has: page.getByRole("heading", { name: "测试开源项目", exact: true }) });
  await expect(open.locator(".product-logo")).toHaveText("测");
  await expect(open.locator(".product-logo img")).toHaveCount(0);
  const replacement = page.locator(".product-card").filter({ has: page.getByRole("heading", { name: "候选 CRM", exact: true }) });
  await expect.poll(() => replacement.locator(".product-logo img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await expect(open.locator(".tag-media")).toHaveText("有界面截图");
  await expect(open.locator(".tag-type")).toHaveAttribute("href", CRM);
  await page.getByLabel("官方资源", { exact: true }).selectOption("1");
  await expect(page.locator(".product-card")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "测试商业产品", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("官方资源", { exact: true })).toHaveValue("1");
});

test("detail shows typed official resources, gaps, demo entry and a keyboard lightbox", async ({ page }) => {
  await page.goto("/products/fixture-open");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("测试开源项目");
  const resources = page.locator("#resources");
  await expect(resources.locator(".resource-card")).toHaveCount(4);
  await expect(resources.getByRole("link", { name: /文档.*测试文档/ })).toHaveAttribute("href", "https://example.test/open/docs");
  await expect(resources.getByRole("link", { name: /部署指南/ })).toHaveAttribute("href", "https://example.test/open/install");
  await expect(resources.getByRole("link", { name: /代码仓库.*来自正式产品记录/ })).toHaveAttribute("href", "https://example.test/open");
  await expect(resources.locator(".resource-missing")).toContainText("测试：未找到演示视频");
  await expect(page.locator(".product-actions").getByRole("link", { name: /测试在线演示/ })).toHaveAttribute("href", "https://example.test/open/demo");
  await expect(page.locator(".screenshot-grid figure")).toHaveCount(2);
  await expect(page.locator(".screenshot-grid figure").nth(1)).toContainText("官方界面拼图");
  const first = page.getByRole("button", { name: "放大查看：测试主界面" });
  await first.click();
  const dialog = page.locator("dialog.lightbox");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("1 / 2 · 测试主界面");
  await page.keyboard.press("ArrowRight");
  await expect(dialog).toContainText("2 / 2 · 测试拼图");
  await expect(dialog.locator("img")).toHaveAttribute("src", /\?second$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(first).toBeFocused();
});

test("uncurated and screenshot-less products state gaps instead of inventing them", async ({ page }) => {
  await page.goto("/products/fixture-commercial");
  await expect(page.locator("#resources")).toContainText("尚未整理");
  await expect(page.locator("#resources .resource-card")).toHaveCount(1);
  await expect(page.locator(".screenshot-section")).toHaveCount(0);
  await expect(page.locator(".product-header .product-logo")).toHaveText("测");
  await page.goto("/products/fixture-replacement");
  await expect(page.locator(".screenshot-section")).toContainText("暂未找到可靠的官方界面截图");
  await expect(page.locator(".product-actions .demo-button")).toHaveCount(0);
});

test("detail leads to same-type products, the type page, saving and comparison", async ({ page }) => {
  await page.goto("/products/fixture-open");
  const similar = page.getByRole("region", { name: "同类型其他产品" });
  await expect(similar.locator(".similar-card")).toHaveCount(2);
  await expect(similar.getByRole("link", { name: "测试开源项目", exact: true })).toHaveCount(0);
  await similar.getByRole("button", { name: "收藏 候选 CRM", exact: true }).click();
  await expect(page.getByRole("link", { name: /候选清单，已收藏 1 个产品/ })).toBeVisible();
  await similar.getByRole("link", { name: /和它们一起比较/ }).click();
  await expect(page).toHaveURL(/compare=fixture-open/);
  await expect(page.locator(".compare-picker summary")).toContainText("1 / 4 已选");
  await page.goto("/products/fixture-open");
  await page.locator(".product-place").getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`${CRM}$`));
  await expect(page.getByRole("region", { name: "相关类型" }).locator(".leaf-card").first()).toBeVisible();
  await expect(page.locator(".application-card .product-logo").first()).toBeVisible();
});

test("search suggests matching types and comparison shows activity and trial rows", async ({ page }) => {
  await page.goto("/search?q=客户管理");
  const types = page.getByRole("navigation", { name: "相关应用类型" });
  await expect(types.getByRole("link", { name: /客户关系管理/ })).toContainText("2 开源 · 1 商业");
  await types.getByRole("link", { name: /客户关系管理/ }).click();
  await expect(page).toHaveURL(new RegExp(`${CRM}$`));
  await page.goto(`/compare?leaf=customer-relationship-management-crm&ids=fixture-open,fixture-replacement`);
  const activity = page.locator('tr[data-dimension="activity"] td');
  await expect(activity.nth(0)).toContainText("v9.0-beta.1（预发布）");
  await expect(activity.nth(0)).toContainText("最近代码推送：2026-10-30");
  await expect(activity.nth(1)).toContainText("资料未提供 / 未核实");
  const trial = page.locator('tr[data-dimension="trial"] td');
  await expect(trial.nth(0).getByRole("link", { name: /在线演示 \/ 试用 · 测试在线演示/ })).toHaveAttribute("href", "https://example.test/open/demo");
  await expect(trial.nth(0).getByRole("link", { name: /部署指南/ })).toBeVisible();
  await expect(trial.nth(1)).toContainText("资料未提供 / 未核实");
  await page.getByRole("checkbox", { name: "维护活跃度" }).uncheck();
  await expect(page.locator('tr[data-dimension="activity"]')).toHaveCount(0);
  await expect(page).toHaveURL(/dims=/);
});

test("mobile detail and search stay within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of ["/products/fixture-open", "/search?q=CRM系统", CRM, "/"]) {
    await page.goto(url);
    await expect(page.locator("main h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  }
  await page.goto("/products/fixture-open");
  await page.getByRole("button", { name: "放大查看：测试主界面" }).click();
  const box = await page.locator("dialog.lightbox").boundingBox();
  expect(box!.width).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "关闭截图" }).click();
  await expect(page.locator("dialog.lightbox")).toBeHidden();
});
