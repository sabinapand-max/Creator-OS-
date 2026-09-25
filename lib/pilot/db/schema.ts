/**
 * Pilot database schema.
 *
 * Durable, server-side state shared by the Creator OS web UI, the MCP server
 * and the Telegram handler. Browser localStorage cannot support Telegram
 * continuity, so every record below lives here.
 *
 * Isolation rule: every table that holds user content carries `user_id`, and
 * every read/write in `repo.ts` filters on it. A record id supplied by a caller
 * is never sufficient on its own to read that record.
 *
 * Timestamps are stored as ISO-8601 TEXT so `node:sqlite` never has to round
 * them through INTEGER/BigInt.
 */

export const SCHEMA_VERSION = 1

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Pilot accounts. Deliberately separate from any personal Hermes/Neon data.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Web UI sessions (cookie bearer).
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Per-user MCP bearer tokens. The MCP server derives the acting user from the
-- presented token only; a userId in a tool argument is never trusted.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  summary    TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);

-- channel: 'web' | 'telegram' | 'mcp'
-- status:  'active' | 'saved_for_later' | 'closed'
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  title           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_message_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);

-- role: 'user' | 'assistant' | 'system' | 'tool'
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'web',
  created_at      TEXT NOT NULL,
  idempotency_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_idempotency
  ON messages(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- status: 'proposed' | 'accepted' | 'done' | 'discarded'
CREATE TABLE IF NOT EXISTS next_actions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  detail          TEXT,
  status          TEXT NOT NULL DEFAULT 'proposed',
  created_at      TEXT NOT NULL,
  completed_at    TEXT,
  idempotency_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_next_actions_user ON next_actions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_next_actions_idempotency
  ON next_actions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Remembered facts. "source" records where the fact came from and "source_ref"
-- points at the originating record, so a user can see why something is known
-- and correct or delete it.
CREATE TABLE IF NOT EXISTS facts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  content      TEXT NOT NULL,
  source       TEXT NOT NULL,
  source_ref   TEXT,
  confidence   TEXT NOT NULL DEFAULT 'stated',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  corrected_from TEXT,
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id, updated_at DESC);

-- Resolved Telegram identities. Authorization for a Telegram message comes from
-- the verified inbound update's chat/user id looked up here, never from message
-- text or a tool argument.
CREATE TABLE IF NOT EXISTS telegram_links (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_chat_id TEXT NOT NULL,
  telegram_user_id TEXT,
  telegram_username TEXT,
  linked_at       TEXT NOT NULL,
  unlinked_at     TEXT,
  active_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_links_chat
  ON telegram_links(telegram_chat_id)
  WHERE unlinked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_links_user ON telegram_links(user_id);

-- Short-lived, single-use linking codes. Only the hash is stored.
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  consumed_by_chat_id TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_link_codes_user ON telegram_link_codes(user_id, created_at DESC);

-- One row per model call attempt. Drives idempotent retries (a retried request
-- reuses the completed run instead of producing a duplicate action), honest
-- outage reporting, and latency measurement.
CREATE TABLE IF NOT EXISTS model_runs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  provider        TEXT,
  model           TEXT,
  endpoint        TEXT,
  response_text   TEXT,
  error_code      TEXT,
  error_message   TEXT,
  latency_ms      INTEGER,
  created_at      TEXT NOT NULL,
  completed_at    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_model_runs_idempotency
  ON model_runs(user_id, idempotency_key);

-- Outbound Telegram delivery. Writes happen even when sending is gated off, so
-- a mock delivery is always explicitly recorded as a mock.
CREATE TABLE IF NOT EXISTS telegram_outbox (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  chat_id     TEXT NOT NULL,
  body        TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  gateway     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  created_at  TEXT NOT NULL,
  sent_at     TEXT,
  error       TEXT,
  external_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_created ON telegram_outbox(created_at DESC);

-- Pending "which project?" disambiguation for a Telegram chat. The candidate
-- ids are frozen as JSON at the moment the question is asked, so a numeric
-- reply resolves to the same project the user was actually shown even if
-- project ordering changes afterwards.
CREATE TABLE IF NOT EXISTS telegram_choices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id      TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'project',
  options_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_choices_chat
  ON telegram_choices(chat_id, created_at DESC);

-- Drafts the model produced for this user: social posts and offer drafts.
-- Generated from the user's own stored project context and kept server-side, so
-- they survive a refresh, are isolated per user, and can be deleted. Nothing
-- here is ever published by the pilot: delivery stays gated behind
-- PILOT_PUBLISHING_ENABLED, and 'channel' records intent only.
--
-- SCHEMA_VERSION stays at 1: this table is additive and every statement in
-- SCHEMA_SQL is IF NOT EXISTS, so existing pilot databases pick it up on the
-- next open. Bumping the version would make an existing file fail the mismatch
-- guard in client.ts and refuse to open.
CREATE TABLE IF NOT EXISTS content_drafts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL,              -- 'social' | 'offer'
  channel      TEXT NOT NULL,              -- 'linkedin' | 'gumroad' | ...
  title        TEXT,
  body         TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',  -- hashtags, pricing, packages, ...
  source       TEXT NOT NULL,              -- provenance, e.g. 'drafts:web'
  model        TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_drafts_user
  ON content_drafts(user_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
`
