/**
 * 文档库（Vault）基建：工作区根目录管理 + 路径安全 + 文件树构建。
 *
 * 设计要点：
 * 1. 【安全第一】前端传来的所有路径一律视为「相对工作区根目录的相对路径」，
 *    经 safeResolve() 归一化后必须仍落在根目录内，否则直接拒绝。
 *    额外对已存在的路径做 realpath 复检，防止软链接逃逸（macOS 上 /tmp -> /private/tmp 这类很常见）。
 * 2. 【可移植 id】树节点 id 使用 POSIX 风格相对路径（如 `折子/读书笔记.md`），
 *    根目录本身为空串。这样 id 不含用户主目录等隐私信息，跨平台一致，也天然不可越界。
 * 3. 【状态持久化】根目录写入 <dataDir>/library-workspace.json，重启应用后仍记得上次的库。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveDataDir } from './paths';

/** 视为 Markdown 的扩展名 */
const MD_EXT = new Set(['.md', '.markdown', '.mdx']);
/** 递归建树的最大深度，防止超深目录把进程拖死 */
const MAX_DEPTH = 12;
/** 单次建树最多返回的节点数，防止误选 / 之类的巨型目录 */
const MAX_NODES = 8000;
/** 单个 Markdown 文件的读取上限（5MB），超过视为异常文件 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;
/** 始终跳过的目录名（版本库 / 依赖 / 系统元数据） */
const SKIP_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', '.obsidian', '.trash',
  '.DS_Store', '__pycache__', '.idea', '.vscode',
]);

const WORKSPACE_FILE = 'library-workspace.json';

export interface TreeNode {
  /** 相对工作区根目录的 POSIX 路径，根目录为 '' */
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
  /** 文件专有：字节数与最后修改时间（ISO） */
  size?: number;
  mtime?: string;
}

export interface DirEntryVO {
  name: string;
  /** 绝对路径（仅目录选择器使用，不参与笔记读写） */
  path: string;
}

/** 带 HTTP 状态码的业务错误，交由 index.ts 的全局 errorHandler 转成对应响应 */
export class VaultError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'VaultError';
    this.statusCode = statusCode;
  }
}

// ===================== 工作区根目录 =====================

let rootDir: string | null = null;
let loaded = false;

function workspaceConfigPath(): string {
  return path.join(resolveDataDir(), WORKSPACE_FILE);
}

/** 默认笔记库位置：~/Documents/KnowFlow 文档库（不自动创建，仅作为建议值展示） */
export function defaultVaultDir(): string {
  return path.join(os.homedir(), 'Documents', 'KnowFlow 文档库');
}

/** 从磁盘恢复上次选择的工作区（懒加载，失败静默降级为未初始化） */
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const file = workspaceConfigPath();
    if (!fs.existsSync(file)) return;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { rootDir?: string };
    if (raw.rootDir && fs.existsSync(raw.rootDir) && fs.statSync(raw.rootDir).isDirectory()) {
      rootDir = path.resolve(raw.rootDir);
    }
  } catch {
    /* 配置损坏时按未初始化处理，用户重新选目录即可 */
  }
}

/** 当前工作区根目录，未初始化返回 null */
export function getRootDir(): string | null {
  ensureLoaded();
  return rootDir;
}

/** 取根目录；未初始化时抛 409，提示前端引导用户选目录 */
export function requireRootDir(): string {
  const dir = getRootDir();
  if (!dir) throw new VaultError('尚未选择文档库目录，请先在页面上初始化工作区', 409);
  if (!fs.existsSync(dir)) {
    throw new VaultError(`文档库目录已不存在：${dir}，请重新选择`, 409);
  }
  return dir;
}

/**
 * 设置工作区根目录。
 * @param input 用户给的绝对路径（支持 ~ 开头）
 * @param create 目录不存在时是否自动创建
 */
