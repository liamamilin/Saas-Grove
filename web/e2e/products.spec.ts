import { test, expect } from "@playwright/test";
test.skip(!!process.env.SAAS_E2E_REAL, "Synthetic contract tests run separately from the real catalog acceptance.");
const CRM = "/types/customer-relationship-management-crm";

test("home product search, cross-type alias, filters and saved URL", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "搜索 SaaS 产品" }).fill("CRM系统");
  await page.getByRole("button", { name: "搜索产品", exact: true }).click();
  await expect(page.locator(".product-card")).toHaveCount(3);
  await page.getByLabel("产品分区", { exact: true }).selectOption("commercial");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "测试商业产品", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("产品分区", { exact: true })).toHaveValue("commercial");
  await expect(page.getByRole("textbox", { name: "搜索 SaaS 产品" })).toHaveValue("CRM系统");
  await page.getByLabel("产品分区", { exact: true }).selectOption("open_source");
  await page.getByLabel("许可证", { exact: true }).selectOption("测试许可证");
  await page.getByLabel("已记录的部署方式", { exact: true }).selectOption("docker");
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel("已记录的部署方式", { exact: true })).toHaveValue("docker");
});

test("product detail exposes sources, testing limits, and restores search context", async ({ page }) => {
  await page.goto("/search?q=CRM系统&track=open_source&license=测试许可证");
  await page.getByRole("heading", { name: "测试开源项目", exact: true }).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("测试开源项目");
  await expect(page.getByRole("heading", { name: "技术与部署", exact: true })).toBeVisible();
  await expect(page.locator(".evidence-note")).toContainText("尚未进行实际部署测试");
  await expect(page.locator(".product-sources a")).toHaveAttribute("href", "https://example.test/open/readme");
  await expect(page.locator(".product-sources time")).toHaveText("2026-10-23 采集");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("测试开源项目");
  await page.getByRole("link", { name: "返回产品搜索" }).click();
  await expect(page.getByLabel("许可证", { exact: true })).toHaveValue("测试许可证");
  await page.goto("/products/fixture-commercial");
  await expect(page.getByRole("heading", { name: "技术与部署", exact: true })).toHaveCount(0);
  await expect(page.locator("main").getByText("商业产品保留基本索引", { exact: false })).toBeVisible();
});

test("select, compare mixed tracks, replace, remove and rebuild comparison", async ({ page }) => {
  await page.goto(CRM);
  await page.locator(".compare-picker summary").click();
  await page.getByRole("checkbox", { name: /测试开源项目/ }).check();
  await page.getByRole("checkbox", { name: /测试商业产品/ }).check();
  await page.getByRole("link", { name: "开始比较" }).click();
  await expect(page.locator(".comparison-table thead th")).toHaveCount(3);
  await expect(page.locator(".comparison-table tbody tr").filter({ hasText: "已记录的核心能力" })).toContainText("资料未提供 / 未核实");
  await page.getByLabel("替换 测试开源项目", { exact: true }).selectOption("fixture-replacement");
  await expect(page.locator(".comparison-table")).toContainText("候选 CRM");
  await expect(page.locator(".comparison-table")).toContainText("明确不支持：离线原生客户端");
  await page.reload();
  await expect(page.locator(".comparison-table")).toContainText("候选 CRM");
  await page.getByRole("button", { name: "移除 测试商业产品", exact: true }).click();
  await expect(page.getByText("至少选择 2 个产品", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /测试开源项目/ }).check();
  await page.getByRole("link", { name: "开始比较" }).click();
  await expect(page.locator(".comparison-table thead th")).toHaveCount(3);
});

test("empty search, unknown product, and invalid cross-type comparison recover", async ({ page }) => {
  await page.goto("/search?q=no-result-9981");
  await expect(page.getByRole("heading", { name: "没有找到匹配的产品" })).toBeVisible();
  await page.getByRole("button", { name: "查看全部产品" }).click();
  await expect(page.locator(".product-card")).toHaveCount(3);
  await page.goto("/products/unknown");
  await expect(page.getByRole("alert")).toContainText("没有找到");
  await page.goto("/compare?ids=fixture-open,fixture-commercial&leaf=online-form-builder");
  await expect(page.getByRole("alert")).toContainText("同一个应用类型");
  await page.goto("/compare?ids=fixture-open,missing&leaf=customer-relationship-management-crm");
  await expect(page.getByRole("alert")).toContainText("没有找到");
  await page.getByRole("checkbox", { name: /测试开源项目/ }).check();
  await page.getByRole("checkbox", { name: /测试商业产品/ }).check();
  await page.getByRole("link", { name: "开始比较" }).click();
  await expect(page.locator(".comparison-table thead th")).toHaveCount(3);
});

test("mobile search, details and horizontal comparison stay within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/search?q=CRM系统", "/products/fixture-open", `/compare?leaf=customer-relationship-management-crm&ids=fixture-open,fixture-commercial`]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const comparison = page.getByRole("region", { name: "产品比较表，可横向滚动" });
  await expect(comparison).toBeVisible();
  await expect.poll(() => comparison.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.locator(".comparison-table thead").scrollIntoViewIfNeeded();
  await comparison.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await expect(page.getByLabel("替换 测试商业产品")).toBeInViewport();
});

test("type tabs retain compare and query state, source dates stay honest", async ({ page }) => {
  await page.goto(CRM + "?compare=fixture-open&q=客户");
  await expect(page.locator(".application-card .source-note").filter({ hasText: "来源采集：2026-10-23" })).toBeVisible();
  await page.getByRole("tab", {name:/商业产品/}).click();
  await expect(page).toHaveURL(/compare=fixture-open/);
  await expect(page.getByRole("textbox", {name:"搜索此类型中的应用"})).toHaveValue("客户");
});
