// Run from any directory: node spec/build.mjs
// Rebuild the inherited Doudou reference page; PA-RTOS's contract is separate.
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const dir = await fs.realpath(path.dirname(fileURLToPath(import.meta.url)));
const pageFile = path.join(dir, "index.html");
const START = "<!-- spec-build:start -->", END = "<!-- spec-build:end -->";
const [page, yamlText, parser, markdown] = await Promise.all([
  fs.readFile(pageFile, "utf8"),
  fs.readFile(path.join(dir, "spec.yaml"), "utf8"),
  fs.readFile(path.join(dir, "vendor/js-yaml.min.js"), "utf8"),
  fs.readFile(path.join(dir, "vendor/markdown.js"), "utf8"),
]);
const context = vm.createContext({});
vm.runInContext(parser, context, { timeout: 1000 });
const spec = context.jsyaml.load(yamlText, { schema: context.jsyaml.CORE_SCHEMA });
const validation = page.match(/\/\* spec-validation:start \*\/([\s\S]*?)\/\* spec-validation:end \*\//);
if (!validation) throw new Error("index.html 缺少共享校验代码标记");
vm.runInContext(validation[1], context, { timeout: 1000 });
const errors = context.validateSpec(spec);
if (errors.length) throw new Error("spec.yaml 校验失败：\n" + errors.join("\n"));

// Read only referenced text files; cloud modules are never evaluated.
const promptDir = path.join(dir, "prompts") + path.sep;
const files = [...new Set(spec.prompts.map(prompt => prompt.source.file))];
async function readSource(file) {
  const resolved = path.resolve(dir, file);
  if (!resolved.startsWith(promptDir) || path.extname(resolved) !== ".md") throw new Error(`提示词来源必须在 prompts/ 目录内：${file}`);
  const full = await fs.realpath(resolved);
  if (full !== resolved) throw new Error(`提示词来源不能是符号链接：${file}`);
  return (await fs.readFile(full, "utf8")).replace(/\r\n/g, "\n");
}
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readSource(file)])));
spec.prompts = spec.prompts.map(prompt => {
  const { source, ...product } = prompt;
  const raw = sources[source.file];
  // The system prompt's author notes above its separator are not part of the prompt.
  const text = (source.file === "prompts/openclaw/system-prompt.md" ? raw.split(/^---\s*$/m).at(-1) : raw).trim();
  if (!text) throw new Error(`提示词 ${prompt.id} 为空`);
  return { ...product, text };
});

// The inherited page describes the source product's connector catalog.
// PA-RTOS does not ship that product registry; validate the reference itself.

// Inert JSON and escaped Markdown keep prompt text from creating scripts or requests.
const json = value => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const generated = `${START}\n<!-- Generated locally by build.mjs. -->\n<script type="application/json" id="spec-data">${json(spec)}</script>\n<script id="markdown-renderer">\n${markdown.trim().replace(/<\/script/gi, "<\\/script")}\n</script>\n${END}`;
const start = page.indexOf(START), end = page.indexOf(END);
if (start < 0 || end < start || page.indexOf(START, start + START.length) >= 0 || page.indexOf(END, end + END.length) >= 0) throw new Error("index.html 的生成区标记缺失或重复");
const output = page.slice(0, start) + generated + page.slice(end + END.length);
if (output !== page) await fs.writeFile(pageFile, output);
console.log(`已构建 spec/index.html：${spec.domains.length} 个域、${spec.connectors.items.length} 个连接器、${spec.prompts.length} 条提示词`);
