import {test,expect} from "@playwright/test";
test.skip(!!process.env.SAAS_E2E_REAL,"Isolated mobile filter checks");
test("mobile filters stay compact, chips remove one condition and preserve URL",async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto("/search?q=CRM系统&track=open_source&deployment=docker");
 await expect(page.getByLabel("产品分区",{exact:true})).toBeHidden();
 await expect(page.getByRole("button",{name:"移除筛选 开源项目",exact:true})).toBeVisible();
 await expect(page.locator(".product-card").first()).toBeInViewport();
 await page.getByRole("button",{name:/筛选与排序/}).click();
 await page.getByLabel("产品分区",{exact:true}).selectOption("commercial");
 await expect(page).toHaveURL(/track=commercial/);
 await page.getByRole("button",{name:"移除筛选 Docker",exact:true}).click();
 await expect(page).not.toHaveURL(/deployment=/);
 await expect(page).toHaveURL(/track=commercial/);
 await page.reload();await expect(page.getByLabel("产品分区",{exact:true})).toBeHidden();
 await page.getByRole("button",{name:/筛选与排序/}).click();
 await expect(page.getByLabel("产品分区",{exact:true})).toHaveValue("commercial");
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
