const assert = require("node:assert/strict");
const { itemLinkText, copyItemLink } = require("../src/collection/item-link.ts");

const item = Object.freeze({ title: "Guide [draft] \\ notes\n*next*", url: "https://example.test/a_(draft)?q=%E4%B8%AD&x=1#section" });
assert.equal(itemLinkText(item, "url"), item.url, "Plain URLs retain query parameters, escapes, and fragments");
assert.equal(itemLinkText(item, "markdown"), "[Guide \\[draft\\] \\\\ notes \\*next\\*](https://example.test/a_%28draft%29?q=%E4%B8%AD&x=1#section)");
assert.equal(itemLinkText({ title: "", url: "https://example.test/" }, "markdown"), "[https://example.test/](https://example.test/)");
assert.equal(itemLinkText({ title: "Space", url: "https://example.test/a b<c>" }, "markdown"), "[Space](https://example.test/a%20b%3Cc%3E)");

async function main() {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const written = [];
  try {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { written.push(text); } } });
    assert.equal(await copyItemLink(item, "url"), true);
    assert.deepEqual(written, [item.url]);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Denied"); } } });
    assert.equal(await copyItemLink(item, "markdown"), false, "Clipboard denial is recoverable");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    assert.equal(await copyItemLink(item, "url"), false, "Unavailable clipboard is recoverable");
    assert.equal(await copyItemLink({ title: "Missing", url: "" }, "url"), false);
  } finally {
    if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
    else delete navigator.clipboard;
  }
  console.log("PASS item links: exact URLs, Markdown escaping, clipboard writes and failures");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
