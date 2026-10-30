const { test, expect } = require("./extension.cjs");

const toggle = page => page.locator('[data-setting="saveNotifications"]');
const settingsUrl = extension => new URL("settings.html", extension.url).href;

async function seed(worker, language = "en") {
  await worker.evaluate(async language => {
    await chrome.storage.local.set({ laterOnSettings: { language, theme: language === "en" ? "dark" : "light", autoCleanEnabled: false } });
  }, language);
}

// Only browser permission APIs are replaced; the built settings UI and its click handlers stay real.
async function permissionBoundary(page, granted = false) {
  await page.addInitScript(granted => {
    const added = new Set(), removed = new Set();
    const fixture = window.notificationPermission = {
      granted, mode: "grant", calls: [], failRead: false, holdRead: false, releaseRead: null, releaseRequest: null,
      change(granted) {
        fixture.granted = granted;
        (granted ? added : removed).forEach(listener => listener({ permissions: ["notifications"] }));
      }
    };
    chrome.permissions.contains = async request => {
      fixture.calls.push({ method: "contains", request });
      if (fixture.failRead) throw Error("fixture read failure");
      const value = fixture.granted;
      if (!fixture.holdRead) return value;
      fixture.holdRead = false;
      return new Promise(resolve => { fixture.releaseRead = () => resolve(value); });
    };
    chrome.permissions.request = request => {
      fixture.calls.push({ method: "request", request, userGesture: navigator.userActivation.isActive });
      if (fixture.mode === "error") return Promise.reject(Error("fixture request failure"));
      if (fixture.mode === "deny") return Promise.resolve(false);
      if (fixture.mode === "hold") return new Promise(resolve => {
        fixture.releaseRequest = () => { fixture.change(true); resolve(true); };
      });
      fixture.change(true);
      return Promise.resolve(true);
    };
    chrome.permissions.remove = async request => {
      fixture.calls.push({ method: "remove", request });
      if (fixture.mode === "error") throw Error("fixture remove failure");
      if (fixture.mode === "deny") return false;
      fixture.change(false);
      return true;
    };
    chrome.permissions.onAdded.addListener = listener => added.add(listener);
    chrome.permissions.onAdded.removeListener = listener => added.delete(listener);
    chrome.permissions.onRemoved.addListener = listener => removed.add(listener);
    chrome.permissions.onRemoved.removeListener = listener => removed.delete(listener);
  }, granted);
}

for (const language of ["zh-CN", "en"]) {
  test(`可选通知：${language} 新安装默认未授权，设置展示用途且不改变收藏设置`, async ({ page, extension }) => {
    await seed(extension.worker, language);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const before = await extension.worker.evaluate(() => chrome.storage.local.get("laterOnSettings"));
    expect(await extension.worker.evaluate(() => chrome.permissions.contains({ permissions: ["notifications"] }))).toBe(false);
    const manifest = await extension.worker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.permissions).not.toContain("notifications");
    expect(manifest.optional_permissions).toContain("notifications");
    await page.setViewportSize({ width: language === "en" ? 375 : 1360, height: 900 });
    await page.goto(settingsUrl(extension));
    await expect(toggle(page)).toBeEnabled();
    await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
    await expect(toggle(page)).toHaveAccessibleName(language === "en" ? "Save notifications for suspended tabs" : "冻结页收藏通知");
    await expect(page.locator("#notificationsHint")).toContainText(language === "en" ? "toolbar badges" : "工具栏角标");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`notification-setting-${language}.png`), fullPage: true });
    await page.reload();
    await expect(toggle(page)).toBeEnabled();
    await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
    expect(await extension.worker.evaluate(() => chrome.storage.local.get("laterOnSettings"))).toEqual(before);
    expect(errors).toEqual([]);
  });
}

test("可选通知：点击后才申请，拒绝可重试，等待授权时锁定，关闭撤销权限", async ({ page, extension }) => {
  await seed(extension.worker);
  await permissionBoundary(page);
  await page.goto(settingsUrl(extension));
  await expect(toggle(page)).toBeEnabled();
  expect(await page.evaluate(() => window.notificationPermission.calls.filter(call => call.method !== "contains"))).toEqual([]);
  await page.evaluate(() => { window.notificationPermission.mode = "deny"; });
  await toggle(page).click();
  await expect(page.getByRole("alert")).toContainText("Notification permission was not granted.");
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await expect(toggle(page)).toBeEnabled();
  await page.evaluate(() => { window.notificationPermission.mode = "hold"; });
  await toggle(page).focus();
  await page.keyboard.press("Space");
  await expect(toggle(page)).toBeDisabled();
  await expect(toggle(page)).toHaveAttribute("aria-busy", "true");
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await page.evaluate(() => window.notificationPermission.releaseRequest());
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await expect(toggle(page)).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => { window.notificationPermission.mode = "grant"; });
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await expect(toggle(page)).toBeEnabled();
  const actions = await page.evaluate(() => window.notificationPermission.calls.filter(call => call.method !== "contains"));
  expect(actions.map(call => call.method)).toEqual(["request", "request", "remove"]);
  expect(actions.every(call => call.request.permissions.length === 1 && call.request.permissions[0] === "notifications")).toBe(true);
  expect(actions.filter(call => call.method === "request").every(call => call.userGesture)).toBe(true);
  expect((await extension.worker.evaluate(() => chrome.storage.local.get("laterOnSettings"))).laterOnSettings).toEqual({ language: "en", theme: "dark", autoCleanEnabled: false });
});

test("可选通知：已有授权显示开启，外部撤销立即同步，迟到查询不覆盖新状态", async ({ page, extension }) => {
  await seed(extension.worker);
  await permissionBoundary(page, true);
  await page.goto(settingsUrl(extension));
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await page.evaluate(() => {
    window.notificationPermission.holdRead = true;
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => page.evaluate(() => typeof window.notificationPermission.releaseRead)).toBe("function");
  await page.evaluate(() => window.notificationPermission.change(false));
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await page.evaluate(() => window.notificationPermission.releaseRead());
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await page.evaluate(() => window.notificationPermission.change(true));
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => window.notificationPermission.calls.filter(call => call.method !== "contains"))).toEqual([]);
});

test("可选通知：读取和授权异常可重试，撤销失败保持真实授权状态", async ({ page, extension }) => {
  await seed(extension.worker);
  await permissionBoundary(page);
  await page.addInitScript(() => { window.notificationPermission.failRead = true; });
  await page.goto(settingsUrl(extension));
  await expect(page.getByRole("alert")).toContainText("Unable to read notification permission.");
  await expect(toggle(page)).toBeDisabled();
  await page.evaluate(() => { window.notificationPermission.failRead = false; });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(toggle(page)).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => { window.notificationPermission.mode = "error"; });
  await toggle(page).click();
  await expect(page.getByRole("alert")).toContainText("Unable to change notification permission.");
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await expect(toggle(page)).toBeEnabled();
  await page.evaluate(() => { window.notificationPermission.mode = "grant"; });
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await expect(toggle(page)).toBeEnabled();
  for (const mode of ["deny", "error"]) {
    await page.evaluate(mode => { window.notificationPermission.mode = mode; }, mode);
    await toggle(page).click();
    await expect(page.getByRole("alert")).toContainText("Unable to change notification permission.");
    await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
    await expect(toggle(page)).toBeEnabled();
  }
  await page.evaluate(() => { window.notificationPermission.mode = "grant"; });
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
