import { test, expect } from "@playwright/test";
test.skip(!!process.env.SAAS_E2E_REAL, "Synthetic catalog regression suite.");
const CRM = "/types/customer-relationship-management-crm";

test("category -> leaf -> definition, independent lists and refresh", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.locator(".domain-card").filter({ hasText: "销售、客户与营收" }).click();
  await expect(page).toHaveURL(/domain=07/);
  await page.locator(".leaf-card").filter({ hasText: "Customer Relationship Management / CRM" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("CRM");
  await expect(page.locator(".application-facts")).toContainText("Docker");
  await expect(page.locator(".application-facts")).toContainText("Python · SQLite");
  await expect(page.locator(".source-note").filter({ hasText: "已核对官方资料，尚未进行部署测试" })).toBeVisible();
  await expect(page.getByRole("link", { name: "资料来源" })).toHaveAttribute("href", "https://example.test/open/readme");
  await page.getByText("了解原始类型定义与边界", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "定义性核心" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试开源项目" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试商业产品" })).toHaveCount(0);
  await page.getByRole("tab", { name: /商业产品/ }).click();
  await expect(page.getByRole("heading", { name: "测试商业产品" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试开源项目" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("tab", { name: /商业产品/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "测试商业产品" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("search aliases, clear no-results, and retain URL filtering", async ({ page }) => {
  await page.goto("/browse");
  await page.getByRole("textbox", { name: "搜索应用类型", exact: true }).fill("CRM系统");
  await expect(page.locator(".leaf-card").filter({ hasText: "Customer Relationship Management / CRM" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "搜索应用类型", exact: true })).toHaveValue("CRM系统");
  await page.getByRole("textbox", { name: "搜索应用类型", exact: true }).fill("no-match-991");
  await expect(page.getByRole("heading", { name: "没有找到匹配的类型" })).toBeVisible();
  await page.getByRole("button", { name: "重置筛选" }).click();
  await expect(page.locator(".domain-card")).toHaveCount(29);
  await page.getByLabel("类型范围", { exact: true }).selectOption("conditional");
  await expect(page).toHaveURL(/scope=conditional/);
  await expect(page.locator(".catalog-heading")).toContainText("53");
});

test("SaaS main catalog separates consumer social and uncertain delivery types", async ({ page }) => {
  await page.goto("/browse?domain=01");
  await expect(page.getByLabel("类型范围", { exact: true })).toHaveValue("included");
  await expect(page.locator(".catalog-heading")).toContainText("团队通讯与社区运营");
  await expect(page.locator('.leaf-card[href="/types/team-messaging-application"]')).toBeVisible();
  await expect(page.locator('.leaf-card[href="/types/email-client"]')).toBeVisible();
  await expect(page.locator('.leaf-card[href="/types/general-social-network"]')).toHaveCount(0);
  await page.getByLabel("类型范围", { exact: true }).selectOption("conditional");
  await page.locator('.leaf-card[href="/types/softphone-application"]').click();
  await expect(page.locator(".scope-note")).toContainText("待确认类型");
  await page.getByRole("link", { name: "继续浏览分类" }).click();
  await expect(page).toHaveURL(/scope=conditional/);
  await page.reload();
  await expect(page.getByLabel("类型范围", { exact: true })).toHaveValue("conditional");
  await expect(page.locator('.leaf-card[href="/types/softphone-application"]')).toBeVisible();
  await page.getByLabel("类型范围", { exact: true }).selectOption("all");
  await page.locator('.leaf-card[href="/types/team-messaging-application"]').click();
  await expect(page.locator(".scope-note")).toContainText("SaaS 收录边界");
  await page.goto("/types/general-social-network");
  await expect(page.getByRole("alert")).toContainText("没有找到");
});

test("honest empty states and keyboard track navigation", async ({ page }) => {
  await page.goto("/types/online-form-builder");
  await expect(page.getByRole("heading", { name: "这里还没有收录开源项目" })).toBeVisible();
  await page.getByRole("tab", { name: /开源项目/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "这里还没有记录商业产品" })).toBeVisible();
  await page.getByRole("textbox", { name: "搜索此类型中的应用" }).fill("missing");
  await expect(page.getByRole("heading", { name: "没有符合搜索条件的应用" })).toBeVisible();
  await page.getByRole("button", { name: "清除应用搜索" }).click();
  await expect(page.getByRole("heading", { name: "这里还没有记录商业产品" })).toBeVisible();
});

test("application list search and navigation back", async ({ page }) => {
  await page.goto(CRM);
  await page.getByRole("textbox", { name: "搜索此类型中的应用" }).fill("不存在");
  await expect(page.getByRole("heading", { name: "没有符合搜索条件的应用" })).toBeVisible();
  await page.getByRole("button", { name: "清除应用搜索" }).click();
  await expect(page.getByRole("heading", { name: "测试开源项目" })).toBeVisible();
  await page.getByRole("link", { name: "继续浏览分类" }).click();
  await expect(page).toHaveURL(/domain=07/);
});

test("failed data request can recover without losing page", async ({ page }) => {
  await page.route("**/api/taxonomy?**", route => route.fulfill({ status: 503, json: { error: "测试暂时不可用" } }));
  await page.goto("/browse");
  await expect(page.getByRole("alert")).toContainText("测试暂时不可用");
  await page.unroute("**/api/taxonomy?**");
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator(".domain-card")).toHaveCount(29);
});

test("unknown leaf and route return usable navigation", async ({ page }) => {
  await page.goto("/types/not-a-type");
  await expect(page.getByRole("alert")).toContainText("没有找到");
  await page.getByRole("link", { name: "返回目录", exact: true }).click();
  await expect(page.locator(".domain-card")).toHaveCount(29);
  await page.goto("/missing-page");
  await expect(page.getByRole("heading", { name: "没有找到这个页面" })).toBeVisible();
});

test("mobile catalog and leaf fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/browse", "/browse?domain=07", CRM + "?track=commercial"]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await expect(page.getByRole("tab", { name: /商业产品/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试商业产品" })).toBeVisible();
});
