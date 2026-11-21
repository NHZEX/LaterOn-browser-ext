const { test, expect } = require("./extension.cjs");
const { readFile } = require("node:fs/promises");

test("已删除来源的旧草稿可从设置查看、复制和清理，不随备份导出", async ({ page, context, extension }) => {
  await page.goto(new URL("settings.html#backup", extension.url).href);
  const saved = await page.evaluate(() => chrome.runtime.sendMessage({ type: "COLLECTION_COMMAND", action: "mutateItems",
    epoch: "", operation: "update", ids: ["removed"], patch: { title: "过时的草稿" },
    editBasis: { title: { value: "删除前的标题", revision: null }, description: { value: null, revision: null } } }));
  expect(saved).toMatchObject({ ok: true, affected: 0, editConflict: "pending" });
  const recovery = page.getByRole("region", { name: "本机找回" });
  await recovery.getByRole("button", { name: "查看本机找回记录" }).click();
  await expect(recovery.getByText("过时的草稿", { exact: true })).toBeVisible();
  await context.grantPermissions(["clipboard-read"]);
  await recovery.getByRole("button", { name: "复制" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("过时的草稿");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#exportBtn").click()]);
  const content = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(content.data.items).toEqual([]);
  expect(JSON.stringify(content)).not.toContain("过时的草稿");
  await page.reload();
  await recovery.getByRole("button", { name: "查看本机找回记录" }).click();
  await expect(recovery.getByText("过时的草稿", { exact: true })).toBeVisible();
  await recovery.getByRole("button", { name: "清理找回记录" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "清理找回记录" }).click();
  await expect(recovery.getByText("没有可找回的记录。", { exact: true })).toBeVisible();
  await page.reload();
  await recovery.getByRole("button", { name: "查看本机找回记录" }).click();
  await expect(recovery.getByText("没有可找回的记录。", { exact: true })).toBeVisible();
});
