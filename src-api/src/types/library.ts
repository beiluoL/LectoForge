/* 文档库（Obsidian 式 Markdown 笔记）领域类型
 *
 * 树节点 / 目录项等结构复用 lib/vault.ts 的 TreeNode、DirEntryVO，
 * 这里只补充路由层特有的视图对象，避免与 vault 的定义重复。
 */

/** GET /library/workspace 的返回体 */
export interface WorkspaceStatusVO {
  rootDir: string | null;
  /** 目录当前确实存在于磁盘上才为 true（见 libraryService 注释） */
  ready: boolean;
  defaultDir: string;
}

/** POST /library/workspace/init 的入参与返回体 */
export interface WorkspaceInitDTO {
  rootDir?: string;
  create?: boolean;
}
export interface WorkspaceInitVO {
  rootDir: string;
  ready: true;
}

/** 资源定位结果：service 只解析出「磁盘绝对路径 + MIME」，流式下发由 controller 负责 */
export interface AssetResolution {
  absPath: string;
  mime: string;
}

/** GET /library/notes/todos 扫描出的单条未办待办项（功能 A：文档库 → 任务清单） */
export interface LibraryTodoItem {
  /** 笔记的相对路径（POSIX id），可用于深链回跳 */
  filePath: string
  /** 文件名（含 .md），展示用 */
  fileName: string
  /** 提取出的待办正文 */
  taskContent: string
  /** 在文件中的行号（从 1 开始），便于回跳定位 */
  lineNumber: number
}

/** 各写操作的入参 */
export interface CreateNoteDTO {
  parentDir?: string;
  fileName?: string;
}
export interface CreateFolderDTO {
  parentDir?: string;
  folderName?: string;
}
export interface UpdateNoteDTO {
  filePath?: string;
  content?: string;
}
export interface RenameEntryDTO {
  filePath?: string;
  newName?: string;
}
export interface DeleteEntryDTO {
  filePath?: string;
  recursive?: boolean;
}
