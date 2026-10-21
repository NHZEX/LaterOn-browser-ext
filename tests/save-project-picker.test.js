const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

async function boot({ expired = false, language = "zh-CN", failConfirm = false, failCreate = false, failCancel = false } = {}) {
  const dom = new JSDOM(read("save-project-picker.html"), {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "chrome-extension://lateron/save-project-picker.html?batch=batch-123"
  });
  const { window } = dom;
  const messages = [];
  const removed = [];
  window.chrome = {
    tabs: { getCurrent: async () => ({ id: 99 }), remove: async (id) => { removed.push(id); } },
    storage: { local: { get: async () => ({ laterOnSettings: { language } }) } },
    runtime: {
      getURL: (file) => `chrome-extension://lateron/${file}`,
      async sendMessage(message) {
        messages.push(message);
        if (message.type === "GET_PENDING_PICKER") return expired ? { ok: false } : {
          ok: true, payload: {
            language, theme: "dark", selected: "work", savedCount: 0,
            folders: [{ id: "", name: "Inbox", count: 0 }, { id: "work", name: "工作", count: 2 }],
            pages: [{ title: "Example Domain", url: "https://example.com/page?a=1&b=2" }]
          }
        };
        if (message.type === "CREATE_PROJECT") return failCreate ? { ok: false } : { ok: true, project: { id: "new", name: message.name } };
        if (message.type === "CONFIRM_BATCH_SAVE") return failConfirm ? { ok: false, error: "请求已失效" } : { ok: true };
        if (message.type === "CANCEL_BATCH_SAVE" && failCancel) throw new Error("OFFLINE");
        return { ok: true };
      }
    }
  };
  window.eval(read("picker-ui.js"));
  window.eval(read("save-project-picker.js"));
  await tick();
  return { dom, window, document: window.document, messages, removed,
    shadow: () => window.document.getElementById("lateron-folder-picker")?.shadowRoot };
}

(async () => {
  const app = await boot();
  assert.ok(app.shadow());
  assert.ok(app.document.querySelector("#pickerStatus").hidden);
  assert.ok(app.shadow().querySelector(".lon-root").hasAttribute("data-dark"));
  assert.equal(app.shadow().querySelectorAll(".lon-folder").length, 2);
  assert.match(app.shadow().querySelector(".lon-primary").textContent, /工作/);
  app.document.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await tick();
  assert.equal(app.messages.find((entry) => entry.type === "CONFIRM_BATCH_SAVE").projectId, "work");
  assert.ok(app.messages.every((entry) => entry.batchId === "batch-123"));
  assert.deepEqual(app.removed, [99], "确认后仅关闭选择页自身");
  app.dom.window.close();

  const create = await boot();
  const field = create.shadow().querySelector(".lon-new-input");
  field.value = "新项目";
  field.dispatchEvent(new create.window.Event("input", { bubbles: true }));
  create.shadow().querySelector(".lon-primary").click();
  await tick();
  assert.equal(create.messages.find((entry) => entry.type === "CREATE_PROJECT").name, "新项目");
  assert.equal(create.messages.find((entry) => entry.type === "CONFIRM_BATCH_SAVE").projectId, "new");
  create.dom.window.close();

  const cancel = await boot({ failCancel: true });
  cancel.document.dispatchEvent(new cancel.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await tick();
  assert.ok(cancel.messages.some((entry) => entry.type === "CANCEL_BATCH_SAVE"));
  assert.ok(!cancel.messages.some((entry) => entry.type === "CONFIRM_BATCH_SAVE"));
  assert.deepEqual(cancel.removed, [99], "取消消息失败也能退出选择页");
  cancel.dom.window.close();

  const failed = await boot({ failConfirm: true });
  failed.shadow().querySelector(".lon-primary").click();
  await tick();
  assert.equal(failed.shadow().querySelector(".lon-summary").textContent, "请求已失效");
  assert.equal(failed.shadow().querySelector(".lon-primary").disabled, false);
  assert.equal(failed.removed.length, 0, "确认失败时保留说明和取消入口");
  failed.dom.window.close();

  const failedCreate = await boot({ failCreate: true });
  const newField = failedCreate.shadow().querySelector(".lon-new-input");
  newField.value = "新项目";
  newField.dispatchEvent(new failedCreate.window.Event("input", { bubbles: true }));
  failedCreate.shadow().querySelector(".lon-primary").click();
  await tick();
  assert.ok(!failedCreate.messages.some((entry) => entry.type === "CONFIRM_BATCH_SAVE"));
  assert.equal(failedCreate.shadow().querySelector(".lon-primary").disabled, false);
  failedCreate.dom.window.close();

  const expired = await boot({ expired: true, language: "en" });
  assert.equal(expired.shadow(), undefined);
  assert.match(expired.document.querySelector("#pickerStatus").textContent, /expired/);
  assert.equal(expired.document.querySelector("#closePicker").hidden, false);
  assert.equal(expired.document.documentElement.lang, "en");
  expired.document.querySelector("#closePicker").click();
  await tick();
  assert.deepEqual(expired.removed, [99]);
  expired.dom.window.close();
  console.log("PASS 扩展项目选择页渲染、键盘、新建、确认、取消与失败反馈");
})().catch((error) => { console.error(error); process.exitCode = 1; });