export function setRootDir(input: string, create = false): string {
  if (!input || typeof input !== 'string' || !input.trim()) {
    throw new VaultError('rootDir 不能为空');
  }
  let target = input.trim();
  if (target === '~' || target.startsWith('~/')) {
    target = path.join(os.homedir(), target.slice(1));
  }
  target = path.resolve(target);

  if (!fs.existsSync(target)) {
    if (!create) throw new VaultError(`目录不存在：${target}`, 404);
    fs.mkdirSync(target, { recursive: true });
  }
  const st = fs.statSync(target);
  if (!st.isDirectory()) throw new VaultError(`该路径不是文件夹：${target}`);

  // 写权限自检：拿不到写权限的话，后面所有创建 / 保存都会失败，不如现在就说清楚
  try {
    fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new VaultError(`目录不可读写，请检查权限：${target}`, 403);
  }

  rootDir = fs.realpathSync(target);
  loaded = true;
  try {
    const file = workspaceConfigPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ rootDir, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch {
    /* 持久化失败不影响本次会话，仅下次启动需重选 */
  }
  return rootDir;
}

// ===================== 路径安全 =====================

/** 非法文件 / 文件夹名：路径分隔符、上跳、控制字符、Windows 保留字符 */
const ILLEGAL_NAME = /[\\/:*?"<>|\u0000-\u001f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 校验用户输入的单级名称（不含路径分隔符） */
export function assertSafeName(name: string, label = '名称'): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new VaultError(`${label}不能为空`);
  if (trimmed.length > 120) throw new VaultError(`${label}过长（最多 120 字符）`);
  if (trimmed === '.' || trimmed === '..') throw new VaultError(`${label}非法`);
  if (ILLEGAL_NAME.test(trimmed)) throw new VaultError(`${label}不能包含 \\ / : * ? " < > | 等字符`);
  if (WINDOWS_RESERVED.test(path.parse(trimmed).name)) throw new VaultError(`${label}使用了系统保留字`);
  if (trimmed.startsWith('.')) throw new VaultError(`${label}不能以 . 开头`);
  return trimmed;
}

/**
 * 把前端传来的相对 id 解析为绝对路径，并保证不越出工作区。
 * 这是所有文件操作的唯一入口，任何绕过它的 fs 调用都是安全漏洞。
 */
export function safeResolve(relativeId: string | undefined | null): string {
  const root = requireRootDir();
  const raw = (relativeId ?? '').trim();

  // 前端可能回传绝对路径（历史数据 / 手工调试），统一折算回相对
  let rel = raw;
  if (path.isAbsolute(rel)) {
    const r = path.relative(root, path.resolve(rel));
    if (r.startsWith('..') || path.isAbsolute(r)) {
      throw new VaultError('路径超出文档库范围，已拒绝', 403);
    }
    rel = r;
  }
  rel = rel.replace(/^[/\\]+/, '');

  const target = path.resolve(root, rel);
  const check = path.relative(root, target);
  if (check.startsWith('..') || path.isAbsolute(check)) {
    throw new VaultError('路径超出文档库范围，已拒绝', 403);
  }

  // 软链接复检：目标若已存在，其真实路径也必须在库内
  if (fs.existsSync(target)) {
    const realTarget = fs.realpathSync(target);
    const realCheck = path.relative(root, realTarget);
    if (realCheck.startsWith('..') || path.isAbsolute(realCheck)) {
      throw new VaultError('路径指向文档库之外（软链接），已拒绝', 403);
    }
  }
  return target;
}

/** 绝对路径 → POSIX 风格相对 id（树节点与前端交互的唯一标识） */
export function toRelId(absolute: string): string {
  const root = requireRootDir();
  const rel = path.relative(root, absolute);
  return rel.split(path.sep).join('/');
}

/** 是否 Markdown 文件 */
export function isMarkdown(name: string): boolean {
  return MD_EXT.has(path.extname(name).toLowerCase());
}

/** 补全 .md 后缀（用户输入「读书笔记」时自动变成「读书笔记.md」） */
export function ensureMdExt(name: string): string {
  return isMarkdown(name) ? name : `${name}.md`;
}

// ===================== 文件树 =====================

/** 文件夹在前、同类按中文习惯排序 */
function compareNode(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

/**
 * 递归读取目录，生成嵌套树。
 * 只保留 Markdown 文件；空文件夹保留（用户可能刚建好准备往里写）。
 */
export async function buildTree(): Promise<TreeNode[]> {
  const root = requireRootDir();
  const counter = { n: 0 };

  async function walk(dir: string, depth: number): Promise<TreeNode[]> {
    if (depth > MAX_DEPTH || counter.n >= MAX_NODES) return [];
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return []; // 权限不足的子目录直接跳过，不影响整棵树
    }

    const nodes: TreeNode[] = [];
    for (const entry of entries) {
      if (counter.n >= MAX_NODES) break;
      const name = entry.name;
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      const abs = path.join(dir, name);

      if (entry.isDirectory()) {
        counter.n += 1;
        nodes.push({
          id: toRelId(abs),
          name,
          type: 'folder',
          children: await walk(abs, depth + 1),
        });
      } else if (entry.isFile() && isMarkdown(name)) {
        counter.n += 1;
        let size: number | undefined;
        let mtime: string | undefined;
        try {
          const st = await fsp.stat(abs);
          size = st.size;
          mtime = st.mtime.toISOString();
        } catch {
          /* stat 失败不影响节点展示 */
        }
        nodes.push({ id: toRelId(abs), name, type: 'file', size, mtime });
      }
      // 软链接与其它类型一律忽略，避免环路与逃逸
    }
    return nodes.sort(compareNode);
  }

  return walk(root, 0);
}

// ===================== 懒加载（展开即取子项） =====================

/**
 * 列出某个文件夹的直接子项（仅一层），供文件树「展开才加载」的懒加载使用。
 * parentRelId 为空串表示根目录。返回与 buildTree 节点同构的数组。
 * 沿用同样的过滤规则：跳过隐藏目录与 SKIP_DIRS，只收 Markdown 文件；
 * 文件夹的 children 先置空数组（前端展开时再按需拉取，避免一次性把上万节点塞进 DOM）。
 */
export async function listChildren(parentRelId: string): Promise<TreeNode[]> {
  const root = requireRootDir()
  const abs = parentRelId ? safeResolve(parentRelId) : root
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new VaultError('文件夹不存在', 404)
  }
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true })
  } catch {
    return [] // 权限不足直接返回空，不影响其它分支
  }

  const nodes: TreeNode[] = []
  for (const entry of entries) {
    const name = entry.name
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
    const entryAbs = path.join(abs, name)
    if (entry.isDirectory()) {
      nodes.push({ id: toRelId(entryAbs), name, type: 'folder', children: [] })
    } else if (entry.isFile() && isMarkdown(name)) {
      let size: number | undefined
      let mtime: string | undefined
      try {
        const st = await fsp.stat(entryAbs)
        size = st.size
        mtime = st.mtime.toISOString()
      } catch {
        /* stat 失败不影响节点展示 */
      }
      nodes.push({ id: toRelId(entryAbs), name, type: 'file', size, mtime })
    }
    // 软链接及其它类型忽略
  }
  return nodes.sort(compareNode)
}

