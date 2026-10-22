const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.resolve(__dirname, "..", "url-utils.js"), "utf8");
const context = vm.createContext({ URL, globalThis: {} });
vm.runInContext(source, context, { filename: "url-utils.js" });
const normalize = context.globalThis.LaterOnUrl.normalize;

assert.strictEqual(
  normalize("https://www.Example.com/article/?utm_source=news&b=2&a=1#comments"),
  "https://example.com/article?a=1&b=2"
);
assert.strictEqual(
  normalize("https://example.com/article?a=1&b=2"),
  normalize("https://www.example.com/article/?b=2&a=1")
);

const video = "ss-ufzKALnI";
const expectedVideo = `https://youtube.com/watch?v=${video}`;
for (const url of [
  `https://www.youtube.com/watch?v=${video}&list=WL&index=23&t=15s`,
  `https://youtube.com/watch?list=PLabc&v=${video}&start=100&feature=share`,
  `https://youtu.be/${video}?si=share-code&t=30`,
  `https://m.youtube.com/watch?v=${video}`,
  `https://music.youtube.com/watch?v=${video}`,
  `https://www.youtube.com/shorts/${video}?feature=share`,
  `https://www.youtube.com/embed/${video}?start=30`,
  `https://www.youtube.com/live/${video}?si=share-code`
]) assert.strictEqual(normalize(url), expectedVideo, url);
assert.notStrictEqual(normalize(`https://youtube.com/watch?v=${video}`), normalize("https://youtube.com/watch?v=SS-ufzKALnI"), "视频 ID 大小写必须保留");
assert.notStrictEqual(normalize("https://youtube.com/playlist?list=PLone"), normalize("https://youtube.com/playlist?list=PLtwo"), "独立播放列表不能合并");
assert.notStrictEqual(normalize(`https://example.com/watch?v=${video}&t=15`), normalize(`https://example.com/watch?v=${video}`), "其他网站保留业务参数");
assert.notStrictEqual(normalize(`https://youtube.com.evil.test/watch?v=${video}`), expectedVideo, "仅匹配确切 YouTube 域名");

const route = "https://example.com/app/#/Article/a%2Fb?q=C++&part=2";
assert.strictEqual(normalize(route), "https://example.com/app#/Article/a%2Fb?part=2&q=C++");
assert.strictEqual(normalize(route), normalize("https://www.example.com/app?utm_source=x#/Article/a%2Fb?part=2&q=C++"), "同一路由独立参数换序仍匹配");
for (const [left, right] of [
  ["#/article/1", "#/article/2"], ["#/article/1", "#!/article/1"],
  ["#/article/1", "#article/1"], ["#/Article/1", "#/article/1"],
  ["#/a%2Fb", "#/a/b"], ["#/a%252Fb", "#/a%2Fb"],
  ["#/article/1", "#/article/1/"], ["#/search?q=C++", "#/search?q=C%2B%2B"],
  ["#/search?q=C++", "#/search?q=C%20%20"],
  ["#/article/1?view=a", "#/article/1?view=b"],
  ["#/article/1?tag=a&tag=b", "#/article/1?tag=b&tag=a"],
  ["#/article/1#intro", "#/article/1#end"]
]) assert.notStrictEqual(normalize(`https://example.com/${left}`), normalize(`https://example.com/${right}`), `${left} 和 ${right} 应保留区别`);
for (const hash of ["#intro", "#%E7%AB%A0%E8%8A%82", "#:~:text=hello", "#", ""])
  assert.strictEqual(normalize(`https://example.com/article${hash}`), "https://example.com/article", "普通锚点不产生重复收藏");
assert.strictEqual(normalize("https://example.com/#!/article?b=2&a=1&a=3#section"), "https://example.com/#!/article?a=1&a=3&b=2#section");
assert.notStrictEqual(normalize("https://example.com/?reference=one"), normalize("https://example.com/?reference=two"), "业务参数不能因 ref 前缀被误删");
assert.notStrictEqual(normalize("https://example.com/?spmode=one"), normalize("https://example.com/?spmode=two"));
assert.strictEqual(normalize("https://example.com/?utm_source=x&ref=mail&fbclid=abc&gclid=x&mc_cid=x&spm=x&igshid=x&a=1"), "https://example.com/?a=1");
const suspended = `chrome-extension://noogafoofpebimajpfpamcfhoaifemoa/suspended.html#ttl=Test&pos=0&uri=${route}`;
assert.strictEqual(normalize(suspended), normalize(route), "冻结占位网址与原路由共用身份");
for (const value of [route, suspended, "https://example.com/#!/a?z=%23%25&x=1#keep", expectedVideo])
  assert.strictEqual(normalize(normalize(value)), normalize(value), "规范化必须幂等");

console.log("PASS shared URL identity: hash routes, anchors, query boundaries, Suspender and YouTube");
