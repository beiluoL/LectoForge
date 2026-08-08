/**
 * useMemoryPalaceStore —— 记忆宫殿 Pinia Store
 *
 * 设计要点
 * - palaces / activePalaceId / lociList / currentTourIndex / masterLevels
 * - actions: fetchLoci / updateLociPosition / setMasterLevel / setCurrentTourIndex / resetTour
 * - 持久化：lociList + currentTourIndex + masterLevels（用 pinia-plugin-persistedstate）
 *
 * 组件中正确使用（避免丢失响应式）
 * ```ts
 * import { storeToRefs } from 'pinia'
 * import { useMemoryPalaceStore } from '@/store/memory-palace-store'
 *
 * const store = useMemoryPalaceStore()
 * // 解构 state 用 storeToRefs（保留响应式），actions 直接拿
 * const { lociList, currentTourIndex, masterLevels } = storeToRefs(store)
 * const { fetchLoci, updateLociPosition, setMasterLevel } = store
 * ```
 */
import { defineStore } from 'pinia'
import { listLoci, updateLoci } from '@/api/workbench'
import type { WbPalace, WbPalaceLoci } from '@/api/types'

/** 演示宫殿特殊 id（前端纯本地数据，不落库） */
export const MOCK_PALACE_ID = -1

/** 「并发编程公寓」演示位点：8 个并发编程核心概念，坐标错开，含夸张联想图像 */
const MOCK_LOCI: Omit<WbPalaceLoci, 'palaceId'>[] = [
  { id: -1, userId: 0, name: '玄关鞋柜', knowledgePoint: '进程 vs 线程：进程是资源分配的基本单位，线程是 CPU 调度的基本单位，一个进程可含多个线程并共享内存', imageHint: '一只巨大的货架（进程）上挂着好几只敏捷的小猴子（线程）一起搬同一批货', icon: 'server', posX: 15, posY: 20, sortOrder: 1 },
  { id: -2, userId: 0, name: '客厅沙发', knowledgePoint: '并发 vs 并行：并发是同一时段交替处理多任务，并行是同一时刻同时执行多任务', imageHint: '一个人左右手同时耍两球（并发）vs 两人在两台机器上各耍一球（并行）', icon: 'git-compare', posX: 40, posY: 15, sortOrder: 2 },
  { id: -3, userId: 0, name: '厨房灶台', knowledgePoint: '锁与互斥：用锁保证同一时间只有一个线程进入临界区，避免竞态条件', imageHint: '一扇只挂一把钥匙的卫生间门，谁拿钥匙谁进，其他人门外排队', icon: 'lock', posX: 68, posY: 22, sortOrder: 3 },
  { id: -4, userId: 0, name: '卧室床头', knowledgePoint: '死锁：互斥、占有且等待、不可剥夺、循环等待四个条件同时成立时发生', imageHint: '两只人偶各拿一根筷子互相等对方先放下，僵在原地谁也走不了', icon: 'link-2', posX: 88, posY: 35, sortOrder: 4 },
  { id: -5, userId: 0, name: '书房书桌', knowledgePoint: 'volatile：保证变量在多线程间的可见性，但不保证复合操作的原子性', imageHint: '一块大黑板，谁写一笔所有人立刻看到，但两人同时擦写会糊成一团', icon: 'eye', posX: 20, posY: 50, sortOrder: 5 },
  { id: -6, userId: 0, name: '阳台花架', knowledgePoint: 'CAS（Compare And Swap）：无锁原子操作，比较旧值相等才更新，失败则重试', imageHint: '自动售货机核对你投的币和标价一致才吐货，不一致就退币让你重投', icon: 'repeat', posX: 50, posY: 55, sortOrder: 6 },
  { id: -7, userId: 0, name: '卫生间', knowledgePoint: '线程池：预先创建一组可复用线程，避免频繁创建/销毁开销，有核心与最大线程数', imageHint: '一排随时待命的出租车，客人（任务）来了直接上车走，不用现造一辆车', icon: 'users', posX: 78, posY: 60, sortOrder: 7 },
  { id: -8, userId: 0, name: '走廊尽头', knowledgePoint: 'ThreadLocal：线程私有变量，每个线程持有独立副本，互不干扰', imageHint: '每个人手腕上专属的手环，存自己的东西，别人看不见也拿不到', icon: 'user-round', posX: 45, posY: 85, sortOrder: 8 },
]

/** lociId -> 0..5 熟练度（SRS 简化版；持久化在 localStorage） */
export type MasterLevelMap = Record<number, number>

export interface MemoryPalaceState {
  palaces: WbPalace[]
  activePalaceId: number | null
  lociList: WbPalaceLoci[]
  currentTourIndex: number
  masterLevels: MasterLevelMap
}

