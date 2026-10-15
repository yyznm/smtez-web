import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useDatabaseStore } from '@/stores/database'
import type { DbBoard } from '@/types/database'

/** 元件列表筛选 */
export type PartFilter = 'all' | 'enabled' | 'disabled'

/** PCB 列表行（映射 /boards） */
export interface BoardView {
  index: number
  /** 数据库路径，如 /boards/0 */
  path: string
  id: string
  side: string
  enable: boolean
  status: string
}

/** 元件行（映射 /boards/i/allchildparts/j/allparts/k） */
export interface PartView {
  path: string
  childIndex: number
  ref: string
  kind: 'part' | 'mark'
  value: string
  package: string
  x: number
  y: number
  rot: number
  side: string
  enable: boolean
  status: string
  /** 机器坐标（元件 data 字段），缺失时无法定位 */
  machineX: number | null
  machineY: number | null
}

export const usePlacementStore = defineStore('placement', () => {
  const database = useDatabaseStore()

  const activeIndex = ref(0)
  /** 当前选中的子板（拼版中的单块小板） */
  const activeChild = ref(0)
  const filter = ref<PartFilter>('all')
  const query = ref('')
  /** 点选定位：默认打开，点元件即移动头部过去 */
  const locateMode = ref(true)
  /** 当前选中的元件路径 */
  const selectedPath = ref('')

  function boardAt(index: number): DbBoard | undefined {
    return database.get<DbBoard[]>('/boards', [])[index]
  }

  const boards = computed<BoardView[]>(() =>
    database.get<DbBoard[]>('/boards', []).map((board, index) => ({
      index,
      path: `/boards/${index}`,
      id: board.Boardid ?? '',
      side: board.Side ?? '',
      enable: Boolean(board.enable),
      status: board.status ?? '',
    })),
  )

  const activeBoard = computed<BoardView | undefined>(() => boards.value[activeIndex.value])
  const enabledBoardCount = computed(() => boards.value.filter((board) => board.enable).length)

  /* ---------------- 拼板设置：/{board}/setting ---------------- */

  const arrayQty = computed(() => ({
    x: database.getNumber(`${activeBoard.value?.path}/setting/xcountvalue`, 1),
    y: database.getNumber(`${activeBoard.value?.path}/setting/ycountvalue`, 1),
  }))

  const arrayGap = computed(() => ({
    x: database.getNumber(`${activeBoard.value?.path}/setting/xdimvalue`, 0),
    y: database.getNumber(`${activeBoard.value?.path}/setting/ydimvalue`, 0),
  }))

  /* ---------------- 拼版网格 ---------------- */

  /** 拼版网格行列（来自数量 X / Y） */
  const panelGrid = computed(() => {
    const x = Math.max(1, Math.round(arrayQty.value.x))
    const y = Math.max(1, Math.round(arrayQty.value.y))
    return { x, y, count: x * y }
  })

  /** 数据库里实际存在的子板数量 */
  const childCount = computed(() => boardAt(activeIndex.value)?.allchildparts?.length ?? 0)

  /** 网格单元 → 子板索引，按行优先排列，超出实际子板的单元不可选 */
  const panelCells = computed(() =>
    Array.from({ length: panelGrid.value.count }, (_, index) => ({
      index,
      x: (index % panelGrid.value.x) + 1,
      y: Math.floor(index / panelGrid.value.x) + 1,
      available: index < childCount.value,
    })),
  )

  /* ---------------- 元件 ---------------- */

  /** 当前子板的元件 */
  const parts = computed<PartView[]>(() => {
    const board = boardAt(activeIndex.value)
    const childIndex = activeChild.value
    const list = board?.allchildparts?.[childIndex]?.allparts
    if (!list) return []

    return list.map((part, partIndex) => {
      const position = (part.data ?? {}) as { x?: unknown; y?: unknown }
      return {
        path: `/boards/${activeIndex.value}/allchildparts/${childIndex}/allparts/${partIndex}`,
        childIndex,
        ref: part.Ref ?? '',
        kind: part.PartType === 'Fiducial' ? 'mark' : 'part',
        value: part.Val ?? '',
        package: part.Package ?? '',
        x: Number(part.PosX) || 0,
        y: Number(part.PosY) || 0,
        rot: Number(part.Rot) || 0,
        side: part.Side ?? '',
        enable: Boolean(part.enable),
        status: part.status ?? '',
        machineX: typeof position.x === 'number' ? position.x : null,
        machineY: typeof position.y === 'number' ? position.y : null,
      }
    })
  })

  const visibleParts = computed(() => {
    const keyword = query.value.trim().toLowerCase()
    return parts.value.filter((part) => {
      if (filter.value === 'enabled' && !part.enable) return false
      if (filter.value === 'disabled' && part.enable) return false
      if (!keyword) return true
      return (
        part.ref.toLowerCase().includes(keyword) ||
        part.value.toLowerCase().includes(keyword) ||
        part.package.toLowerCase().includes(keyword)
      )
    })
  })

  const selectedPart = computed(
    () => parts.value.find((part) => part.path === selectedPath.value) ?? null,
  )

  const stats = computed(() => {
    const list = parts.value
    return {
      total: list.length,
      enabled: list.filter((part) => part.enable).length,
      marks: list.filter((part) => part.kind === 'mark').length,
      placements: list.filter((part) => part.kind === 'part').length,
    }
  })

  /* ---------------- 修改（统一走数据库 patch） ---------------- */

  function selectBoard(index: number) {
    activeIndex.value = index
    activeChild.value = 0
    selectedPath.value = ''
  }

  /** 切换拼版中的子板 */
  function selectChild(index: number) {
    if (index < 0 || index >= childCount.value) return
    activeChild.value = index
    selectedPath.value = ''
  }

  function selectPart(path: string) {
    selectedPath.value = path
  }

  function setBoardEnabled(index: number, enabled: boolean) {
    database.set(`/boards/${index}/enable`, enabled)
  }

  function setPartEnabled(path: string, enabled: boolean) {
    database.set(`${path}/enable`, enabled)
  }

  function setAllParts(enabled: boolean) {
    database.setMany(
      parts.value
        .filter((part) => part.enable !== enabled)
        .map((part) => ({ op: 'replace' as const, path: `${part.path}/enable`, value: enabled })),
    )
  }

  return {
    activeIndex,
    activeChild,
    activeBoard,
    boards,
    enabledBoardCount,
    arrayQty,
    arrayGap,
    panelGrid,
    panelCells,
    childCount,
    parts,
    visibleParts,
    stats,
    filter,
    query,
    locateMode,
    selectedPath,
    selectedPart,
    selectBoard,
    selectChild,
    selectPart,
    setBoardEnabled,
    setPartEnabled,
    setAllParts,
  }
})
