import {test,expect,type Page} from "@playwright/test";
import {mkdir,readFile} from "node:fs/promises";
test.skip(!process.env.SAAS_E2E_REAL,"Real CRM selection against a temporary formal-catalog copy");
const CRM="customer-relationship-management-crm",OUT="../docs/local-decisions",KEY="saas-grove.saved-products.v1";
async function save(page:Page,name:string) {await page.goto(`/search?${new URLSearchParams({q:name})}`);await page.getByRole("button",{name:`收藏 ${name}`,exact:true}).click();}
async function select(page:Page,names:string[]) {await page.goto(`/shortlist?type=${CRM}`);for(const name of names)await page.getByRole("checkbox",{name:`选择比较 ${name}`,exact:true}).check();await page.getByRole("link",{name:"开始比较",exact:true}).click();}

test("real desktop CRM: evidence, personal reasoning, saved focus and full backup round trip",async({page,browser})=>{
 await mkdir(OUT,{recursive:true});await page.setViewportSize({width:1440,height:1000});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 for(const name of ["Twenty","EspoCRM","Salesforce Sales Cloud"])await save(page,name);
 await select(page,["Twenty","EspoCRM","Salesforce Sales Cloud"]);
 await expect(page.locator(".comparison-table thead th")).toHaveCount(4);
 const automation=page.locator('tr[data-dimension="crm-automation"]');
 await expect(automation).toContainText("单独扩展");await expect(automation.locator("td").nth(2)).toContainText("资料未提供 / 未核实");
 const espo=automation.locator("td").nth(1);await espo.getByText("查看本项依据",{exact:true}).click();await expect(espo.getByRole("link",{name:"官方来源",exact:true})).toHaveAttribute("href","https://www.espocrm.com/extensions/advanced-pack/");
 await expect(page.locator('tr[data-dimension="crm-pipeline"] td').first()).toContainText("资料未提供 / 未核实");
 await page.locator('tr[data-dimension="crm-automation"]').scrollIntoViewIfNeeded();await page.screenshot({path:`${OUT}/crm-evidence-desktop.png`});
 await page.getByRole("checkbox",{name:"技术栈",exact:true}).uncheck();await page.reload();await expect(page.getByRole("checkbox",{name:"技术栈",exact:true})).not.toBeChecked();
 await page.locator(".comparison-table thead").scrollIntoViewIfNeeded();await page.screenshot({path:`${OUT}/crm-comparison-desktop.png`});
 const note=page.locator(".personal-note-grid > div").filter({has:page.getByRole("heading",{name:"Twenty",exact:true})});await note.locator("summary").click();
 await page.getByLabel("Twenty 选型状态",{exact:true}).selectOption("trial");await page.getByLabel("Twenty 个人备注",{exact:true}).fill("先验证团队协作与导出，暂不把资料核对当实测。");await note.getByRole("button",{name:"保存个人记录",exact:true}).click();
 await page.getByLabel("比较名称",{exact:true}).fill("团队 CRM 选型");await page.getByLabel("我的选型结论",{exact:true}).fill("先试用 Twenty；EspoCRM 需确认付费扩展；Salesforce 深度资料未核实。");await page.getByRole("button",{name:"保存比较",exact:true}).click();
 await page.locator(".save-comparison-form").scrollIntoViewIfNeeded();await page.screenshot({path:`${OUT}/personal-reasoning-desktop.png`});
 await page.getByRole("link",{name:"查看已保存比较",exact:true}).click();await expect(page.getByRole("link",{name:"团队 CRM 选型",exact:true})).toBeVisible();await page.getByText("本地备份与恢复",{exact:true}).click();
 await page.screenshot({path:`${OUT}/saved-comparison-desktop.png`,fullPage:true});
 const dl=page.waitForEvent("download");await page.getByRole("button",{name:"导出完整备份",exact:true}).click();const bytes=await readFile((await(await dl).path())!);const backup=JSON.parse(bytes.toString());expect(backup.favorites).toHaveLength(3);expect(backup.notes).toHaveLength(1);expect(backup.comparisons).toHaveLength(1);
 const restored=await browser.newContext({viewport:{width:1440,height:1000}});const other=await restored.newPage();other.on("pageerror",e=>errors.push(e.message));await other.goto(new URL("/shortlist",page.url()).toString());await other.getByText("本地备份与恢复",{exact:true}).click();
 await other.getByLabel("选择本地备份文件").setInputFiles({name:"crm-backup.json",mimeType:"application/json",buffer:bytes});await expect(other.locator(".backup-preview")).toContainText("新增 3 个收藏、1 条备注、1 个比较");await other.getByRole("button",{name:"合并导入",exact:true}).click();await other.getByRole("link",{name:"团队 CRM 选型",exact:true}).click();await other.reload();
 await expect(other.getByLabel("我的选型结论",{exact:true})).toHaveValue(backup.comparisons[0].conclusion);await expect(other.getByRole("checkbox",{name:"技术栈",exact:true})).not.toBeChecked();
 const restoredData=await other.evaluate(key=>JSON.parse(localStorage.getItem(key)!),KEY);expect(restoredData.notes).toEqual(backup.notes);expect(restoredData.comparisons).toEqual(backup.comparisons);expect(restoredData.items).toEqual(backup.favorites);
 await restored.close();expect(errors).toEqual([]);
});