export const useMemoryPalaceStore = defineStore('memoryPalace', {
  state: (): MemoryPalaceState => ({
    palaces: [],
    activePalaceId: null,
    lociList: [],
    currentTourIndex: 0,
    masterLevels: {},
  }),

  getters: {
    /** 按 sortOrder 升序的位点（漫游顺序） */
    sortedLoci(state): WbPalaceLoci[] {
      return [...state.lociList].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    },
    /** 当前漫游指向的位点 */
    currentLoci(): WbPalaceLoci | null {
      const sorted = this.sortedLoci
      return sorted[this.currentTourIndex] || null
    },
    /** 熟练度 < 3 的位点（今日待复习清单；本地近似） */
    reviewDueLoci(state): WbPalaceLoci[] {
      return state.lociList.filter((l) => (state.masterLevels[l.id] ?? 0) < 3)
    },
  },

  actions: {
    /** 拉取指定宫殿的全部位点，并重置漫游指针；用后端 masteredLevel 初始化本地熟练度（不覆盖已有进度） */
    async fetchLoci(palaceId: number) {
      this.activePalaceId = palaceId
      const list = await listLoci(palaceId)
      this.lociList = list
      list.forEach((l) => {
        if (l.masteredLevel !== undefined && this.masterLevels[l.id] === undefined) {
          this.masterLevels[l.id] = l.masteredLevel
        }
      })
      this.currentTourIndex = 0
    },

    /**
     * 拖拽结束后保存位点坐标：先乐观更新本地，再调后端 PUT /loci/:id，
     * 失败时回滚到原坐标并 rethrow 让 UI 提示错误。
     */
    async updateLociPosition(lociId: number, x: number, y: number) {
      const target = this.lociList.find((l) => l.id === lociId)
      const before = target ? { posX: target.posX, posY: target.posY } : null
      if (target) {
        target.posX = x
        target.posY = y
      }
      if (!target) return
      try {
        await updateLoci(lociId, {
          palaceId: target.palaceId,
          name: target.name,
          knowledgePoint: target.knowledgePoint,
          imageHint: target.imageHint,
          icon: target.icon,
          categoryId: target.categoryId,
          posX: x,
          posY: y,
          sortOrder: target.sortOrder,
        })
      } catch (e) {
        if (before) {
          target.posX = before.posX
          target.posY = before.posY
        }
        throw e
      }
    },

    /** 设置位点的熟练度（0-5，越高越熟） */
    setMasterLevel(lociId: number, level: number) {
      this.masterLevels[lociId] = Math.max(0, Math.min(5, Math.round(level)))
    },

    /** 漫游时设置当前指针（自动夹紧到合法区间） */
    setCurrentTourIndex(i: number) {
      const sorted = this.sortedLoci
      if (!sorted.length) {
        this.currentTourIndex = 0
        return
      }
      this.currentTourIndex = Math.max(0, Math.min(sorted.length - 1, i))
    },

    /** 重置漫游指针到第一位 */
    resetTour() {
      this.currentTourIndex = 0
    },

    /**
     * 复习打分：本地记熟练度 + 真实宫殿（activePalaceId>0）落库 persisted；
     * 演示宫殿（id<0）只更新本地，不触发后端。
     */
    async gradeLoci(lociId: number, level: number) {
      this.setMasterLevel(lociId, level)
      if (this.activePalaceId && this.activePalaceId > 0) {
        const l = this.lociList.find((x) => x.id === lociId)
        if (l) {
          try {
            await updateLoci(lociId, {
              palaceId: l.palaceId,
              name: l.name,
              knowledgePoint: l.knowledgePoint,
              imageHint: l.imageHint,
              icon: l.icon,
              posX: l.posX,
              posY: l.posY,
              sortOrder: l.sortOrder,
              categoryId: l.categoryId,
              masteredLevel: this.masterLevels[lociId] ?? level,
              lastReviewedAt: new Date().toISOString(),
            })
          } catch {
            /* 本地已记录，后端落库失败静默处理 */
          }
        }
      }
    },

    /** 灌入「并发编程公寓」演示数据（纯前端，不落库）。用于无后端真实数据时快速体验记忆宫殿。 */
    initMockData(palaceId: number = MOCK_PALACE_ID) {
      this.activePalaceId = palaceId
      this.lociList = MOCK_LOCI.map((l) => ({ ...l, palaceId }))
      this.currentTourIndex = 0
    },
  },

  // pinia-plugin-persistedstate v4 配置：仅持久化 lociList + currentTourIndex + masterLevels
  // palaces / activePalaceId 走后端，不在本地缓存以避免数据漂移
  //
  // ⚠️ 修正一个被 `as any` 掩盖的真实缺陷：v4 已把 v3 的 `paths` 更名为 `pick`/`omit`，
  // 原先写 `paths` 等于没做任何字段过滤，整个 store（含 palaces）都会被写进 localStorage，
  // 与上面注释声明的意图相反。类型错误本应在此暴露，却被 `as any` 压住了。
  // 本项目其余四个 store（app / inbox / note / …）用的都是 `pick`，此处统一。
  persist: {
    key: 'kf:memory-palace',
    storage: localStorage,
    pick: ['lociList', 'currentTourIndex', 'masterLevels'],
  },
})