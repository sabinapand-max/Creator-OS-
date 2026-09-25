/**
 * Creator OS MCP server (stdio transport).
 *
 * Exposes exactly the five tools the pilot brief names, and nothing else:
 *   capture_brain_dump, get_project_context, append_conversation_message,
 *   propose_next_action, get_reentry_card
 *
 * AUTHENTICATION. stdio has no per-request headers, so the bearer token arrives
 * once in PILOT_MCP_TOKEN and is resolved to a user id before the server starts
 * listening. Every tool then acts as THAT user, and no tool accepts a userId
 * argument: a caller that could name the user it acts as could act as anyone,
 * which is precisely what the brief forbids. A missing, unknown, revoked or
 * expired token stops the process rather than starting it open.
 *
 * stdout IS THE PROTOCOL CHANNEL. Every diagnostic goes to stderr, because one
 * stray console.log corrupts the JSON-RPC stream and the client then reports a
 * parse error instead of the real reason.
 *
 * Run it with the npm script, which loads .env.local for you:
 *   npm run mcp
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { resolveMcpBearer } from '../lib/pilot/auth/index.ts'
import { getDb } from '../lib/pilot/db/client.ts'
import * as repo from '../lib/pilot/db/repo.ts'
import { getProjectContext } from '../lib/pilot/core/context.ts'
import {
  appendConversationMessage,
  captureBrainDump,
  getReentryCardTool,
  proposeNextActionTool,
  type SubmitTurnResult,
} from '../lib/pilot/core/conversation.ts'

/* ------------------------------------------------------------------ output */

/** Human-readable text plus the raw JSON, so a person and an agent both read it. */
function out(summary: string, raw?: unknown, isError = false): CallToolResult {
  const text = raw === undefined ? summary : `${summary}\n\n--- json ---\n${JSON.stringify(raw, null, 2)}`
  return { content: [{ type: 'text', text }], isError }
}

/** The turn's next action arrives as a string or a small record; render either. */
function actionText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title : null
    const detail = typeof record.detail === 'string' ? record.detail : null
    if (title) return detail ? `${title} — ${detail}` : title
  }
  return JSON.stringify(value)
}

/**
 * One renderer for both conversation tools, so an MCP client sees the same
 * wording the web UI and Telegram show. A model failure is an error result, not
 * an empty success: the caller must be able to tell "nothing was generated" from
 * "here is your answer".
 */
function renderTurn(result: SubmitTurnResult): CallToolResult {
  if (!result.ok) {
    if (result.kind === 'model_failure') {
      return out(
        [
          `The model call failed (${result.failure.code}).`,
          result.failure.message,
          '',
          'Your message was stored before the call, so nothing was lost. Sending the same',
          'text again retries it and cannot create a duplicate.',
        ].join('\n'),
        { code: result.failure.code, conversationId: result.conversationId, preservedInput: result.preservedInput },
        true
      )
    }
    return out(`${result.kind}: ${result.message}`, undefined, true)
  }

  if (result.kind === 'directive') {
    return out(result.text, { directive: result.directive, conversationId: result.conversationId })
  }

  const turn = result.turn
  const lines = [`Reading: ${turn.interpretation}`]
  if (turn.question) lines.push(`Worth clarifying: ${turn.question}`)
  if (turn.nextAction) lines.push(`Next action: ${actionText(turn.nextAction)}`)
  const facts = Array.isArray(turn.observedFacts) ? turn.observedFacts : []
  if (facts.length > 0) lines.push(`Remembered: ${facts.map((f: unknown) => actionText(f)).join('; ')}`)
  lines.push('', `(model ${result.model}, ${(result.latencyMs / 1000).toFixed(1)}s, conversationId ${result.conversationId})`)

  return out(lines.join('\n'), {
    conversationId: result.conversationId,
    projectId: result.projectId,
    turn,
    nextAction: result.nextAction,
    model: result.model,
    latencyMs: result.latencyMs,
  })
}

/* -------------------------------------------------------------------- auth */

const db = getDb()

const token = process.env.PILOT_MCP_TOKEN?.trim()
if (!token) {
  process.stderr.write(
    [
      'PILOT_MCP_TOKEN is not set, so this server will not start.',
      '',
      'It authenticates the whole session: every tool acts as the user that token',
      'belongs to. Mint one in the pilot web app under Settings -> MCP access, then:',
      '',
      '  $env:PILOT_MCP_TOKEN = "cop_..."',
      '  npm run mcp',
      '',
    ].join('\n')
  )
  process.exitCode = 1
} else {
  const userId = resolveMcpBearer(db, token)
  if (!userId) {
    process.stderr.write(
      'That MCP token is not valid — it is unknown, revoked or expired. Mint a new one\n' +
        'in the pilot web app under Settings -> MCP access. Nothing was served.\n'
    )
    process.exitCode = 1
  } else {
    const account = repo.getUserById(db, userId)
    await start(userId, account?.displayName ?? account?.email ?? userId)
  }
}