test("real mobile CRM: fold identical facts, annotate, save, reopen and export",async({page})=>{
 await mkdir(OUT,{recursive:true});await page.setViewportSize({width:390,height:844});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await save(page,"Twenty");await page.goto("/search?q=EspoCRM");await page.getByRole("heading",{name:"EspoCRM",exact:true}).getByRole("link").click();await page.getByRole("button",{name:"收藏 EspoCRM",exact:true}).click();
 await page.locator(".product-personal summary").click();await page.getByLabel("EspoCRM 选型状态",{exact:true}).selectOption("research");await page.getByLabel("EspoCRM 个人备注",{exact:true}).fill("需要核对社区版与 Advanced Pack 的功能边界");await page.getByRole("button",{name:"保存个人记录",exact:true}).click();
 await select(page,["Twenty","EspoCRM"]);await expect(page.locator(".comparison-table thead th")).toHaveCount(3);await expect(page.locator('tr[data-dimension="openness"]')).toHaveCount(0);await page.getByRole("button",{name:/展开相同记录/}).click();await expect(page.locator('tr[data-dimension="license"]')).toBeVisible();
 await page.locator(".comparison-table thead").scrollIntoViewIfNeeded();const region=page.getByRole("region",{name:"产品比较表，可横向滚动"});await region.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await expect(page.getByLabel("替换 EspoCRM",{exact:true})).toBeInViewport();await page.screenshot({path:`${OUT}/crm-comparison-mobile.png`});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByLabel("比较名称",{exact:true}).fill("手机 CRM 候选");await page.getByLabel("我的选型结论",{exact:true}).fill("两个开源候选，先验证部署成本");await page.getByRole("button",{name:"保存比较",exact:true}).click();await page.getByRole("link",{name:"查看已保存比较",exact:true}).click();await page.reload();await page.screenshot({path:`${OUT}/saved-comparison-mobile.png`});
 await page.getByRole("link",{name:"手机 CRM 候选",exact:true}).click();await expect(page.getByLabel("我的选型结论",{exact:true})).toHaveValue("两个开源候选，先验证部署成本");await expect(page.getByRole("button",{name:/收起相同记录/})).toHaveAttribute("aria-pressed","true");
 const espo=page.locator(".personal-note-grid > div").filter({has:page.getByRole("heading",{name:"EspoCRM",exact:true})});await espo.locator("summary").click();await expect(page.getByLabel("EspoCRM 个人备注",{exact:true})).toHaveValue("需要核对社区版与 Advanced Pack 的功能边界");await espo.scrollIntoViewIfNeeded();await page.screenshot({path:`${OUT}/personal-reasoning-mobile.png`});
 await page.getByRole("link",{name:"查看已保存比较",exact:true}).click();await page.getByText("本地备份与恢复",{exact:true}).click();const dl=page.waitForEvent("download");await page.getByRole("button",{name:"导出完整备份",exact:true}).click();expect(JSON.parse(await readFile((await(await dl).path())!,"utf8")).notes).toHaveLength(1);expect(errors).toEqual([]);
});