/**
 * 返回库内全部 Markdown 文件的扁平清单（{ id, name }），用于构建双链 / 嵌入解析索引。
 * 不做递归树组装，体积远小于 buildTree，即使数万文件也能快速返回，
 * 让 [[双链]] 点击时能在整库范围内命中、且不必把整棵树都装进前端 DOM。
 * 带总量上限，避免极端大库把响应撑爆。
 */
export async function listAllNotes(): Promise<{ id: string; name: string }[]> {
  const root = requireRootDir()
  const out: { id: string; name: string }[] = []
  const LIMIT = 50000
  async function walk(dir: string): Promise<void> {
    if (out.length >= LIMIT) return
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= LIMIT) return
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        out.push({ id: toRelId(abs), name: entry.name })
      }
    }
  }
  await walk(root)
  return out
}

/**
 * 按文件名（不区分大小写、子串匹配）在全库检索 Markdown 笔记。
 * 返回命中列表（id / name / parentId），上限 200，供前端搜索框使用。
 */
export async function searchNotes(query: string): Promise<{ id: string; name: string; parentId: string }[]> {
  const root = requireRootDir()
  const key = query.trim().toLowerCase()
  if (!key) return []
  const out: { id: string; name: string; parentId: string }[] = []
  const LIMIT = 200
  let scanned = 0
  const SCAN_CAP = 60000
  async function walk(dir: string): Promise<void> {
    if (out.length >= LIMIT || scanned >= SCAN_CAP) return
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= LIMIT || scanned >= SCAN_CAP) return
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        scanned += 1
        if (entry.name.toLowerCase().includes(key)) {
          const rel = toRelId(dir)
          out.push({ id: toRelId(abs), name: entry.name, parentId: rel === '.' ? '' : rel })
        }
      }
    }
  }
  await walk(root)
  return out
}

