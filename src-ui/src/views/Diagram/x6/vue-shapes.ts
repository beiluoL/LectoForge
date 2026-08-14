// 用 @antv/x6-vue-shape 注册「Vue 组件节点」shape。
// 迁移自现有 CustomNode.vue：后续把节点的富文本 / 四向锚点 / resize 都装进这类 Vue shape。
import { register } from '@antv/x6-vue-shape'
import TestVueNode from './nodes/TestVueNode.vue'

let registered = false

/** 幂等注册所有 Vue shape（多次调用安全）。 */
export function registerVueShapes(): void {
  if (registered) return
  register({
    shape: 'test-vue-node',
    width: 140,
    height: 44,
    component: TestVueNode,
    attrs: {
      // body 为 X6 默认矩形底（选中框 / 端口锚点依附于此），文字由 Vue 组件渲染。
      body: { fill: '#e6f4ff', stroke: '#1677ff', strokeWidth: 1.5, rx: 6, ry: 6 },
    },
    ports: {
      groups: {
        top: { position: 'top', attrs: { circle: { r: 4, magnet: true, fill: '#1677ff', stroke: '#fff' } } },
        right: { position: 'right', attrs: { circle: { r: 4, magnet: true, fill: '#1677ff', stroke: '#fff' } } },
        bottom: { position: 'bottom', attrs: { circle: { r: 4, magnet: true, fill: '#1677ff', stroke: '#fff' } } },
        left: { position: 'left', attrs: { circle: { r: 4, magnet: true, fill: '#1677ff', stroke: '#fff' } } },
      },
      items: [
        { id: 'top', group: 'top' },
        { id: 'right', group: 'right' },
        { id: 'bottom', group: 'bottom' },
        { id: 'left', group: 'left' },
      ],
    },
  })
  registered = true
}
