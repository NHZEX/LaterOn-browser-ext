const sourcePath = require("./helpers/source-path.cjs");
// 静态依赖边界：大型网页脚本按需注入，不进入 service worker 的启动导入链。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const background = fs.readFileSync(sourcePath("background.js"), "utf8");
const tree = ts.createSourceFile("background.js", background, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const injected = [];
const startup = [];
const definitions = new Set();
function visit(node) {
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
  ts.forEachChild(node, visit);
}
visit(tree);
for (const [file, name] of [["content-metadata.js", "extractPageMetadataForShortcut"],
  ["content-translation.js", "togglePageTranslation"], ["content-folder-picker.js", "showFolderPickerOverlay"]]) {
  assert.ok(injected.some(files => files.includes(file)), `${file} 通过脚本注入入口加载`);
  assert.ok(!startup.includes(file), `${file} 不应由后台冷启动导入`);
  assert.ok(!definitions.has(name), `${name} 的实现应留在网页脚本中`);
  assert.ok(fs.statSync(sourcePath(file)).size > 0, `${file} 注入资源存在`);
}
assert.ok(injected.some(files => files[0] === "picker-ui.js" && files[1] === "content-folder-picker.js"),
  "项目选择器应先加载共享 UI 再加载入口");

// 源码字节数只作记录；依赖边界由 AST 检查，功能正确性由真实后台和页面回归验证。
console.log("PASS background 按需注入边界，冷启动脚本", Buffer.byteLength(background), "bytes");
