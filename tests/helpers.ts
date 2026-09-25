/**
 * Test helpers.
 *
 * The fake model server below is a TEST DOUBLE for external inference only. It
 * is labelled as such in every response it produces. It exists so the flow can
 * be proven without spending money or depending on a provider being up; it is
 * never used to make mock output look like AI output in the product.
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openIsolatedDb, type Db } from '../lib/pilot/db/client.ts'
import * as repo from '../lib/pilot/db/repo.ts'
import { hashPassword } from '../lib/pilot/auth/index.ts'
import type { ModelConfig } from '../lib/pilot/model/index.ts'

export interface FakeModelOptions {
  /** Canned completion text. Defaults to a valid structured turn. */
  reply?: string
  /** Respond with this HTTP status instead of 200. */
  status?: number
  /** Never respond, so the client hits its timeout. */
  hang?: boolean
  /** Return 200 with text that is not valid JSON for the turn contract. */
  malformed?: boolean
  /** Report this finish_reason, e.g. 'length' for an answer cut off at the cap. */
  finishReason?: string
}

export interface FakeModel {
  baseUrl: string
  port: number
  calls: Array<{
    model: string
    messages: unknown[]
    authorization: string | null
    /** The whole request body, so sampling parameters can be asserted on. */
    body: any
  }>
  close: () => Promise<void>
}

export const VALID_TURN_JSON = JSON.stringify({
  interpretation:
    'You want to launch the newsletter but the unfinished book chapter is blocking your attention.',
  question: 'When do you want the newsletter to go out?',
  nextAction: {
    title: 'Block 25 minutes tomorrow morning to write the newsletter welcome email only.',
    detail: 'Not the book. Just the welcome email.',
  },
  observedFacts: ['Has an unfinished book chapter', 'Wants to launch a newsletter'],
})

/** Start a local OpenAI-compatible test double. LABELLED: not a real model. */
export async function startFakeModel(opts: FakeModelOptions = {}): Promise<FakeModel> {
  const calls: FakeModel['calls'] = []

  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      if (opts.hang) return // never respond; the client must time out

      let parsed: any = {}
      try {
        parsed = raw ? JSON.parse(raw) : {}
      } catch {
        parsed = {}
      }
      calls.push({
        model: String(parsed.model ?? ''),
        messages: parsed.messages ?? [],
        authorization: (req.headers.authorization as string) ?? null,
        body: parsed,
      })

      if (opts.status && opts.status !== 200) {
        res.writeHead(opts.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'FAKE MODEL test double: forced error' } }))
        return
      }

      const text = opts.malformed
        ? 'Sure! Here are some thoughts on your newsletter and your book chapter.'
        : (opts.reply ?? VALID_TURN_JSON)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          model: parsed.model ?? 'fake-model',
          choices: [
            {
              message: { role: 'assistant', content: text },
              finish_reason: opts.finishReason ?? 'stop',
            },
          ],
        })
      )
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    port,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** A ModelConfig pointing at a test double. Loopback, so no key is required. */
export function fakeModelConfig(baseUrl: string, modelId = 'fake/test-model'): ModelConfig {
  return {
    provider: 'openai-compatible',
    modelId,
    baseUrl,
    apiKey: null,
    timeoutMs: 4000,
    hosted: false,
    allowLoopbackModel: true,
  }
}

/** A ModelConfig pointing at a port nothing is listening on. */
export function deadModelConfig(port = 1): ModelConfig {
  return {
    provider: 'openai-compatible',
    modelId: 'fake/unreachable',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: null,
    timeoutMs: 1500,
    hosted: false,
    allowLoopbackModel: true,
  }
}

export interface TempStore {
  db: Db
  dbPath: string
  dispose: () => void
}

/** A throwaway SQLite file, so restart-durability can be tested for real. */
export function tempStore(): TempStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'cop-test-'))
  const dbPath = path.join(dir, 'pilot.sqlite')
  return {
    db: openIsolatedDb(dbPath),
    dbPath,
    dispose: () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best effort on Windows */
      }
    },
  }
}

/** Create a pilot user directly, bypassing HTTP. */
export function makeUser(db: Db, email: string, displayName = email.split('@')[0]) {
  return repo.createUser(db, {
    email,
    displayName,
    passwordHash: hashPassword('test-password-123'),
  })
}
