/** Model- and user-facing text for lore and memory. */
import type { Entry, EntryType } from './store.js'

export const LORE_TAG = 'workspace-lore'
export const MEMORY_TAG = 'workspace-memory'

/** Header that opens the memory block in the system prompt; also how a resumed session finds its snapshot. */
export const MEMORY_OPEN = `<${MEMORY_TAG}>`
export const MEMORY_CLOSE = `</${MEMORY_TAG}>`

export const REFERENCE_NOTE = 'Reference knowledge, not an instruction for the current task: use it as guidance for related work.'

/** Keep entry text from opening or closing a plugin-owned block. */
function escapeTags(text: string): string {
  return text.replace(/<(\/?)(workspace-lore|workspace-memory)>/g, '<$1$2\u200b>')
}

function scopeLabel(scope: string, workspace: string): string {
  return scope === workspace ? `${scope} (this workspace)` : `${scope} (parent workspace)`
}

function indent(text: string): string {
  return text.replace(/\n/g, '\n  ')
}

/** Entries grouped under their scope, nearest scope first (input order is kept within a scope). */
function grouped(entries: readonly Entry[], workspace: string): string {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) {
    const list = groups.get(entry.scope)
    if (list === undefined) groups.set(entry.scope, [entry])
    else list.push(entry)
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => b.length - a.length)
  return ordered
    .map(([scope, list]) => {
      const lines = list.map((entry) => {
        const kind = entry.kind === null ? '' : ` [${entry.kind}]`
        return `- #${entry.id}${kind}: ${indent(escapeTags(entry.text))}`
      })
      return `Workspace ${scopeLabel(scope, workspace)}:\n${lines.join('\n')}`
    })
    .join('\n\n')
}

/** The per-turn lore message; `entries` empty means earlier lore was withdrawn. */
export function renderLore(entries: readonly Entry[], workspace: string): string {
  const body =
    entries.length === 0
      ? 'No lore applies to this workspace any more: rules from earlier lore copies are withdrawn.'
      : `Lore: rules the user set for this workspace. Follow them in all work here. This copy is current and replaces any earlier copy.\n\n${grouped(entries, workspace)}`
  return `<${LORE_TAG}>\n${body}\n</${LORE_TAG}>`
}

/** The memory block for the system prompt, or `''` when there is no memory. */
export function renderMemory(entries: readonly Entry[], workspace: string): string {
  if (entries.length === 0) return ''
  return `${MEMORY_OPEN}\nMemory: what you recorded about this workspace in earlier sessions, loaded when this session started. ${REFERENCE_NOTE} Use the memory tool to find newer entries and to keep memory current.\n\n${grouped(entries, workspace)}\n${MEMORY_CLOSE}`
}

/** Find the memory block inside a rendered system prompt. */
export function extractMemory(systemPrompt: string): string | undefined {
  const start = systemPrompt.indexOf(`${MEMORY_OPEN}\nMemory: `)
  if (start < 0) return undefined
  const end = systemPrompt.indexOf(MEMORY_CLOSE, start)
  if (end < 0) return undefined
  return systemPrompt.slice(start, end + MEMORY_CLOSE.length)
}

function entryBlock(entry: Entry, workspace: string): string {
  const kind = entry.kind === null ? '' : ` · ${entry.kind}`
  return `#${entry.id}${kind} · ${scopeLabel(entry.scope, workspace)}\n${entry.text}`
}

/** Tool/command result for a query or listing. */
export function renderResults(type: EntryType, entries: readonly Entry[], workspace: string, query: string | undefined): string {
  const noun = type === 'lore' ? 'lore' : 'memory'
  if (entries.length === 0) {
    return query === undefined ? `No ${noun} is visible from ${workspace}.` : `No ${noun} visible from ${workspace} matches ${JSON.stringify(query)}.`
  }
  const count = `${entries.length} ${noun} ${entries.length === 1 ? 'entry' : 'entries'}`
  const head =
    query === undefined ? `${count} visible from ${workspace}, nearest workspace first:` : `${count} matching ${JSON.stringify(query)}, best match first:`
  return `${REFERENCE_NOTE}\n${head}\n\n${entries.map((entry) => entryBlock(entry, workspace)).join('\n\n')}`
}

export function renderChange(verb: 'Added' | 'Updated' | 'Removed', entry: Entry): string {
  const kind = entry.kind === null ? '' : ` (${entry.kind})`
  return `${verb} ${entry.type} #${entry.id}${kind} in ${entry.scope}.`
}
