/**
 * Prompt construction for a brain-dump turn.
 *
 * The prompt is the behavioural contract shared by every surface: the web UI,
 * the MCP tools and the Telegram handler all produce a turn through here, so
 * they cannot drift apart.
 *
 * Scope note: Etsy listings and inventory are explicitly out of scope for this
 * pilot and the model is told so, rather than being filtered after the fact.
 */
import type { Fact, Message, NextAction, Project } from '../types.ts'

export const TURN_SYSTEM_PROMPT = `You are the Brain Dump companion inside Creator OS, a private pilot for three people.

Your job on every turn is narrow and specific:
1. Give a CONCISE interpretation of what the person actually said. Two or three sentences maximum. Reflect their situation back accurately; do not pad it with encouragement or generic advice.
2. Ask AT MOST ONE question, and only when the answer would genuinely change what they should do next. If you already have enough to suggest a useful step, ask nothing. Return null for the question in that case.
3. Suggest exactly ONE useful next action: the single smallest thing that moves this forward today. Never a list. Never three options.

Rules:
- The person is likely neurodivergent and easily overwhelmed. Fewer words and one clear step beats a thorough plan.
- Do not propose Etsy listings, product inventory, stock counts, or marketplace catalogue work. Those are out of scope for this pilot. If they ask for it, say it is out of scope for now and pick a different next action.
- Social publishing is a later milestone. Do not schedule, post, or promise to post anything.
- Do not invent facts about the person. Use only what is in the context below.
- Never claim to have done something you cannot do.

Respond with ONLY a JSON object, no prose and no code fence, in exactly this shape:
{
  "interpretation": string,
  "question": string | null,
  "nextAction": { "title": string, "detail": string | null } | null,
  "observedFacts": string[]
}

JSON rules, and these matter more than the wording of your advice:
- Every value must be a double-quoted JSON string. Never write a bare sentence as a value.
- Use null (unquoted) when there is no question and no next action. Never use "null" or "".
- No trailing commas. No comments. No text before the opening brace or after the closing brace.
- Escape any double quote inside a value as \" and put no raw newlines inside a string value.

Worked example of a correct answer:
{
  "interpretation": "You have three unfinished projects and want the newsletter to be the priority, but you only have six focused hours a week.",
  "question": "Which day this week are those six hours?",
  "nextAction": { "title": "Block 45 minutes tomorrow and write only the newsletter welcome email.", "detail": "Not the courses and not the book. One email." },
  "observedFacts": ["Has about six focused hours per week", "Wants the newsletter to be the main asset"]
}

"observedFacts" holds zero to five short durable statements the person has told you about themselves or this project (preferences, constraints, deadlines, collaborators, tools they use). Only include things they actually stated. Use an empty array when there is nothing new.`

export interface PromptContext {
  project: Project | null
  facts: Fact[]
  openActions: NextAction[]
  history: Message[]
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/**
 * Render the durable context the model is allowed to rely on. Kept deliberately
 * small so a local model with a modest context window still works.
 */
export function buildContextBlock(ctx: PromptContext): string {
  const lines: string[] = []

  if (ctx.project) {
    lines.push(`PROJECT: ${ctx.project.title}`)
    if (ctx.project.summary) lines.push(`Project summary: ${truncate(ctx.project.summary, 400)}`)
  } else {
    lines.push('PROJECT: not named yet')
  }

  if (ctx.facts.length > 0) {
    lines.push('')
    lines.push('WHAT IS ALREADY KNOWN (do not ask about these again):')
    for (const f of ctx.facts.slice(0, 12)) {
      lines.push(`- ${truncate(f.content, 200)}`)
    }
  }

  if (ctx.openActions.length > 0) {
    lines.push('')
    lines.push('OPEN NEXT ACTIONS:')
    for (const a of ctx.openActions.slice(0, 5)) {
      lines.push(`- ${truncate(a.title, 160)}`)
    }
  }

  if (ctx.history.length > 0) {
    lines.push('')
    lines.push('CONVERSATION SO FAR:')
    for (const m of ctx.history.slice(-12)) {
      const who = m.role === 'user' ? 'Them' : m.role === 'assistant' ? 'You' : m.role
      lines.push(`${who}: ${truncate(m.content, 500)}`)
    }
  }

  return lines.join('\n')
}

export function buildTurnMessages(ctx: PromptContext, userText: string) {
  return [
    { role: 'system' as const, content: TURN_SYSTEM_PROMPT },
    { role: 'user' as const, content: `${buildContextBlock(ctx)}\n\nTHEIR NEW MESSAGE:\n${userText}` },
  ]
}

/**
 * Compose the assistant message that gets stored and shown. Derived from the
 * validated model output only — never from template filler.
 */
export function composeAssistantText(turn: {
  interpretation: string
  question: string | null
  nextAction: { title: string; detail: string | null } | null
}): string {
  const parts: string[] = [turn.interpretation.trim()]
  if (turn.question) parts.push(`One thing worth clarifying: ${turn.question.trim()}`)
  if (turn.nextAction) {
    const detail = turn.nextAction.detail ? ` — ${turn.nextAction.detail.trim()}` : ''
    parts.push(`Next action: ${turn.nextAction.title.trim()}${detail}`)
  }
  return parts.join('\n\n')
}