/* ------------------------------------------------------------------ server */

async function start(userId: string, who: string): Promise<void> {
  const server = new McpServer(
    { name: 'creator-os-pilot', version: '0.2.0' },
    { capabilities: { tools: {} } }
  )

  process.stderr.write(`Creator OS MCP server ready for ${who}. Five tools, acting as that account only.\n`)

  server.registerTool(
    'capture_brain_dump',
    {
      title: 'Capture a brain dump',
      description:
        'Start a new brain dump for the authenticated user. Stores the text, then returns one ' +
        'interpretation, at most one clarifying question and exactly one next action. Requires a ' +
        'configured model; if the model is unavailable it says so and the text is still stored.',
      inputSchema: {
        text: z.string().describe('The messy brain dump, in the user\'s own words.'),
        projectTitle: z.string().optional().describe('Optional title for the project this creates.'),
      },
    },
    async ({ text, projectTitle }) =>
      renderTurn(await captureBrainDump(db, { userId, text, projectTitle: projectTitle ?? null }))
  )

  server.registerTool(
    'get_project_context',
    {
      title: 'Get project context',
      description:
        'Read what the pilot has stored for one of the authenticated user\'s projects: the ' +
        'project, its active conversation, open next actions, remembered facts and recent ' +
        'messages. Read-only. Returns an error for a project the user does not own.',
      inputSchema: {
        projectId: z.string().describe('Id of one of your projects, as returned by the other tools.'),
      },
    },
    ({ projectId }) => {
      const context = getProjectContext(db, userId, projectId)
      if (!context) return out('No such project, or it is not yours.', undefined, true)
      return out(
        [
          `Project: ${context.project.title}`,
          context.project.summary ? `Summary: ${context.project.summary}` : null,
          `Open next actions: ${context.openNextActions.length}`,
          `Remembered facts: ${context.facts.length}`,
          `Recent messages: ${context.recentMessages.length}`,
          context.activeConversation ? `Active conversation: ${context.activeConversation.id}` : 'No active conversation.',
        ]
          .filter(Boolean)
          .join('\n'),
        context
      )
    }
  )

  server.registerTool(
    'append_conversation_message',
    {
      title: 'Continue a conversation',
      description:
        'Add a message to an existing conversation the authenticated user owns and get the next ' +
        'turn. This is the follow-up path: context from earlier in the same conversation is carried.',
      inputSchema: {
        conversationId: z.string().describe('The conversation to continue.'),
        text: z.string().describe('What the user said next.'),
      },
    },
    async ({ conversationId, text }) =>
      renderTurn(await appendConversationMessage(db, { userId, conversationId, text }))
  )

  server.registerTool(
    'propose_next_action',
    {
      title: 'Propose a next action',
      description:
        'Record one concrete next action against a conversation or project the authenticated user ' +
        'owns. It is stored as proposed, never as done, and never publishes or sends anything.',
      inputSchema: {
        title: z.string().describe('The action, short and concrete.'),
        detail: z.string().optional().describe('Optional extra detail.'),
        conversationId: z.string().optional().describe('Attach to this conversation.'),
        projectId: z.string().optional().describe('Attach to this project.'),
      },
    },
    ({ title, detail, conversationId, projectId }) => {
      const result = proposeNextActionTool(db, {
        userId,
        title,
        detail: detail ?? null,
        conversationId: conversationId ?? null,
        projectId: projectId ?? null,
      })
      if (!result.ok) return out(`${result.kind}: ${result.message}`, undefined, true)
      return out(
        `${result.deduplicated ? 'Already recorded (same action, not duplicated)' : 'Next action proposed'}: ${result.action.title}`,
        result.action
      )
    }
  )

  server.registerTool(
    'get_reentry_card',
    {
      title: 'Get the re-entry card',
      description:
        'Answer "where was I?" for the authenticated user. Returns a short readable card for the ' +
        'conversation to resume: where it stopped, the open next action and the last thing said. ' +
        'Needs no model, so it works while the model is down.',
      inputSchema: {
        conversationId: z.string().optional().describe('Omit to pick the most recent resumable conversation.'),
      },
    },
    ({ conversationId }) => {
      const result = getReentryCardTool(db, { userId, conversationId: conversationId ?? null })
      if (!result.ok) return out(`${result.kind}: ${result.message}`, undefined, true)
      return out(result.rendered, result.card)
    }
  )

  await server.connect(new StdioServerTransport())
}
