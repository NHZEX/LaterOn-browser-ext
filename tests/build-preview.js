// 预览必须自包含：快照目录不能解析仓库相对路径，因此内联实际 WXT 注入产物。
// 与网页收藏使用同一个单文件入口，重新生成即可跟随实现更新。
// 用法：node tests/build-preview.js
const fs = require("node:fs");
const path = require("node:path");
const source = require("./helpers/read-runtime.cjs")("content-folder-picker.js");
const template = fs.readFileSync(path.join(__dirname, "picker-preview.template.html"), "utf8");
const placeholder = "<!--INLINE_OVERLAY_IMPLEMENTATION-->";
if (!template.includes(placeholder)) throw new Error("模板里缺少浮层实现占位符");
const banner = "// 本文件由 tests/build-preview.js 自动生成，请勿直接编辑。";
const implementation = `<script>\n${banner}\nwindow.previewInjectPicker = () => {\n${source}\n};\n</script>`;
const output = path.join(__dirname, "picker-preview.html");
fs.writeFileSync(output, template.replace(placeholder, implementation));
console.log(`已生成 ${path.relative(process.cwd(), output)}（内联实际 WXT 项目选择入口）`);
