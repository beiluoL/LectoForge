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

/**
 * ⚠️ 已移除：MOCK_PALACE_ID / MOCK_LOCI / initMockData（2026-08-08）
 *
 * 原先这里硬编码了一份「并发编程公寓」演示位点（8 条），通过特殊 id = -1 走纯前端
 * 分支渲染。问题是它假到底：拖拽不落库、AI 扩写只进内存、复习进度不计入 SM-2 统计，
 * 首页 /api/dashboard/stats 的 palaceLoci 永远看不到它们。
 *
 * 现已下沉为**真实数据库行**——由 src-api/src/db/index.ts 的 seedIfEmpty(wbPalace, …)
 * 幂等播种「✨ 演示宫殿 - 并发编程公寓」+ 8 个位点。前端这一层不再持有任何副本，
 * 全部走 listPalaces() / listLoci() 真实接口。
 */

/** lociId -> 0..5 熟练度（SRS 简化版；持久化在 localStorage） */
export type MasterLevelMap = Record<number, number>

export interface MemoryPalaceState {
  palaces: WbPalace[]
  activePalaceId: number | null
  lociList: WbPalaceLoci[]
  currentTourIndex: number
  masterLevels: MasterLevelMap
  /** 位点拉取中（渲染骨架屏用）；不持久化，每次进页面重新判定 */
  lociLoading: boolean
}

export const useMemoryPalaceStore = defineStore('memoryPalace', {
  state: (): MemoryPalaceState => ({
    palaces: [],
    activePalaceId: null,
    lociList: [],
    currentTourIndex: 0,
    masterLevels: {},
    lociLoading: false,
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
    /**
     * 拉取指定宫殿的全部位点，并重置漫游指针；用后端 masteredLevel 初始化本地熟练度（不覆盖已有进度）。
     *
     * 切换宫殿时先清空 lociList：持久化的是上一个宫殿的位点，不清会先闪一帧旧数据，
     * 视觉上等同于「假数据」。清空 + lociLoading=true 让 UI 直接进骨架屏。
     */
    async fetchLoci(palaceId: number) {
      if (this.activePalaceId !== palaceId) this.lociList = []
      this.activePalaceId = palaceId
      this.lociLoading = true
      try {
        const list = await listLoci(palaceId)
        this.lociList = list
        list.forEach((l) => {
          if (l.masteredLevel !== undefined && this.masterLevels[l.id] === undefined) {
            this.masterLevels[l.id] = l.masteredLevel
          }
        })
        this.currentTourIndex = 0
      } finally {
        this.lociLoading = false
      }
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
     * 复习打分：先本地记熟练度（即时反馈），再把 masteredLevel + lastReviewedAt 落库。
     * 所有宫殿都是真实的库内数据，不再有「演示宫殿只更新本地」的分支。
     */
    async gradeLoci(lociId: number, level: number) {
      this.setMasterLevel(lociId, level)
      const l = this.lociList.find((x) => x.id === lociId)
      if (!l) return
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
        /* 本地已记录，后端落库失败静默处理，下次打分会再次尝试 */
      }
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