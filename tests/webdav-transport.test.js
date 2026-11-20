const { strict: assert } = require("node:assert");
const { test } = require("node:test");
const { gzipSync } = require("node:zlib");
const { createWebdav } = require("./helpers/load-module.cjs")("src/backup/webdav-transport.ts");

test("WebDAV PUT sends the caller's media type and preserves the payload", async () => {
  const requests = [];
  const dav = createWebdav({ endpoint: "https://dav.example.test/", username: "user", password: "secret" }, {
    async start() {},
    async downloaded() {},
    remaining: () => Infinity
  }, async (url, request) => {
    requests.push({ path: new URL(url).pathname, method: request.method, type: new Headers(request.headers).get("content-type"), body: Buffer.from(request.body) });
    return new Response(null, { status: 201 });
  });
  const head = Buffer.from('{"seq":1}');
  const snapshot = gzipSync(Buffer.from('{"items":[]}'));
  await dav.put(["head-device.json"], head, "application/json");
  await dav.put(["snapshot-device-1.json.gz"], snapshot, "application/gzip");
  assert.deepEqual(requests, [
    { path: "/head-device.json", method: "PUT", type: "application/json", body: head },
    { path: "/snapshot-device-1.json.gz", method: "PUT", type: "application/gzip", body: snapshot }
  ]);
});
