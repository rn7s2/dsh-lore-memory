/**
 * `/lore` and `/memory`.
 *
 * `/lore <text>` adds lore directly: the user typed it, so no approval is
 * asked. `/lore` only adds; editing or removing lore goes through the agent
 * and the user's approval. `/memory <text>` asks the agent to update memory.
 */
import { errorMessage } from './errors.js'
import { type AgentLike, userMessage } from './host.js'
import { renderChange, renderResults } from './render.js'
import type { LoreMemoryService } from './service.js'

export type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

export interface CommandDefinitionLike {
  name: string
  description: string
  input?: { hint: string }
  handler(invocation: { agent: AgentLike; rawInput: string; attachments: readonly unknown[] }): Promise<CommandResult>
}

export function memoryRequest(text: string): string {
  return `Update this workspace's memory accordingly, using the memory tool: ${text}`
}

export function loreCommand(service: LoreMemoryService): CommandDefinitionLike {
  return {
    name: 'lore',
    description: 'List the lore visible here, or add a rule to this workspace\'s lore.',
    input: { hint: '[rule to add]' },
    async handler({ agent, rawInput }) {
      try {
        const text = rawInput.trim()
        const workspace = await service.workspaceOf(agent)
        const store = await service.store()
        if (text === '') return { kind: 'success', text: renderResults('lore', await store.listAsync('lore', workspace), workspace, undefined) }
        const entry = await store.add('lore', workspace, text, null, { author: 'user', sessionId: agent.session.id })
        return { kind: 'success', text: `${renderChange('Added', entry)} It applies from the next turn.` }
      } catch (error) {
        return { kind: 'error', text: errorMessage(error) }
      }
    },
  }
}

export function memoryCommand(service: LoreMemoryService): CommandDefinitionLike {
  return {
    name: 'memory',
    description: 'List the memory visible here, or ask the agent to update this workspace\'s memory.',
    input: { hint: '[what to remember or change]' },
    async handler({ agent, rawInput }) {
      try {
        const text = rawInput.trim()
        if (text === '') {
          const workspace = await service.workspaceOf(agent)
          const store = await service.store()
          return { kind: 'success', text: renderResults('memory', await store.listAsync('memory', workspace), workspace, undefined) }
        }
        if (agent.followup === undefined) return { kind: 'error', text: 'this session cannot take a follow-up request' }
        agent.followup(userMessage(memoryRequest(text), { kind: 'user' }))
        return { kind: 'success', text: 'Asked the agent to update this workspace\'s memory.' }
      } catch (error) {
        return { kind: 'error', text: errorMessage(error) }
      }
    },
  }
}
