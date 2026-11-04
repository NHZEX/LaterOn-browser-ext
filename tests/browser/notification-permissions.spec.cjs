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
    await expect(page.getByRole("button", { name: language === "en" ? "Send test notification" : "发送测试通知", exact: true })).toBeDisabled();
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

// Keep the settings UI, runtime messages, backend checks and persisted diagnostics real.
// Only the browser/OS permission and notification APIs are controlled.
async function notificationBackend(worker) {
  await worker.evaluate(() => {
    const fixture = globalThis.notificationBackend = {
      granted: true, level: "granted", attempts: [], failCreate: false, holdCreate: false, release: null
    };
    chrome.permissions.contains = async () => fixture.granted;
    chrome.notifications = {
      async getPermissionLevel() { return fixture.level; },
      async create(id, options) {
        fixture.attempts.push({ id, ...options });
        if (fixture.failCreate) throw Error("NOTIFICATION_TEST_FAILED");
        if (fixture.holdCreate) await new Promise(resolve => { fixture.release = resolve; });
        return id;
      }
    };
  });
}

for (const language of ["zh-CN", "en"]) {
  test(`测试通知：${language} 经后台发送、失败重试且保留诊断，不改变收藏或设置`, async ({ page, extension }) => {
    const en = language === "en";
    const button = page.getByRole("button", { name: en ? "Send test notification" : "发送测试通知", exact: true });
    await seed(extension.worker, language);
    await notificationBackend(extension.worker);
    await permissionBoundary(page, true);
    const keys = ["laterOnItems", "laterOnProjects", "laterOnSettings"];
    const before = await extension.worker.evaluate(keys => chrome.storage.local.get(keys), keys);
    await page.setViewportSize({ width: en ? 375 : 1360, height: 950 });
    await page.goto(settingsUrl(extension));
    await expect(button).toBeEnabled();
    await button.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText(en ? "Chrome accepted the notification" : "Chrome 已接收通知");
    await expect.poll(() => extension.worker.evaluate(() => notificationBackend.attempts.length)).toBe(1);
    const diag = await extension.worker.evaluate(() => chrome.storage.local.get("laterOnDiag"));
    expect(diag.laterOnDiag).toMatchObject({ lastNotificationStatus: "sent", lastNotificationSource: "test", lastNotificationError: "" });
    await extension.worker.evaluate(() => { notificationBackend.failCreate = true; });
    await button.click();
    await expect(page.getByRole("alert")).toContainText("NOTIFICATION_TEST_FAILED");
    await expect(button).toBeEnabled();
    expect((await extension.worker.evaluate(() => chrome.storage.local.get("laterOnDiag"))).laterOnDiag)
      .toMatchObject({ lastNotificationStatus: "failed", lastNotificationError: "NOTIFICATION_TEST_FAILED" });
    await page.screenshot({ path: test.info().outputPath(`notification-test-${language}-failure.png`), fullPage: true });
    await extension.worker.evaluate(() => { notificationBackend.failCreate = false; });
    await button.click();
    await expect(page.getByRole("status")).toContainText(en ? "Chrome accepted" : "Chrome 已接收");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await extension.worker.evaluate(keys => chrome.storage.local.get(keys), keys)).toEqual(before);
    expect(await page.evaluate(() => window.notificationPermission.calls.filter(call => call.method !== "contains"))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("tab", { name: en ? "Data & maintenance" : "数据与维护", exact: true }).click();
    await page.locator(".settings-diagnostics > summary").click();
    await expect(page.locator("#diagNotification")).toContainText(en ? "Manual test" : "手动测试");
    await expect(page.locator("#diagNotification")).toContainText(en ? "Chrome accepted" : "Chrome 已接收");
    await page.reload();
    await page.locator(".settings-diagnostics > summary").click();
    await expect(page.locator("#diagNotification")).toContainText(en ? "Chrome accepted" : "Chrome 已接收");
    expect((await extension.worker.evaluate(() => chrome.storage.local.get("laterOnDiag"))).laterOnDiag.lastNotificationError).toBe("");
  });
}

test("测试通知：Chrome 禁用、权限已丢失与接口不可用均明确提示", async ({ page, extension }) => {
  await seed(extension.worker);
  await notificationBackend(extension.worker);
  await permissionBoundary(page, true);
  await page.goto(settingsUrl(extension));
  const button = page.getByRole("button", { name: "Send test notification", exact: true });
  await expect(button).toBeEnabled();
  await extension.worker.evaluate(() => { notificationBackend.level = "denied"; });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("Chrome has blocked StaySide notifications");
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  expect(await extension.worker.evaluate(() => notificationBackend.attempts.length)).toBe(0);
  await extension.worker.evaluate(() => { notificationBackend.granted = false; });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("Notification permission is missing");
  await extension.worker.evaluate(() => { notificationBackend.granted = true; chrome.notifications = undefined; });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("The notification API is unavailable");
});

test("测试通知：等待期间防重复，外部撤销后迟到成功不覆盖界面", async ({ page, extension }) => {
  await seed(extension.worker);
  await notificationBackend(extension.worker);
  await extension.worker.evaluate(() => { notificationBackend.holdCreate = true; });
  await permissionBoundary(page, true);
  await page.goto(settingsUrl(extension));
  await page.getByRole("button", { name: "Send test notification", exact: true }).click();
  const pending = page.getByRole("button", { name: "Sending…", exact: true });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute("aria-busy", "true");
  await expect(toggle(page)).toBeDisabled();
  await expect.poll(() => extension.worker.evaluate(() => typeof notificationBackend.release)).toBe("function");
  await page.evaluate(() => window.notificationPermission.change(false));
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await extension.worker.evaluate(() => notificationBackend.release());
  await expect(page.getByRole("button", { name: "Send test notification", exact: true })).toBeDisabled();
  await expect(toggle(page)).toBeEnabled();
  await expect(page.locator("#notificationsTestResult")).toHaveCount(0);
  expect(await extension.worker.evaluate(() => notificationBackend.attempts.length)).toBe(1);
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