// ===================== 文件读写 =====================

export async function readNote(id: string): Promise<{ id: string; name: string; content: string; size: number; mtime: string }> {
  const abs = safeResolve(id);
  if (!fs.existsSync(abs)) throw new VaultError('文件不存在，可能已被删除', 404);
  const st = await fsp.stat(abs);
  if (!st.isFile()) throw new VaultError('目标不是文件');
  if (!isMarkdown(abs)) throw new VaultError('仅支持读取 Markdown 文件');
  if (st.size > MAX_FILE_SIZE) throw new VaultError('文件过大（超过 5MB），暂不支持在线编辑', 413);

  const content = await fsp.readFile(abs, 'utf8');
  return {
    id: toRelId(abs),
    name: path.basename(abs),
    content,
    size: st.size,
    mtime: st.mtime.toISOString(),
  };
}

export async function createNote(parentDir: string, fileName: string): Promise<TreeNode> {
  const safeName = ensureMdExt(assertSafeName(fileName, '文件名'));
  const parentAbs = safeResolve(parentDir);
  if (!fs.existsSync(parentAbs) || !fs.statSync(parentAbs).isDirectory()) {
    throw new VaultError('父文件夹不存在', 404);
  }
  const abs = safeResolve(path.join(path.relative(requireRootDir(), parentAbs), safeName));
  if (fs.existsSync(abs)) throw new VaultError(`已存在同名文件：${safeName}`, 409);

  // 新建文件带上一级标题，避免打开时是彻底空白页
  const title = path.basename(safeName, path.extname(safeName));
  await fsp.writeFile(abs, `# ${title}\n\n`, 'utf8');
  const st = await fsp.stat(abs);
  return { id: toRelId(abs), name: safeName, type: 'file', size: st.size, mtime: st.mtime.toISOString() };
}

export async function createFolder(parentDir: string, folderName: string): Promise<TreeNode> {
  const safeName = assertSafeName(folderName, '文件夹名');
  const parentAbs = safeResolve(parentDir);
  if (!fs.existsSync(parentAbs) || !fs.statSync(parentAbs).isDirectory()) {
    throw new VaultError('父文件夹不存在', 404);
  }
  const abs = safeResolve(path.join(path.relative(requireRootDir(), parentAbs), safeName));
  if (fs.existsSync(abs)) throw new VaultError(`已存在同名文件夹：${safeName}`, 409);
  await fsp.mkdir(abs);
  return { id: toRelId(abs), name: safeName, type: 'folder', children: [] };
}

export async function writeNote(filePath: string, content: string): Promise<{ id: string; size: number; mtime: string }> {
  const abs = safeResolve(filePath);
  if (!isMarkdown(abs)) throw new VaultError('仅支持写入 Markdown 文件');
  if (!fs.existsSync(abs)) throw new VaultError('文件不存在，无法保存（可能已在磁盘上被删除）', 404);
  if (!fs.statSync(abs).isFile()) throw new VaultError('目标不是文件');
  if (typeof content !== 'string') throw new VaultError('content 必须是字符串');

  /* 原子写：先写同目录临时文件再 rename，避免应用崩溃 / 断电时把原文件截断成半截。
   * 临时文件必须与目标同目录，跨设备 rename 会失败。 */
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
  try {
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, abs);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
  const st = await fsp.stat(abs);
  return { id: toRelId(abs), size: st.size, mtime: st.mtime.toISOString() };
}

