const sourcePath = require("./helpers/source-path.cjs");
// 静态依赖边界：大型网页脚本按需注入，不进入 service worker 的启动导入链。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { buildSync } = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const { metafile } = buildSync({ entryPoints: [path.join(ROOT, "wxt/entrypoints/background.js")],
  bundle: true, write: false, metafile: true, platform: "browser" });
const sources = Object.keys(metafile.inputs).filter(file => file.startsWith("src/") || file.startsWith("wxt/"));
assert.ok(!sources.some(file => file.startsWith("src/content/")), "网页注入实现不进入后台模块图");
const boot = buildSync({ entryPoints: [path.join(ROOT, "wxt/entrypoints/boot.ts")],
  bundle: true, write: false, metafile: true, platform: "browser" });
assert.deepEqual(Object.keys(boot.metafile.inputs).filter(file => file.startsWith("src/") || file.startsWith("wxt/")).sort(),
  ["src/sidepanel/boot.js", "wxt/entrypoints/boot.ts"], "启动兜底独立构建，不依赖页面、Vue 或业务模块");
assert.ok(!Object.keys(boot.metafile.inputs).some(file => /node_modules\/(?:\.pnpm\/)?(?:@vue[+/]|vue[@/])/.test(file)),
  "独立启动产物不打包 Vue 运行时");
const injected = [];
const startup = [];
const definitions = new Set();
function visit(node, tree) {
  if (ts.isFunctionDeclaration(node) && node.name) definitions.add(node.name.text);
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === "importScripts") {
      startup.push(...node.arguments.filter(ts.isStringLiteral).map(argument => argument.text));
    }
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "executeScript") {
      const options = node.arguments[0];
      const files = options && ts.isObjectLiteralExpression(options)
        ? options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(tree) === "files")
        : null;
      if (files && ts.isArrayLiteralExpression(files.initializer)) {
        injected.push(files.initializer.elements.filter(ts.isStringLiteral).map(element => element.text));
      }
    }
  }
  ts.forEachChild(node, child => visit(child, tree));
}
for (const file of sources) {
  const tree = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true);
  visit(tree, tree);
}
assert.deepEqual(startup, [], "后台模块图不再通过 importScripts 加载依赖");
for (const [file, name] of [["content-metadata.js", "extractPageMetadataForShortcut"],
  ["content-translation.js", "togglePageTranslation"], ["content-folder-picker.js", "showFolderPickerOverlay"]]) {
  assert.ok(injected.some(files => files.includes(file)), `${file} 通过脚本注入入口加载`);
  assert.ok(!startup.includes(file), `${file} 不应由后台冷启动导入`);
  assert.ok(!definitions.has(name), `${name} 的实现应留在网页脚本中`);
  assert.ok(fs.statSync(sourcePath(file)).size > 0, `${file} 注入资源存在`);
}
assert.ok(injected.some(files => files.length === 1 && files[0] === "content-folder-picker.js"),
  "项目选择器通过一个自包含入口按需注入");

// 源码字节数只作记录；依赖边界由 AST 检查，功能正确性由真实后台和页面回归验证。
console.log("PASS background 原生模块依赖图和按需注入边界", sources.length, "modules");
