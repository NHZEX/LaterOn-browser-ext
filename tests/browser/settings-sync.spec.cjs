const { test, expect } = require("./extension.cjs");

test("可同步项的小云朵常显，随偏好同步开关变色", async ({ page, extension }) => {
  await extension.worker.evaluate(() => chrome.storage.local.set({
    laterOnCleanupV165: true, laterOnSettings: { language: "en", autoCleanEnabled: false }
  }));
  await page.goto(new URL("settings.html", extension.url).href);
  const syncSwitch = page.getByRole("switch", { name: "Sync preferences with the browser" });
  const preferenceIcons = ["Language", "Theme", "Default sort"].map(label =>
    page.getByText(label, { exact: true }).locator("svg")
  );
  const [languageIcon] = preferenceIcons;
  await expect(syncSwitch).toHaveAttribute("aria-checked", "false");
  const mutedColor = await languageIcon.evaluate(icon => getComputedStyle(icon).color);
  for (const icon of preferenceIcons) {
    await expect(icon).toBeVisible();
    await expect(icon).toHaveCSS("color", mutedColor);
  }

  await syncSwitch.click();
  await expect(syncSwitch).toHaveAttribute("aria-checked", "true");
  await expect(languageIcon).not.toHaveCSS("color", mutedColor);
  const highlightedColor = await languageIcon.evaluate(icon => getComputedStyle(icon).color);
  for (const icon of preferenceIcons) await expect(icon).toHaveCSS("color", highlightedColor);
  for (const label of ["Choose a project before adding the current page", "Share WebDAV preset"]) {
    const settingLabel = page.getByText(label, { exact: true });
    await expect(settingLabel).toBeVisible();
    await expect(settingLabel.locator("svg")).toBeHidden();
  }

  await page.reload();
  for (const icon of preferenceIcons) await expect(icon).toHaveCSS("color", highlightedColor);
  await syncSwitch.click();
  await expect(syncSwitch).toHaveAttribute("aria-checked", "false");
  for (const icon of preferenceIcons) {
    await expect(icon).toBeVisible();
    await expect(icon).toHaveCSS("color", mutedColor);
  }
});

test("浏览器同步只应用已选择的偏好，WebDAV 新预设保留正在编辑和已测试的草稿", async ({ page, extension }) => {
  const presetKey = "stayside.webdav-preset";
  const initial = { endpoint: "https://old.example.test/dav/", directory: "StaySide", username: "fixture",
    intervalHours: 24, includeImages: true };
  await extension.worker.evaluate(async ({ presetKey, initial }) => {
    await chrome.storage.local.set({ laterOnCleanupV165: true, laterOnSettings: { language: "en", autoCleanEnabled: false } });
    await chrome.storage.sync.set({ "stayside.preference.theme": "dark", [presetKey]: initial });
    globalThis.fixtureRequests = [];
    globalThis.fetch = async (url, request) => {
      fixtureRequests.push({ url, method: request.method });
      const listing = `<multistatus xmlns="DAV:"><response><href>${url}</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response></multistatus>`;
      return new Response(listing, { status: 207 });
    };
  }, { presetKey, initial });
  await page.goto(new URL("settings.html", extension.url).href);
  const syncSwitch = page.getByRole("switch", { name: "Sync preferences with the browser" });
  const presetSwitch = page.getByRole("switch", { name: "Share WebDAV preset" });
  const themeIcon = page.locator("#themeLabel svg");
  await expect(syncSwitch).toHaveAttribute("aria-checked", "false");
  const mutedColor = await themeIcon.evaluate(icon => getComputedStyle(icon).color);
  await syncSwitch.click();
  await expect(page.getByRole("row", { name: "Theme Light Dark" })).toBeVisible();
  await expect(themeIcon).toHaveCSS("color", mutedColor);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Use browser sync settings" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await extension.worker.evaluate(() => chrome.storage.sync.get([
    "stayside.preference.language", "stayside.preference.defaultSort"
  ]))).toEqual({});
  await expect(presetSwitch).toHaveAttribute("aria-checked", "false");
  await presetSwitch.click();
  await page.getByRole("tab", { name: "Backup & restore" }).click();
  await page.getByRole("button", { name: "Load preset draft" }).click();
  const endpoint = page.getByPlaceholder("https://…");
  const password = page.locator('.webdav-form input[type="password"]');
  const apply = page.getByRole("button", { name: "Apply preset" });
  const testConnection = page.getByRole("button", { name: "Test connection" });
  await expect(endpoint).toHaveValue(initial.endpoint);
  await expect(apply).toBeDisabled();
  await password.fill("local-app-password");
  await testConnection.click();
  await expect(apply).toBeEnabled();

  const next = { ...initial, endpoint: "https://new.example.test/dav/" };
  await extension.worker.evaluate(({ presetKey, next }) => chrome.storage.sync.set({ [presetKey]: next }), { presetKey, next });
  const switchDraft = page.getByRole("button", { name: "Switch to new draft" });
  await expect(switchDraft).toBeVisible();
  await expect(endpoint).toHaveValue(initial.endpoint);
  await expect(apply).toBeEnabled();
  expect(await extension.worker.evaluate(() => globalThis.fixtureRequests)).toEqual([{ url: initial.endpoint, method: "PROPFIND" }]);
  await switchDraft.click();
  await expect(endpoint).toHaveValue(next.endpoint);
  await expect(password).toHaveValue("");
  await expect(apply).toBeDisabled();
  await password.fill("local-app-password");
  await testConnection.click();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole("button", { name: "Back up now" })).toBeEnabled();
  expect(await extension.worker.evaluate(async () => {
    const { laterOnWebdavBackup } = await chrome.storage.local.get("laterOnWebdavBackup");
    return { endpoint: laterOnWebdavBackup.settings.endpoint, automatic: laterOnWebdavBackup.settings.automatic };
  })).toEqual({ endpoint: next.endpoint, automatic: false });
  expect(await extension.worker.evaluate(key => chrome.storage.sync.get(key), presetKey)).toEqual({ [presetKey]: next });

  await extension.worker.evaluate(() => chrome.storage.sync.set({ "stayside.preference.language": "zh-CN" }));
  await expect(page.getByRole("tab", { name: "备份与恢复" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "立即备份" })).toBeEnabled();
});