export async function renameEntry(targetPath: string, newName: string): Promise<TreeNode> {
  const abs = safeResolve(targetPath);
  if (!fs.existsSync(abs)) throw new VaultError('目标不存在', 404);
  const isDir = fs.statSync(abs).isDirectory();
  const safeName = isDir
    ? assertSafeName(newName, '文件夹名')
    : ensureMdExt(assertSafeName(newName, '文件名'));

  const parentRel = path.relative(requireRootDir(), path.dirname(abs));
  const nextAbs = safeResolve(path.join(parentRel, safeName));
  if (nextAbs === abs) return { id: toRelId(abs), name: safeName, type: isDir ? 'folder' : 'file' };
  if (fs.existsSync(nextAbs)) throw new VaultError(`已存在同名${isDir ? '文件夹' : '文件'}：${safeName}`, 409);

  await fsp.rename(abs, nextAbs);
  return { id: toRelId(nextAbs), name: safeName, type: isDir ? 'folder' : 'file' };
}

/** 删除文件；文件夹需显式 recursive（前端会二次确认） */
export async function deleteEntry(targetPath: string, recursive = false): Promise<void> {
  const abs = safeResolve(targetPath);
  if (abs === requireRootDir()) throw new VaultError('不能删除文档库根目录', 403);
  if (!fs.existsSync(abs)) throw new VaultError('目标不存在，可能已被删除', 404);

  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    const rest = await fsp.readdir(abs);
    if (rest.length > 0 && !recursive) {
      throw new VaultError('文件夹非空，请确认后再删除', 409);
    }
    await fsp.rm(abs, { recursive: true, force: true });
    return;
  }
  if (!isMarkdown(abs)) throw new VaultError('仅支持删除 Markdown 文件');
  await fsp.unlink(abs);
}

// ===================== 资源检索（双链 / 图片嵌入用） =====================

/**
 * 按文件名（basename，不区分大小写）在全库递归查找一个非 Markdown 资源文件
 * （图片 / PDF 等附件）。用于把 `![[photo.png]]` 这类「只给文件名、不给路径」的
 * 引用解析成库内相对路径。命中返回 POSIX 相对 id，未命中返回 null。
 * 带节点上限，避免超大目录把进程拖死。
 */
export async function findAsset(name: string): Promise<string | null> {
  const root = requireRootDir()
  const key = name.trim().toLowerCase()
  if (!key) return null
  let scanned = 0
  const LIMIT = 8000

  async function walk(dir: string): Promise<string | null> {
    if (scanned >= LIMIT) return null
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return null // 无权限的子目录直接跳过
    }
    for (const entry of entries) {
      if (scanned >= LIMIT) return null
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const hit = await walk(abs)
        if (hit) return hit
      } else if (entry.isFile()) {
        scanned += 1
        if (entry.name.toLowerCase() === key) return toRelId(abs)
      }
    }
    return null
  }

  try {
    return await walk(root)
  } catch {
    return null
  }
}

// ===================== 目录选择器（不受工作区约束） =====================

/**
 * 浏览本机目录，供前端实现「打开本地文件夹」选择器。
 * 说明：桌面端未安装 tauri-plugin-dialog（且窗口加载的是 http://127.0.0.1 远程源，
 * 插件 IPC 需额外的 remote 能力配置），因此改由后端提供目录列举，前端自建选择器。
 * 该接口只读、只返回目录名，不暴露文件内容。
 */
export async function browseDirs(dir?: string): Promise<{
  current: string;
  parent: string | null;
  dirs: DirEntryVO[];
  shortcuts: DirEntryVO[];
}> {
  const home = os.homedir();
  let current = dir && dir.trim() ? dir.trim() : home;
  if (current === '~' || current.startsWith('~/')) current = path.join(home, current.slice(1));
  current = path.resolve(current);

  if (!fs.existsSync(current)) throw new VaultError(`目录不存在：${current}`, 404);
  if (!fs.statSync(current).isDirectory()) throw new VaultError('该路径不是文件夹');

  let dirs: DirEntryVO[] = [];
  try {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .map((e) => ({ name: e.name, path: path.join(current, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
  } catch {
    throw new VaultError('无权限读取该目录', 403);
  }

  const parent = path.dirname(current);
  const shortcuts: DirEntryVO[] = [
    { name: '主目录', path: home },
    { name: '文稿', path: path.join(home, 'Documents') },
    { name: '桌面', path: path.join(home, 'Desktop') },
    { name: '默认文档库', path: defaultVaultDir() },
  ].filter((s, i) => i === 0 || fs.existsSync(s.path) || s.path === defaultVaultDir());

  return { current, parent: parent === current ? null : parent, dirs, shortcuts };
}
