import { test, expect } from "@playwright/test";
test.skip(!!process.env.SAAS_E2E_REAL, "Isolated shortlist tests use synthetic records.");
const KEY = "saas-grove.saved-products.v1";
const CRM = "customer-relationship-management-crm";

test("empty shortlist leads to product discovery", async ({ page }) => {
  await page.goto("/shortlist");
  await expect(page.getByRole("heading", { name: "把第一个选择留在这里" })).toBeVisible();
  await page.getByRole("link", { name: "去发现产品", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
});

test("save from search and detail, refresh, compare and remove", async ({ page }) => {
  await page.goto("/search?q=CRM系统");
  await page.getByRole("button", { name: "收藏 测试开源项目", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消收藏 测试开源项目", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("heading", { name: "测试商业产品", exact: true }).getByRole("link").click();
  await page.getByRole("button", { name: "收藏 测试商业产品", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "取消收藏 测试商业产品", exact: true })).toHaveAttribute("aria-pressed", "true");
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(stored.items).toHaveLength(2);
  expect(stored.items.every((item: object) => Object.keys(item).sort().join(",") === "id,saved_at")).toBe(true);
  await page.getByRole("link", { name: /候选清单，已收藏 2 个产品/ }).click();
  await expect(page.locator(".shortlist-entry")).toHaveCount(2);
  await page.getByRole("checkbox", { name: "选择比较 测试开源项目", exact: true }).check();
  await page.getByRole("checkbox", { name: "选择比较 测试商业产品", exact: true }).check();
  await page.getByRole("link", { name: "开始比较", exact: true }).click();
  await expect(page.locator(".comparison-table thead th")).toHaveCount(3);
  await page.getByRole("link", { name: "返回继续选择", exact: true }).click();
  await expect(page.locator(".shortlist-card-choice input:checked")).toHaveCount(2);
  await page.getByRole("heading", { name: "测试开源项目", exact: true }).getByRole("link").click();
  await page.getByRole("link", { name: "返回候选清单", exact: true }).click();
  await page.getByRole("button", { name: "取消收藏 测试开源项目", exact: true }).click();
  await expect(page.locator(".shortlist-entry")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".shortlist-entry")).toHaveCount(1);
});

test("storage failure is visible and never claims a saved product", async ({ page }) => {
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException("full", "QuotaExceededError"); original.call(this, name, value); };
  }, KEY);
  await page.goto("/products/fixture-open");
  await page.getByRole("button", { name: "收藏 测试开源项目", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("收藏未保存");
  await expect(page.getByRole("button", { name: "收藏 测试开源项目", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("unreadable local records are preserved", async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, "{broken-record"), KEY);
  await page.goto("/products/fixture-open");
  await expect(page.getByRole("alert")).toContainText("无法读取本地收藏");
  await page.getByRole("button", { name: "收藏 测试开源项目", exact: true }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe("{broken-record");
});

test("lookup failure and unavailable products do not erase saved identities", async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ version: 1, items: ["fixture-open", "missing-record"].map(id => ({ id, saved_at: "2026-10-29T12:00:00Z" })) })), KEY);
  await page.route("**/api/products/lookup?**", route => route.fulfill({ status: 503, json: { error: "资料暂时不可用" } }));
  await page.goto("/shortlist");
  await expect(page.getByRole("alert")).toContainText("本地收藏记录仍然保留");
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY)).items).toHaveLength(2);
  await page.unroute("**/api/products/lookup?**");
  await page.getByRole("button", { name: "重新加载收藏", exact: true }).click();
  await expect(page.getByRole("heading", { name: "有 1 个收藏暂时无法找到" })).toBeVisible();
  await expect(page.locator(".shortlist-entry")).toHaveCount(1);
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY)).items).toHaveLength(2);
  await page.getByRole("button", { name: "移除失效收藏 missing-record", exact: true }).click();
  await expect(page.locator(".missing-saved")).toHaveCount(0);
});

test("two tabs in this browser keep saved state in sync", async ({ page, context }) => {
  await page.goto("/products/fixture-open");
  const other = await context.newPage();
  await other.goto("/products/fixture-open");
  await page.getByRole("button", { name: "收藏 测试开源项目", exact: true }).click();
  await expect(other.getByRole("button", { name: "取消收藏 测试开源项目", exact: true })).toHaveAttribute("aria-pressed", "true");
  await other.getByRole("button", { name: "取消收藏 测试开源项目", exact: true }).click();
  await expect(page.getByRole("button", { name: "收藏 测试开源项目", exact: true })).toHaveAttribute("aria-pressed", "false");
  await other.close();
});

