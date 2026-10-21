// F26 — the handoffs, on the company's side.
//
// Brief (user-brief.md): "能转人工，最好能留个联系方式，记录下来" — the company has to see the
// requests for a person and the way to answer the visitor who made them.
// Contract (api.yaml §/api/workspaces/{ws}/handoffs): GET .../handoffs -> {handoffs}, any
// member, newest first; the Handoff carries the name, the e-mail and the note the visitor left.
// UI anchor (testability.md §8): handoff-item — one per handoff, its text contains the address
// the visitor left.

import { expect, test } from "vitest";
import type { Page } from "playwright";
import { PASSWORD, expectStatus, newEmail, signup, uid, waitFor } from "../../lib/helpers";
import { Client } from "../../lib/client";
import { OWN_ORIGIN, visitor, widgetSettings } from "../../lib/widget";
import { withPage, uiLogin } from "../../lib/ui";

async function shown(page: Page, testId: string): Promise<boolean> {
  const loc = page.getByTestId(testId);
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

async function waitForAny(page: Page, testIds: string[], timeout = 30_000): Promise<string> {
  return waitFor(
    async () => {
      for (const id of testIds) if (await shown(page, id)) return id;
      return undefined;
    },
    { timeout, what: `one of ${testIds.join(" / ")} to be visible` },
  );
}

async function waitForVisible(page: Page, testId: string, timeout = 30_000): Promise<void> {
  await page.getByTestId(testId).first().waitFor({ state: "visible", timeout });
}

/** The workspace the browser is showing, so the browser and the API talk about one workspace. */
async function workspaceOfBrowser(api: Client, page: Page): Promise<string> {
  const name = (await page.getByTestId("workspace-name").first().innerText()).trim();
  const res = await api.get("/api/workspaces");
  expectStatus(res, 200);
  const list = (res.body?.workspaces ?? []) as { id: string; name: string }[];
  const ws = list.find((w) => w.name === name) ?? list[0];
  expect(ws, `the workspace the browser shows ("${name}") must exist in the API`).toBeTruthy();
  return ws.id;
}

test("F26: the handoff page lists the request for a person with the address the visitor left", async () => {
  const account = await signup({ email: newEmail("handofflist"), password: PASSWORD });

  await withPage(async (page) => {
    await uiLogin(page, account.email, PASSWORD);
    const landing = await waitForAny(page, ["workspace-create-name", "workspace-name"], 30_000);
    if (landing === "workspace-create-name") {
      await page.getByTestId("workspace-create-name").fill(`Lamp shop ${uid()}`);
      await page.getByTestId("workspace-create-submit").click();
    }
    await waitForVisible(page, "workspace-name", 30_000);
    const wsId = await workspaceOfBrowser(account.client, page);
    const settings = await widgetSettings(account.client, wsId);

    // A visitor of the company's website asks for a person and leaves an address.
    const contact = `visitor-${uid()}@example.test`;
    const v = await visitor(settings.widgetKey, OWN_ORIGIN);
    const res = await v.handoff({ email: contact });
    expectStatus(res, 201);

    // The handoffs page.
    await page.getByTestId("nav-handoffs").first().click();

    // The handoff is on the page, with the address the visitor left.
    const item = await waitFor(
      async () => {
        const items = page.getByTestId("handoff-item");
        for (let i = 0; i < (await items.count()); i++) {
          const text = (await items.nth(i).innerText()).trim();
          if (text.includes(contact)) return text;
        }
        return undefined;
      },
      { timeout: 30_000, interval: 250, what: "a handoff-item with the visitor's address" },
    );
    expect(item.length, "the handoff item must not be empty").toBeGreaterThan(0);
  });
});
