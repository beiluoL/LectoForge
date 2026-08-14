// X6 组件上下文（provide/inject 键）。
//
// 设计约束（spec §4.1）：graph 实例严禁模块级单例，必须经 composable 返回。
// 顶层组件（playground）通过 provide 把 graph 的 shallowRef 与撤销/重做状态
// 下发给工具栏 / 属性面板等子组件，子组件只消费、不持有，避免多处共享副作用。
import type { InjectionKey, Ref } from 'vue'
import type { Graph } from '@antv/x6'

export interface X6Context {
  /** graph 实例的响应式引用（shallowRef，可能随 onMounted 从 null 变为实例） */
  graph: Ref<Graph | null>
  /** 画布是否就绪（onMounted 后 true） */
  graphReady: Ref<boolean>
  /** 撤销可用（驱动顶栏置灰） */
  canUndo: Ref<boolean>
  /** 重做可用 */
  canRedo: Ref<boolean>
  /** 当前历史栈步数 */
  historySize: Ref<number>
  /** 画布背景色（绘图面板「背景」控件驱动，绑定到画布容器 style） */
  canvasBg: Ref<string>
}

export const X6_CTX_KEY: InjectionKey<X6Context> = Symbol('x6-ctx')
