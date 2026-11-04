import {test,expect,type Page} from "@playwright/test";
import {mkdir} from "node:fs/promises";
test.skip(!process.env.SAAS_E2E_REAL,"Real catalog selection acceptance");
const OUT="../docs/selection-evidence",CRM="customer-relationship-management-crm",KEY="saas-grove.saved-products.v1";
async function save(page:Page,name:string){await page.goto(`/search?${new URLSearchParams({q:name})}`);await page.getByRole("button",{name:`收藏 ${name}`,exact:true}).click();await expect(page.getByRole("button",{name:`取消收藏 ${name}`,exact:true})).toHaveAttribute("aria-pressed","true");}
async function compare(page:Page,leaf:string,names:string[]){await page.goto(`/shortlist?type=${leaf}`);for(const n of names)await page.getByRole("checkbox",{name:`选择比较 ${n}`,exact:true}).check();await page.getByRole("link",{name:"开始比较",exact:true}).click();await expect(page.locator(".comparison-table thead th")).toHaveCount(names.length+1);}

test("real desktop CRM: four products, explicit negative, edition and source, saved conclusion",async({page})=>{
 await mkdir(OUT,{recursive:true});await page.setViewportSize({width:1440,height:1000});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error"&&/same key|unique.*key/i.test(m.text()))errors.push(m.text());});
 for(const n of ["Django CRM","Frappe CRM","SuiteCRM","Salesforce Sales Cloud"])await save(page,n);
 await compare(page,CRM,["Django CRM","Frappe CRM","SuiteCRM","Salesforce Sales Cloud"]);
 const api=page.locator('tr[data-dimension="crm-api"]');await expect(api.locator("td").first()).toContainText("明确不支持");await expect(api.locator("td").nth(3)).toContainText("资料未提供 / 未核实");
 await api.locator("td").first().getByText("查看本项依据",{exact:true}).click();await expect(api.locator("td").first().getByRole("link",{name:"官方来源",exact:true}).first()).toHaveAttribute("href",/^https:\/\/raw.githubusercontent.com\/DjangoCRM\//);
 await expect(page.locator(".comparison-table thead")).toContainText("7.x");
 await page.locator('tr[data-dimension="crm-api"]').scrollIntoViewIfNeeded();await page.screenshot({path:`${OUT}/crm-evidence-desktop.png`});
 await page.getByRole("checkbox",{name:"技术栈",exact:true}).uncheck();await page.reload();await expect(page.getByRole("checkbox",{name:"技术栈",exact:true})).not.toBeChecked();
 await page.getByLabel("比较名称",{exact:true}).fill("CRM 二轮候选");await page.getByLabel("我的选型结论",{exact:true}).fill("需要内置 REST API 的场景先不选 Django CRM；其他接口与版本待实际试用。");await page.getByRole("button",{name:"保存比较",exact:true}).click();
 await page.getByRole("link",{name:"查看已保存比较",exact:true}).click();await page.getByRole("link",{name:"CRM 二轮候选",exact:true}).click();await page.reload();await expect(page.getByLabel("我的选型结论",{exact:true})).toHaveValue(/内置 REST API/);
 const stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)!),KEY);expect(stored.items).toHaveLength(4);expect(stored.comparisons).toHaveLength(1);expect(stored.version).toBe(3);expect(errors).toEqual([]);
});

