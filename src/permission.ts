/**
 * Whether an agent may change lore, and how.
 *
 * - `direct`: the session runs in Full Access (no sandbox, approval prompts
 *   off). The user chose to let the agent act without asking, so lore
 *   changes apply without a prompt.
 * - `ask`: approval prompts are on; every lore change asks the user first.
 * - `refused`: approval prompts are off but the session is not in Full
 *   Access (for example a confined subagent), or no approval service exists.
 *   The agent cannot change lore; the user can still add it with `/lore`.
 */
import type { AgentLike, SessionLike } from './host.js'

export type LorePermission = { readonly kind: 'direct' } | { readonly kind: 'ask' } | { readonly kind: 'refused'; readonly reason: string }

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'ask' | 'never'

/** The slices of `ctx.sandboxPolicy` and `ctx.approval` read here. */
export interface SandboxPolicyLike {
  resolve(request: { session?: SessionLike }): { mode: SandboxMode }
}

export interface ApprovalPolicyLike {
  overrideOf?(session: SessionLike): ApprovalPolicy | undefined
  /** Present on the shipped approval service; the session override falling back to its configured default. */
  effectivePolicy?(session: SessionLike): ApprovalPolicy
  readonly config?: { readonly policy?: ApprovalPolicy }
}

export const REFUSED_NEVER =
  "lore changes need the user's approval, and approval prompts are off in this session; nothing was changed. The user can add lore with `/lore <text>`, or switch the session to Full Access (agent lore changes then apply directly) or to a mode that asks for approval"
export const REFUSED_UNAVAILABLE = "lore changes need the user's approval, and no approval service is available; nothing was changed. The user can add lore with `/lore <text>`"

export function approvalPolicyOf(approval: ApprovalPolicyLike, session: SessionLike): ApprovalPolicy {
  if (typeof approval.effectivePolicy === 'function') return approval.effectivePolicy(session)
  return approval.overrideOf?.(session) ?? approval.config?.policy ?? 'ask'
}

export function lorePermission(agent: AgentLike, approval: ApprovalPolicyLike | undefined, sandbox: SandboxPolicyLike | undefined): LorePermission {
  if (approval === undefined) return { kind: 'refused', reason: REFUSED_UNAVAILABLE }
  const policy = approvalPolicyOf(approval, agent.session)
  if (policy !== 'never') return { kind: 'ask' }
  const mode = sandbox?.resolve({ session: agent.session }).mode
  return mode === 'danger-full-access' ? { kind: 'direct' } : { kind: 'refused', reason: REFUSED_NEVER }
}