test("comparison selection requires a common type across all products and caps at four", async ({ page }) => {
  const types = [CRM, "online-form-builder", "online-survey"];
  const membership = [[0, 1], [0, 2], [1, 2], [0], [0], [0]];
  const apps = membership.map((m, i) => ({ id: `mock-${i}`, name: `Synthetic ${i}`, tracks: ["open_source"], types: m.map(n => ({ slug: types[n], name: types[n], name_zh: types[n], scope: "included", domain_id: "07" })) }));
  await page.addInitScript(({ key, ids }) => localStorage.setItem(key, JSON.stringify({ version: 1, items: ids.map(id => ({ id, saved_at: "2026-10-29T12:00:00Z" })) })), { key: KEY, ids: apps.map(a => a.id) });
  await page.route("**/api/products/lookup?**", route => route.fulfill({ json: { applications: apps, missing_ids: [] } }));
  await page.goto("/shortlist");
  for (const name of ["Synthetic 0", "Synthetic 1"]) await page.getByRole("checkbox", { name: `选择比较 ${name}`, exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "选择比较 Synthetic 2", exact: true })).toBeDisabled();
  for (const name of ["Synthetic 3", "Synthetic 4"]) await page.getByRole("checkbox", { name: `选择比较 ${name}`, exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "选择比较 Synthetic 5", exact: true })).toBeDisabled();
  await expect(page.locator(".shortlist-comparison-top")).toContainText("4 / 4 已选");
  await expect(page.getByRole("link", { name: "开始比较", exact: true })).toHaveAttribute("href", new RegExp(`leaf=${CRM}`));
});

test("failed removal keeps all existing records saved", async ({ page }) => {
  await page.goto("/search?q=CRM系统");
  for (const name of ["测试开源项目", "测试商业产品"]) await page.getByRole("button", { name: `收藏 ${name}`, exact: true }).click();
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException("full", "QuotaExceededError"); original.call(this, name, value); };
  }, KEY);
  await page.getByRole("button", { name: "取消收藏 测试商业产品", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("取消收藏失败，原记录保持不变");
  await expect(page.getByRole("button", { name: "取消收藏 测试商业产品", exact: true })).toHaveAttribute("aria-pressed", "true");
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(saved.items.map((item: {id:string}) => item.id).sort()).toEqual(["fixture-commercial", "fixture-open"]);
});

test("HTML and network lookup errors stay readable and keep local records", async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ version: 1, items: [{id:"fixture-open",saved_at:"2026-10-29T12:00:00Z"}] })), KEY);
  await page.route("**/api/products/lookup?**", route => route.fulfill({status:502,contentType:"text/html",body:"<!doctype html><h1>Bad gateway</h1>"}));
  await page.goto("/shortlist");
  await expect(page.getByRole("alert")).toContainText("暂时无法读取收藏产品");
  await expect(page.getByRole("alert")).not.toContainText("Unexpected token");
  await page.unroute("**/api/products/lookup?**");
  await page.route("**/api/products/lookup?**", route => route.abort("failed"));
  await page.getByRole("button", {name:"重新加载收藏",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("暂时无法连接本地服务");
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY)).items).toHaveLength(1);
});

test("a saved selection that loses its type can still be unchecked", async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({version:1,items:[{id:"typeless",saved_at:"2026-10-29T12:00:00Z"}]})),KEY);
  await page.route("**/api/products/lookup?**",route=>route.fulfill({json:{applications:[{id:"typeless",name:"Typeless",types:[],tracks:["commercial"]}],missing_ids:[]}}));
  await page.goto("/shortlist?compare=typeless");
  await expect(page.locator(".shortlist-comparison")).toContainText("暂无共同的可比较类型");
  const checkbox=page.getByRole("checkbox",{name:"选择比较 Typeless",exact:true});
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(page.locator(".shortlist-comparison-top")).toContainText("0 / 4 已选");
});

test("saved dates use the browser local day", async ({browser})=>{
  const context=await browser.newContext({timezoneId:"Asia/Shanghai"});
  await context.addInitScript(key=>localStorage.setItem(key,JSON.stringify({version:1,items:[{id:"fixture-open",saved_at:"2026-10-29T16:30:00Z"}]})),KEY);
  const page=await context.newPage();
  await page.goto("http://127.0.0.1:5388/shortlist");
  await expect(page.locator(".shortlist-card-choice time")).toHaveText("收藏于 2026/10/30");
  await expect(page.locator(".shortlist-card-choice time")).toHaveAttribute("dateTime","2026-10-29T16:30:00Z");
  await context.close();
});
