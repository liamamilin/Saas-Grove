// Held-out acceptance tests: the flows the browser has to support.
//
// Clauses under test:
//   * spec/product.md S1 — "基础界面（注册 → 创建工作区 → 进入工作区）".
//   * spec/product.md S2 — "界面上可发起研究、看进度、看报告"; 上传资料.
//   * spec/product.md S4 — "界面上的追问与用量页面".
//   * spec/product.md §4.6 — 追问：流式回答.
// Anchors used are exactly the data-testid values of contract testability.md §8.

import { describe, expect, test } from "vitest";
import { addText, expectStatus, finishedJob, newEmail, owner, uid, PASSWORD } from "../../lib/helpers";
import { SOLAR } from "../../lib/corpus";
import { uiLogin, withPage } from "../../lib/ui";

describe("browser flows", () => {
  test("signing up in the browser leads to a workspace home", async () => {
    // product.md S1: 注册 → 创建工作区 → 进入工作区; testability §8 anchors.
    const email = newEmail("ui-signup");
    const wsName = `UI workspace ${uid()}`;

    await withPage(async (page) => {
      await page.goto("/signup");
      await page.getByTestId("signup-name").fill("UI User");
      await page.getByTestId("signup-email").fill(email);
      await page.getByTestId("signup-password").fill(PASSWORD);
      await page.getByTestId("signup-submit").click();

      const onboarding = page.getByTestId("workspace-create-name");
      const home = page.getByTestId("workspace-name");
      const visible = async () => (await onboarding.count()) + (await home.count());

      await expect
        .poll(visible, { timeout: 30_000, message: "neither the workspace-creation page nor the workspace home appeared" })
        .toBeGreaterThan(0);

      if ((await onboarding.count()) === 0) await page.goto("/");
      await expect.poll(visible, { timeout: 30_000 }).toBeGreaterThan(0);

      if (await onboarding.count()) {
        await onboarding.fill(wsName);
        await page.getByTestId("workspace-create-submit").click();
      }

      await home.waitFor({ state: "visible", timeout: 30_000 });
      expect(await home.textContent()).toContain(wsName);
      await page.getByTestId("nav-research").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByTestId("nav-usage").waitFor({ state: "visible", timeout: 30_000 });
    });
  });

  test("pasting a document in the browser shows it becoming ready", async () => {
    // product.md S2: 资料上传与解析, 界面上可发起研究; testability §8: document-item 的文本包含它的状态值.
    const team = await owner();
    const title = `UI notes ${uid()}`;
    const body = "The harbour clock is wound every Tuesday at dawn by the keeper on duty.";

    await withPage(async (page) => {
      await uiLogin(page, team.email, PASSWORD);
      await page.goto("/");
      await page.getByTestId("nav-research").click();
      await page.getByTestId("document-text-title").fill(title);
      await page.getByTestId("document-text-body").fill(body);
      // Let the create request finish before touching the page again: a reload would abort it.
      const posted = page.waitForResponse((r) => r.request().method() === "POST", { timeout: 60_000 }).catch(() => null);
      await page.getByTestId("document-text-submit").click();
      await posted;

      // Then re-read the page until one of the items says "ready", in case the list does not
      // refresh its statuses on its own.
      const readyItems = page.getByTestId("document-item").filter({ hasText: "ready" });
      await expect
        .poll(
          async () => {
            if ((await readyItems.count()) > 0) return true;
            await page.reload();
            return (await readyItems.count()) > 0;
          },
          { timeout: 60_000, interval: 2000, message: "no document-item ever showed the ready status" },
        )
        .toBe(true);
    });

    // the pasted document really reached the workspace
    const docs = await team.client.get(`/api/workspaces/${team.ws.id}/documents`);
    expectStatus(docs, 200);
    const created = ((docs.body?.documents ?? []) as any[]).find((d) => d.title === title);
    expect(created, JSON.stringify(docs.body)).toBeTruthy();
    expect(created.status).toBe("ready");
  });

  test("the report page streams a follow-up answer into an assistant message", async () => {
    // product.md S4: 界面上的追问; §4.6: 追问以流式返回; testability §8: report-link / chat-* anchors.
    const team = await owner();
    const doc = await addText(team.client, team.ws.id, SOLAR);
    await finishedJob(team.client, team.ws.id, [doc.id]);

    await withPage(async (page) => {
      await uiLogin(page, team.email, PASSWORD);
      await page.goto("/");
      await page.getByTestId("report-link").first().click();
      await page.getByTestId("report-content").waitFor({ state: "visible", timeout: 30_000 });

      await page.getByTestId("chat-input").fill("What limits do these documents mention?");
      await page.getByTestId("chat-submit").click();

      const answer = page.getByTestId("chat-message-assistant").first();
      await answer.waitFor({ state: "visible", timeout: 60_000 });
      await expect.poll(async () => (await answer.innerText()).trim().length, { timeout: 60_000 }).toBeGreaterThan(0);
    });
  });
});
