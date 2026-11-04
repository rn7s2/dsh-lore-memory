/** Path arithmetic for the page's breadcrumb and folder chips; pure and testable. */
import type { ScopeSummary } from '../remote.js'

/** Whether entries stored at `scope` are at or below `prefix`. */
export function isUnder(scope: string, prefix: string): boolean {
  if (prefix === '/') return scope.startsWith('/')
  return scope === prefix || scope.startsWith(`${prefix}/`)
}

/** The immediate child folders of `prefix`, with the entry counts of their whole subtree. */
export function childrenOf(scopes: readonly ScopeSummary[], prefix: string): ScopeSummary[] {
  const children = new Map<string, { lore: number; memory: number }>()
  for (const scope of scopes) {
    if (!isUnder(scope.path, prefix)) continue
    const rest = prefix === '/' ? scope.path.slice(1) : scope.path.slice(prefix.length + 1)
    if (rest === '') continue
    const segment = rest.split('/')[0]!
    const path = prefix === '/' ? `/${segment}` : `${prefix}/${segment}`
    const current = children.get(path) ?? { lore: 0, memory: 0 }
    children.set(path, { lore: current.lore + scope.lore, memory: current.memory + scope.memory })
  }
  return [...children.entries()]
    .map(([path, counts]) => ({ path, ...counts }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

/** One crumb per path segment, each with its cumulative absolute path. */
export function crumbsOf(prefix: string): { label: string; path: string }[] {
  if (prefix === '/') return []
  const crumbs: { label: string; path: string }[] = []
  let path = ''
  for (const segment of prefix.split('/').filter((part) => part !== '')) {
    path += `/${segment}`
    crumbs.push({ label: segment, path })
  }
  return crumbs
}

/** The counts at and below `prefix`. */
export function totalsOf(scopes: readonly ScopeSummary[], prefix: string): { lore: number; memory: number } {
  let lore = 0
  let memory = 0
  for (const scope of scopes) {
    if (!isUnder(scope.path, prefix)) continue
    lore += scope.lore
    memory += scope.memory
  }
  return { lore, memory }
}

/** The last path component, for a compact folder chip. */
export function lastSegment(path: string): string {
  if (path === '/') return '/'
  const index = path.lastIndexOf('/')
  return path.slice(index + 1)
}
