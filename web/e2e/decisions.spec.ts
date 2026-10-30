import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test.skip(!!process.env.SAAS_E2E_REAL, "Isolated local decision records");
const KEY="saas-grove.saved-products.v1",CRM="customer-relationship-management-crm";
const compare=`/compare?leaf=${CRM}&ids=fixture-open,fixture-commercial`;
const old={version:1,items:[{id:"fixture-open",saved_at:"2026-10-29T12:00:00Z"}]};

test("legacy favorites survive notes, refresh, unfavorite and a second tab",async({page,context})=>{
  await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:KEY,value:old});
  await page.goto("/products/fixture-open");
  await page.getByText("我的选型记录",{exact:true}).click();
  await page.getByLabel("测试开源项目 个人备注").fill("需要确认团队权限，先试用");
  await page.getByLabel("测试开源项目 选型状态").selectOption("trial");
  await page.getByRole("button",{name:"保存个人记录",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("个人记录已保存");
  const other=await context.newPage();await other.goto("/products/fixture-open");
  await other.getByText("我的选型记录 · 准备试用",{exact:true}).click();
  await expect(other.getByLabel("测试开源项目 个人备注")).toHaveValue("需要确认团队权限，先试用");
  await page.getByLabel("测试开源项目 个人备注").fill("个人观点，不修改官方简介");
  await page.getByRole("button",{name:"保存个人记录",exact:true}).click();
  await expect(other.getByLabel("测试开源项目 个人备注")).toHaveValue("个人观点，不修改官方简介");
  await page.getByRole("button",{name:"取消收藏 测试开源项目",exact:true}).click();await page.reload();
  await page.getByText("我的选型记录 · 准备试用",{exact:true}).click();
  await expect(page.getByLabel("测试开源项目 个人备注")).toHaveValue("个人观点，不修改官方简介");
  const v=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY);expect(v.version).toBe(2);expect(v.notes).toHaveLength(1);expect(v.items).toHaveLength(0);
});

test("named comparison restores focus, order and conclusion and can update",async({page})=>{
 await page.goto(compare);
 await page.getByRole("checkbox",{name:"技术栈",exact:true}).uncheck();
 await page.getByLabel("比较名称",{exact:true}).fill("CRM 选型草案");await page.getByLabel("我的选型结论",{exact:true}).fill("先试开源版；缺失资料待确认");
 await page.getByRole("button",{name:"保存比较",exact:true}).click();
 await expect(page.getByRole("status")).toContainText("比较已保存");
 await page.getByRole("link",{name:"查看已保存比较",exact:true}).click();
 await page.getByRole("link",{name:"CRM 选型草案",exact:true}).click();await page.reload();
 await expect(page.getByRole("checkbox",{name:"技术栈",exact:true})).not.toBeChecked();
 await expect(page.getByLabel("我的选型结论",{exact:true})).toHaveValue("先试开源版；缺失资料待确认");
 const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY);expect(stored.comparisons[0].ids).toEqual(["fixture-open","fixture-commercial"]);expect(stored.comparisons[0].dimensions).not.toContain("technology");
 await page.getByLabel("比较名称",{exact:true}).fill("CRM 第二轮");await page.getByRole("button",{name:"更新已保存比较",exact:true}).click();
 await page.getByRole("link",{name:"查看已保存比较",exact:true}).click();
 await expect(page.getByRole("link",{name:"CRM 第二轮",exact:true})).toBeVisible();await expect(page.locator(".saved-comparison-list article")).toHaveCount(1);
 await page.getByRole("button",{name:"删除比较 CRM 第二轮",exact:true}).click();await expect(page.locator(".saved-comparison-list article")).toHaveCount(0);
});

test("backup download and merge preview keep existing favorites and conflicting notes",async({page})=>{
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:KEY,value:old});
 await page.goto("/shortlist");await page.getByText("本地备份与恢复",{exact:true}).click();
 const dl=page.waitForEvent("download");await page.getByRole("button",{name:"导出完整备份",exact:true}).click();const download=await dl;const backup=JSON.parse(await readFile((await download.path())!,"utf8"));
 expect(backup.favorites).toEqual(old.items);expect(backup.format).toBe("saas-grove.local-backup");expect(backup.notes).toEqual([]);
 const incoming={...backup,favorites:[...backup.favorites,{id:"fixture-commercial",saved_at:"2026-10-30T12:00:00Z"}],notes:[{product_id:"fixture-open",text:"导入的新备注",status:"trial",updated_at:"2026-10-30T12:00:00Z"}]};
 await page.getByLabel("选择本地备份文件").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(incoming))});
 await expect(page.locator(".backup-preview")).toContainText("新增 1 个收藏、1 条备注");
 expect((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY)).items).toHaveLength(1);
 await page.getByRole("button",{name:"合并导入",exact:true}).click();
 await expect(page.locator(".shortlist-entry")).toHaveCount(2);
 incoming.notes[0].text="冲突内容不覆盖";
 await page.getByLabel("选择本地备份文件").setInputFiles({name:"conflict.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(incoming))});await page.getByRole("button",{name:"合并导入",exact:true}).click();
 const v=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY);expect(v.notes[0].text).toBe("导入的新备注");expect(v.items).toHaveLength(2);expect(v.items[0]).toEqual(old.items[0]);
});

