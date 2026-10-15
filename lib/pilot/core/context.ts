/**
 * Project context assembly.
 *
 * This is what `get_project_context` returns to the agent and what the web UI
 * renders. Both read the same object so the agent and the pilot user can never
 * disagree about what is known.
 *
 * Every lookup here is ownership-scoped. A project id belonging to another user
 * yields null rather than leaking or silently substituting a record.
 */
import type { Db } from '../db/client.ts'
import * as repo from '../db/repo.ts'
import type { ProjectContext } from '../types.ts'
import { buildContextBlock, type PromptContext } from './prompts.ts'

export async function getProjectContext(
  db: Db,
  userId: string,
  projectId: string
): Promise<ProjectContext | null> {
  const project = await repo.getProject(db, userId, projectId)
  if (!project) return null

  const activeConversation = await repo.activeConversationForProject(db, userId, project.id)
  const conversations = await repo.listConversationsForProject(db, userId, project.id)
  // Recent messages belong to the active conversation when there is one,
  // otherwise to the most recently touched conversation on this project.
  const messageSource = activeConversation?.id ?? conversations[0]?.id ?? null

  return {
    project,
    activeConversation,
    openNextActions: await repo.listOpenActions(db, userId, project.id, 10),
    facts: await repo.listFacts(db, userId, project.id, 40),
    recentMessages: messageSource
      ? await repo.listMessages(db, userId, messageSource, 20)
      : [],
  }
}

/**
 * Context for the conversation about to be answered.
 *
 * Throws when the conversation is not owned by `userId`, because answering it
 * would mean feeding another pilot user's history into a prompt.
 */
export async function promptContextForConversation(
  db: Db,
  userId: string,
  conversationId: string
): Promise<PromptContext> {
  const conversation = await repo.getConversation(db, userId, conversationId)
  if (!conversation) throw new Error('conversation_not_found')

  const projectId = conversation.projectId

  return {
    project: projectId ? await repo.getProject(db, userId, projectId) : null,
    facts: await repo.listFacts(db, userId, projectId ?? undefined, 40),
    openActions: projectId ? await repo.listOpenActions(db, userId, projectId, 10) : [],
    history: await repo.listMessages(db, userId, conversationId, 40),
  }
}

export function renderContext(ctx: PromptContext): string {
  return buildContextBlock(ctx)
}

/** The user's projects, numbered, for "which project?" disambiguation. */
export async function numberedProjectList(
  db: Db,
  userId: string,
  limit = 6
): Promise<string[]> {
  const projects = await repo.listProjects(db, userId)
  return projects
    .slice(0, limit)
    .map((p, i) => `${i + 1}. ${p.title}`)
}
