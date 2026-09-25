/**
 * Deterministic directive handling.
 *
 * "Save for later" and "where was I?" are answered from stored state without a
 * model call. That is deliberate: they must keep working during a model outage,
 * and they must never be paraphrased differently by a different provider.
 */
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'
import type { ReentryCard } from '../types.ts'

export type Directive =
  | 'save_for_later'
  | 'where_was_i'
  | 'unlink_telegram'
  | 'list_projects'
  | 'help'
  | null

const SAVE_PATTERNS = [
  /^\/save\b/i,
  /\bsave (?:this |it |that )?(?:for|til|till|until) later\b/i,
  /\bsave for later\b/i,
  /\bpark (?:this|it|that)\b/i,
  /\bput (?:this|it|that) aside\b/i,
  /\bcome back to (?:this|it|that) later\b/i,
  /\bnot now,? (?:save|later)\b/i,
]

const REENTRY_PATTERNS = [
  /^\/resume\b/i,
  /^\/where\b/i,
  /\bwhere (?:was|am) i\b/i,
  /\bwhere did i (?:leave|get) (?:off|to)\b/i,
  /\bwhat was i (?:doing|working on|thinking)\b/i,
  /\bpick (?:this|it) back up\b/i,
  /\bresume (?:this|my|where)\b/i,
  /\bremind me where i was\b/i,
]

const UNLINK_PATTERNS = [/^\/unlink\b/i, /\bunlink (?:my )?telegram\b/i]
const LIST_PATTERNS = [/^\/projects\b/i, /^\/list\b/i, /\bshow my projects\b/i]
const HELP_PATTERNS = [/^\/help\b/i, /^\/start$/i]

export function detectDirective(text: string): Directive {
  const t = text.trim()
  if (!t) return null
  if (UNLINK_PATTERNS.some((re) => re.test(t))) return 'unlink_telegram'
  if (LIST_PATTERNS.some((re) => re.test(t))) return 'list_projects'
  if (HELP_PATTERNS.some((re) => re.test(t))) return 'help'
  if (SAVE_PATTERNS.some((re) => re.test(t))) return 'save_for_later'
  if (REENTRY_PATTERNS.some((re) => re.test(t))) return 'where_was_i'
  return null
}

/** A bare number, used to pick a project from a numbered list. */
export function detectNumericChoice(text: string): number | null {
  const m = text.trim().match(/^\/project\s+(\d{1,2})$/i) || text.trim().match(/^(\d{1,2})$/)
  return m ? Number(m[1]) : null
}

/* ------------------------------------------------------------- re-entry */

/**
 * Build the "where was I?" card for a conversation. Reads only records owned by
 * `userId`; a conversation id belonging to someone else yields null.
 */
export function buildReentryCard(
  db: Db,
  userId: string,
  conversationId: string
): ReentryCard | null {
  const conversation = repo.getConversation(db, userId, conversationId)
  if (!conversation) return null

  const project = conversation.projectId
    ? repo.getProject(db, userId, conversation.projectId)
    : null
  const lastUser = repo.lastMessageByRole(db, userId, conversationId, 'user')
  const lastAssistant = repo.lastMessageByRole(db, userId, conversationId, 'assistant')
  const nextAction = repo.latestActionForConversation(db, userId, conversationId)

  // The open question is the most recent assistant question that the user has
  // not answered yet.
  let openQuestion: string | null = null
  if (lastAssistant) {
    const m = lastAssistant.content.match(/One thing worth clarifying:\s*([\s\S]+?)(?:\n\nNext action:|$)/)
    if (m) {
      const askedAt = new Date(lastAssistant.createdAt).getTime()
      const answeredAt = lastUser ? new Date(lastUser.createdAt).getTime() : 0
      if (askedAt > answeredAt) openQuestion = m[1].trim()
    }
  }

  return {
    projectName: project?.title ?? null,
    conversationId: conversation.id,
    lastActivityAt: conversation.lastMessageAt ?? conversation.updatedAt,
    lastUserMessage: lastUser ? clip(lastUser.content, 300) : null,
    lastAssistantMessage: lastAssistant ? clip(lastAssistant.content, 400) : null,
    openQuestion,
    nextAction:
      nextAction && (nextAction.status === 'proposed' || nextAction.status === 'accepted')
        ? nextAction
        : null,
    savedForLater: conversation.status === 'saved_for_later',
    recentFacts: repo.listFacts(db, userId, conversation.projectId ?? undefined, 5),
  }
}

/** Most recently touched conversation for a user, preferring unsaved ones. */
export function findResumeTarget(db: Db, userId: string): string | null {
  const conversations = repo.listConversations(db, userId, 20)
  const active = conversations.find((c) => c.status === 'active')
  return (active ?? conversations[0])?.id ?? null
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** Human-readable rendering of a re-entry card. Same text on web and Telegram. */
export function renderReentryCard(card: ReentryCard): string {
  const lines: string[] = []
  lines.push(card.projectName ? `Where you were — ${card.projectName}` : 'Where you were')
  if (card.savedForLater) lines.push('(You saved this for later.)')

  if (card.lastActivityAt) {
    lines.push(`Last touched: ${formatWhen(card.lastActivityAt)}`)
  }
  if (card.lastUserMessage) {
    lines.push('')
    lines.push(`You said: "${card.lastUserMessage}"`)
  }
  if (card.openQuestion) {
    lines.push('')
    lines.push(`Still unanswered: ${card.openQuestion}`)
  }
  if (card.nextAction) {
    lines.push('')
    lines.push(`Your one next action: ${card.nextAction.title}`)
    if (card.nextAction.detail) lines.push(card.nextAction.detail)
  } else {
    lines.push('')
    lines.push('No open next action recorded.')
  }
  return lines.join('\n')
}

export function formatWhen(iso: string): string {
  const then = new Date(iso).getTime()
  const diffMin = Math.round((Date.now() - then) / 60000)
  if (Number.isNaN(diffMin)) return iso
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH} hour${diffH === 1 ? '' : 's'} ago`
  const diffD = Math.round(diffH / 24)
  if (diffD < 7) return `${diffD} day${diffD === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString()
}