test("real mobile help desk: compact search, source-bound SLA, unknown add-ons, note and saved selection",async({page})=>{
 await mkdir(OUT,{recursive:true});await page.setViewportSize({width:390,height:844});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error"&&/same key|unique.*key/i.test(m.text()))errors.push(m.text());});
 await page.goto("/search?leaf=help-desk&track=open_source");await expect(page.getByLabel("产品分区",{exact:true})).toBeHidden();await expect(page.locator(".product-card").first()).toBeInViewport();await page.screenshot({path:`${OUT}/search-mobile.png`});
 await page.getByRole("button",{name:/筛选与排序/}).click();await expect(page.getByLabel("产品分区",{exact:true})).toHaveValue("open_source");await page.getByRole("button",{name:/收起筛选/}).click();
 for(const n of ["Zammad","FreeScout","osTicket"])await save(page,n);
 await compare(page,"help-desk",["Zammad","FreeScout","osTicket"]);
 const sla=page.locator('tr[data-dimension="helpdesk-sla"]');await expect(sla.locator("td").first()).toContainText("超过期限后工单升级");await expect(sla.locator("td").nth(1)).toContainText("资料未提供 / 未核实");
 await sla.locator("td").first().getByText("查看本项依据",{exact:true}).click();await expect(sla.locator("td").first().getByRole("link",{name:"官方来源",exact:true}).first()).toHaveAttribute("href",/^https:\/\/user-docs.zammad.org\//);
 await page.locator(".comparison-table thead").scrollIntoViewIfNeeded();await page.screenshot({path:`${OUT}/helpdesk-compare-mobile.png`});
 const scroll=page.getByRole("region",{name:"产品比较表，可横向滚动"});await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await expect(page.getByLabel("替换 osTicket",{exact:true})).toBeInViewport();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const note=page.locator(".personal-note-grid > div").filter({has:page.getByRole("heading",{name:"Zammad",exact:true})});await note.locator("summary").click();await page.getByLabel("Zammad 个人备注",{exact:true}).fill("先验证收件箱导入与升级提醒；资料核对不等于试用。");await note.getByRole("button",{name:"保存个人记录",exact:true}).click();
 await page.getByLabel("比较名称",{exact:true}).fill("客服工单候选");await page.getByLabel("我的选型结论",{exact:true}).fill("先试 Zammad；FreeScout 的 SLA 模块与授权仍待核实。");await page.getByRole("button",{name:"保存比较",exact:true}).click();await page.getByRole("link",{name:"查看已保存比较",exact:true}).click();await page.reload();await page.getByRole("link",{name:"客服工单候选",exact:true}).click();await expect(page.getByLabel("我的选型结论",{exact:true})).toHaveValue(/SLA 模块/);expect(errors).toEqual([]);
});

test("real desktop resources and truthful missing images, preferred type labels",async({page,request})=>{
 await mkdir(OUT,{recursive:true});await page.setViewportSize({width:1440,height:1000});
 const ids=["github:818991119","github:80571","github:668199241","github:374132359","github:13044600","github:34716238","github:138328462","github:155852027","github:3898922","github:327306825"];
 for(const id of ids){const r=await request.get(`/api/products/${encodeURIComponent(id)}`);expect(r.ok()).toBe(true);const a=await r.json();expect(a.resources_curated).toBe(true);expect(a.resource_profile.resources.some((r:{type:string})=>r.type==="docs")).toBe(true);}
 await page.goto("/products/github%3A3898922");await expect(page.locator(".screenshot-grid img").first()).toBeVisible();await expect.poll(()=>page.locator(".screenshot-grid img").first().evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);await page.screenshot({path:`${OUT}/zammad-detail-desktop.png`,fullPage:true});
 const django=await(await request.get("/api/products/github%3A818991119")).json();
 await page.goto("/products/github%3A818991119");await expect(page.locator(".screenshot-grid img")).toHaveCount(django.resource_profile.screenshots.length);await expect(page.locator(".resource-missing")).toContainText(django.resource_profile.missing.find((m:{type:string})=>m.type==="screenshot").reason);
 await page.goto("/search?q=ERPNext");await expect(page.locator(".product-card").filter({has:page.getByRole("heading",{name:"ERPNext",exact:true})}).locator(".tag-type")).toHaveText(/ERP|资源计划/);
 await page.goto("/compare?leaf=help-desk&ids=github%3A3898922,github%3A138328462,github%3A12063996");await expect(page.locator('tr[data-dimension="helpdesk-sla"]')).toBeVisible();await page.locator(".comparison-table thead").scrollIntoViewIfNeeded();await page.screenshot({path:`${OUT}/helpdesk-compare-desktop.png`});
});
