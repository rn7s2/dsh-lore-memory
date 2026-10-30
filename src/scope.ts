/**
 * Scopes: every entry belongs to the workspace folder it was written in.
 *
 * A workspace sees its own scope and every ancestor folder's scope, matched on
 * whole path components and compared exactly (case-sensitively).
 */
import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'

/**
 * The scopes visible from `workspace`, nearest first: the workspace itself,
 * then each parent folder up to the filesystem root.
 */
export function visibleScopes(workspace: string): string[] {
  const scopes: string[] = []
  let current = workspace
  while (true) {
    scopes.push(current)
    const cut = current.lastIndexOf(sep)
    if (cut < 0 || current === sep) break
    current = cut === 0 ? sep : current.slice(0, cut)
  }
  return scopes
}

/** Whether entries in `scope` are visible from `workspace`. */
export function isVisible(scope: string, workspace: string): boolean {
  if (scope === workspace) return true
  if (scope === sep) return workspace.startsWith(sep)
  return workspace.startsWith(scope + sep)
}

/**
 * Canonical identity of a workspace folder: absolute, normalized, symlinks
 * resolved. A folder that no longer exists keeps its normalized path.
 */
export async function canonicalWorkspace(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`workspace path must be absolute: ${path}`)
  const normalized = resolve(path)
  try {
    return await realpath(normalized)
  } catch {
    return normalized
  }
}