test("invalid backup and failed write never damage original storage",async({page})=>{
 await page.addInitScript(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:KEY,value:old});await page.goto("/shortlist");await page.getByText("本地备份与恢复",{exact:true}).click();
 const original=await page.evaluate(key=>localStorage.getItem(key),KEY);
 await page.getByLabel("选择本地备份文件").setInputFiles({name:"wrong.json",mimeType:"application/json",buffer:Buffer.from('{"version":1,"notes":[]}')});
 await expect(page.getByRole("alert")).toContainText("现有记录未改动");expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(original);
 const incoming={format:"saas-grove.local-backup",version:1,favorites:[{id:"fixture-commercial",saved_at:"2026-10-30"}],notes:[],comparisons:[]};
 await page.getByLabel("选择本地备份文件").setInputFiles({name:"valid.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(incoming))});
 await page.evaluate(key=>{const oldSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException("full","QuotaExceededError");oldSet.call(this,k,v);};},KEY);
 await page.getByRole("button",{name:"合并导入",exact:true}).click();await expect(page.getByRole("alert")).toContainText("备份导入失败");
 expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(original);await expect(page.locator(".shortlist-entry")).toHaveCount(1);
});

test("identical fields fold but unknowns remain and focus survives refresh",async({page})=>{
 await page.goto(compare);await expect(page.locator(".comparison-table thead th")).toHaveCount(3);await expect(page.locator('tr[data-dimension="types"]')).toHaveCount(0);
 await expect(page.locator('tr[data-dimension="features"]')).toContainText("资料未提供 / 未核实");
 await page.getByRole("button",{name:/展开相同记录/}).click();await expect(page.locator('tr[data-dimension="types"]')).toBeVisible();
 await page.getByRole("checkbox",{name:"部署方式",exact:true}).uncheck();await page.reload();await expect(page.getByRole("checkbox",{name:"部署方式",exact:true})).not.toBeChecked();
 await expect(page.locator('tr[data-dimension="deployment"]')).toHaveCount(0);
});


test("invalid product sets cannot save a comparison",async({page})=>{
 for(const query of [`leaf=${CRM}&ids=fixture-open,missing`,`leaf=${CRM}&ids=fixture-open,fixture-commercial,a,b,c`,`leaf=online-form-builder&ids=fixture-open,fixture-commercial`]) {
  await page.goto(`/compare?${query}`);await expect(page.getByRole("alert")).toBeVisible();await expect(page.locator(".save-comparison-form")).toHaveCount(0);
 }
 expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
});

test("failed personal edits keep previously stored text, status and comparison",async({page})=>{
 const seed={...old,notes:[{product_id:"fixture-open",text:"原备注",status:"research",updated_at:"2026-10-30T12:00:00Z"}],comparisons:[{id:"saved-1",name:"原比较",leaf:CRM,ids:["fixture-open","fixture-commercial"],dimensions:["features","license"],show_same:false,conclusion:"原结论",updated_at:"2026-10-30T12:00:00Z"}]};
 await page.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException("full","QuotaExceededError");write.call(this,k,v);};},{key:KEY,value:seed});
 await page.goto("/products/fixture-open");const before=await page.evaluate(key=>localStorage.getItem(key),KEY);
 await page.getByText("我的选型记录 · 待了解",{exact:true}).click();await page.getByLabel("测试开源项目 个人备注").fill("未保存的编辑");await page.getByLabel("测试开源项目 选型状态").selectOption("excluded");await page.getByRole("button",{name:"保存个人记录",exact:true}).click();await expect(page.getByRole("alert")).toContainText("个人备注未保存");expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(before);
 await page.goto(`${compare}&saved=saved-1`);await page.getByLabel("比较名称",{exact:true}).fill("未保存的新名称");await page.getByLabel("我的选型结论",{exact:true}).fill("未保存的新结论");await page.getByRole("button",{name:"更新已保存比较",exact:true}).click();await expect(page.getByRole("alert")).toContainText("比较未保存");expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(before);
});


test("unreadable inner records are never overwritten, invalid backup contents never import",async({page})=>{
 await page.goto("/shortlist");await page.getByText("本地备份与恢复",{exact:true}).click();
 const bad={format:"saas-grove.local-backup",version:1,favorites:[],notes:[{product_id:"fixture-open",status:"trial",text:"kept",updated_at:"bad-date"}],comparisons:[]};
 await page.getByLabel("选择本地备份文件").setInputFiles({name:"bad-inner.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(bad))});await expect(page.getByRole("alert")).toContainText("备份无法读取");expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBeNull();
 const raw=JSON.stringify({version:2,items:old.items,notes:bad.notes,comparisons:[]});await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key:KEY,raw});await page.reload();await expect(page.getByRole("alert")).toContainText("原记录未改动");await page.getByText("本地备份与恢复",{exact:true}).click();await expect(page.getByRole("button",{name:"导出完整备份",exact:true})).toBeDisabled();
 await page.goto("/products/fixture-open");await page.getByRole("button",{name:"收藏 测试开源项目",exact:true}).click();expect(await page.evaluate(key=>localStorage.getItem(key),KEY)).toBe(raw);
});
