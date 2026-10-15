import type { DatabasePatch } from '@/types/database'

/** 把 `/boards/1/enable` 拆成 ['boards', '1', 'enable'] */
export function toSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0)
}

function isIndex(segment: string): boolean {
  return /^\d+$/.test(segment)
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null
}

/** 按 JSON Patch 路径读取值 */
export function getByPath(root: unknown, path: string): unknown {
  let current: unknown = root
  for (const segment of toSegments(path)) {
    if (!isContainer(current)) return undefined
    if (Array.isArray(current)) {
      if (segment === '-') return undefined
      current = current[Number(segment)]
    } else {
      current = current[segment]
    }
  }
  return current
}

/** 逐级下探，缺失的中间层按下一段的类型创建数组或对象 */
function ensureParent(root: unknown, segments: string[]): unknown {
  let current: unknown = root
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isContainer(current)) return undefined
    const segment = segments[index]
    const next = segments[index + 1]
    let child: unknown = Array.isArray(current) ? current[Number(segment)] : current[segment]
    if (!isContainer(child)) {
      child = isIndex(next) || next === '-' ? [] : {}
      if (Array.isArray(current)) current[Number(segment)] = child
      else current[segment] = child
    }
    current = child
  }
  return current
}

/** 写入值（自动创建中间层） */
export function setByPath(root: unknown, path: string, value: unknown): boolean {
  const segments = toSegments(path)
  if (!segments.length) return false
  const parent = ensureParent(root, segments)
  if (!isContainer(parent)) return false

  const key = segments[segments.length - 1]
  if (Array.isArray(parent)) {
    if (key === '-') {
      parent.push(value)
      return true
    }
    if (!isIndex(key)) return false
    parent[Number(key)] = value
    return true
  }
  parent[key] = value
  return true
}

/** 删除值 */
export function removeByPath(root: unknown, path: string): boolean {
  const segments = toSegments(path)
  if (!segments.length) return false
  const parent = getByPath(root, `/${segments.slice(0, -1).join('/')}`)
  if (!isContainer(parent)) return false

  const key = segments[segments.length - 1]
  if (Array.isArray(parent)) {
    if (!isIndex(key)) return false
    parent.splice(Number(key), 1)
    return true
  }
  return delete parent[key]
}

/** 应用单条 JSON Patch */
export function applyPatch(root: unknown, patch: DatabasePatch): boolean {
  switch (patch.op) {
    case 'replace':
    case 'add':
      return setByPath(root, patch.path, patch.value)
    case 'remove':
      return removeByPath(root, patch.path)
    case 'move':
    case 'copy': {
      if (!patch.from) return false
      const source = getByPath(root, patch.from)
      if (patch.op === 'move') removeByPath(root, patch.from)
      return setByPath(root, patch.path, source)
    }
    case 'test':
      return true
    default:
      return false
  }
}
