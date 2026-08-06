/**
 * 文件树的上下文注入契约。
 *
 * 递归组件（FileTreeNode）需要把「选中」「右键菜单」这类交互回传给面板容器（FileTree），
 * 若逐层 emit，中间每一级都要写一遍透传样板；这里用 provide / inject 让任意深度的
 * 节点直接拿到容器提供的处理函数。
 *
 * 单独成文件是为了打断循环引用：FileTree.vue 引入 FileTreeNode.vue，
 * 若注入键定义在 FileTree.vue 里，FileTreeNode.vue 反向引入就会成环。
 */
import type { InjectionKey } from 'vue'

import type { LibTreeNode } from '@/api/library'

export interface TreeContext {
  /** 点击节点：文件则打开，文件夹则折叠/展开 */
  select: (node: LibTreeNode) => void
  /** 打开上下文菜单（右键或「更多」按钮） */
  openMenu: (event: MouseEvent, node: LibTreeNode) => void
  /** 在指定文件夹下新建笔记 */
  quickNewNote: (parentDir: string) => void
}

export const TREE_CTX: InjectionKey<TreeContext> = Symbol('doc-library-tree-ctx')
