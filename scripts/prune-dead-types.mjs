#!/usr/bin/env node
/**
 * 死类型清理器 —— 针对 src-ui/src/api/types.ts。
 *
 * 背景：该文件有 158 个导出，实际被业务代码引用的只有 22 个。剩下 136 个是
 * 从 Web 端整体搬运时带过来的（Agent / Challenge / StudyGroup / Community / Admin
 * 等整片未落地的域）。它们不影响运行时体积（纯类型，编译后擦除），但严重污染
 * IDE 自动补全与全局搜索，是重构时的主要噪声源。
 *
 * ## 算法：可达性分析，不是简单的「没被引用就删」
 * 直接删「未被外部引用」的类型会误删嵌套依赖——比如 WbNote 被外部用了，
 * 而它的字段类型 WbNoteExtra 只在 types.ts 内部出现，简单规则会把后者删掉，编译立刻崩。
 * 因此这里：
 *   1. 扫描 src-ui/src（排除 types.ts 自身）得到「根集合」= 被外部直接引用的类型名；
 *   2. 从根集合出发做 BFS，沿「类型块内部提到的其它类型名」这条边扩散；
 *   3. 可达的全部保留，不可达的整块删除。
 *
 * ## 用法
 *   node scripts/prune-dead-types.mjs           # 仅报告，不改文件（默认，安全）
 *   node scripts/prune-dead-types.mjs --apply   # 实际写回，并生成 .bak 备份
 *
 * 改完务必执行：cd src-ui && ./node_modules/.bin/vue-tsc --noEmit
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES_FILE = path.join(ROOT, 'src-ui/src/api/types.ts');
const SCAN_DIR = path.join(ROOT, 'src-ui/src');
const APPLY = process.argv.includes('--apply');

/* 复用 src-ui 本地安装的 typescript（禁止 npx，见项目构建纪律）。
 * 手写正则切分块在真实文件上不可靠——嵌套对象类型、注释里的花括号、
 * 联合类型跨行都会让括号配对跑飞（实测只能识别出 158 个里的 20 个）。
 * 用编译器自己的 AST 才能拿到每个声明精确的起止偏移。 */
const require = createRequire(path.join(ROOT, 'src-ui/package.json'));
/** @type {import('typescript')} */
const ts = require('typescript');

/* ---------- 1. 用 AST 切分顶层导出声明 ---------- */
const source = fs.readFileSync(TYPES_FILE, 'utf8');
const sf = ts.createSourceFile(TYPES_FILE, source, ts.ScriptTarget.Latest, true);

/** @type {{name:string, pos:number, end:number, text:string}[]} */
const blocks = [];

for (const st of sf.statements) {
  const isExported = ts.canHaveModifiers(st)
    && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!isExported) continue;

  /** @type {string|undefined} */
  let name;
  if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)
      || ts.isEnumDeclaration(st) || ts.isClassDeclaration(st)) {
    name = st.name?.text;
  } else if (ts.isVariableStatement(st)) {
    const d = st.declarationList.declarations[0];
    if (d && ts.isIdentifier(d.name)) name = d.name.text;
  }
  if (!name) continue;

  // getFullStart() 会把前导注释（JSDoc）一并算进来，删除时不会留下无主注释
  blocks.push({ name, pos: st.getFullStart(), end: st.getEnd(), text: source.slice(st.getFullStart(), st.getEnd()) });
}

/* ---------- 2. 扫描外部引用，得到根集合 ---------- */
/** 递归收集待扫描文件 */
function collect(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      collect(p, acc);
    } else if (/\.(ts|vue|tsx)$/.test(e.name) && p !== TYPES_FILE) {
      acc.push(p);
    }
  }
  return acc;
}

const externalSource = collect(SCAN_DIR).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// 二次转发检查：若存在 `export * from './types'`，任何导出都可能被外部间接使用
if (/export\s+\*\s+from\s+['"].*\/types['"]/.test(externalSource)) {
  console.error('❌ 检测到 `export * from "./types"` 转发，静态分析不可靠，已中止。');
  process.exit(1);
}

const roots = new Set();
for (const b of blocks) {
  // \b 边界防止 WbNote 命中 WbNotePayload
  if (new RegExp(`\\b${b.name}\\b`).test(externalSource)) roots.add(b.name);
}

/* ---------- 3. 可达性 BFS ---------- */
const byName = new Map(blocks.map((b) => [b.name, b]));
const alive = new Set();
const queue = [...roots];

while (queue.length) {
  const name = queue.pop();
  if (alive.has(name)) continue;
  alive.add(name);
  const blk = byName.get(name);
  if (!blk) continue;
  // 该块正文里提到的其它导出类型 → 必须一起保留
  for (const other of byName.keys()) {
    if (other === name || alive.has(other)) continue;
    if (new RegExp(`\\b${other}\\b`).test(blk.text)) queue.push(other);
  }
}

const dead = blocks.filter((b) => !alive.has(b.name));

/* ---------- 4. 报告 / 写回 ---------- */
console.log(`总导出        ${blocks.length}`);
console.log(`外部直接引用  ${roots.size}`);
console.log(`可达保留      ${alive.size}  （含被存活类型嵌套引用的 ${alive.size - roots.size} 个）`);
console.log(`可删除        ${dead.length}`);
console.log('');

if (!dead.length) {
  console.log('✅ 没有死类型，无需处理。');
  process.exit(0);
}

console.log('将被删除的类型：');
console.log(dead.map((d) => d.name).join(', '));
console.log('');

if (!APPLY) {
  console.log('ℹ️  这是预演（dry-run）。确认无误后加 --apply 实际写回。');
  process.exit(0);
}

/* 从后往前删，保证前面声明的偏移量不被影响 */
const ordered = [...dead].sort((a, b) => b.pos - a.pos);
let output = source;
for (const d of ordered) output = output.slice(0, d.pos) + output.slice(d.end);
// 压掉删除后残留的连续空行（3 行以上压成 2 行）
output = output.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(`${TYPES_FILE}.bak`, source, 'utf8');
fs.writeFileSync(TYPES_FILE, output, 'utf8');

console.log(`✅ 已写回 ${path.relative(ROOT, TYPES_FILE)}`);
console.log(`   备份     ${path.relative(ROOT, TYPES_FILE)}.bak`);
console.log(`   行数     ${source.split('\n').length} → ${output.split('\n').length}`);
console.log('');
console.log('⚠️  下一步必须验证：cd src-ui && ./node_modules/.bin/vue-tsc --noEmit');
console.log('   如有报错，恢复：mv src-ui/src/api/types.ts.bak src-ui/src/api/types.ts');
