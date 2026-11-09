import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ensureWorkspaceSchema } from './workspaces'
import { ensureImportSchema } from './imports'

let db: DatabaseSync | null = null

export function useDb(): DatabaseSync {
  if (db) return db
  const file = process.env.HUB_DB ?? '.data/hub.sqlite'
  mkdirSync(dirname(file), { recursive: true })
  db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS versions (
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (artifact_id, version)
    );

    CREATE TABLE IF NOT EXISTS files (
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      path TEXT NOT NULL,
      content BLOB NOT NULL,
      content_type TEXT NOT NULL,
      changed_in INTEGER NOT NULL,
      PRIMARY KEY (artifact_id, version, path),
      FOREIGN KEY (artifact_id, version) REFERENCES versions(artifact_id, version) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shares (
      token TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('view', 'comment')),
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thumbs (
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      key TEXT NOT NULL,
      jpeg BLOB NOT NULL,
      PRIMARY KEY (artifact_id, path)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      board TEXT,
      anchor TEXT,
      author_email TEXT NOT NULL,
      author_kind TEXT NOT NULL CHECK (author_kind IN ('person', 'model')),
      body TEXT NOT NULL,
      parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_by_artifact ON comments(artifact_id, created_at);

    -- Files pasted into comments. comment_id stays NULL until the comment is posted (staged uploads).
    CREATE TABLE IF NOT EXISTS comment_attachments (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      content BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comment_attachments_by_comment ON comment_attachments(comment_id);

    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      challenge TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token_hash TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
      client_id TEXT NOT NULL,
      family TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens(family);

    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('editor', 'commenter')),
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      accepted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS events_by_time ON events(at);

    CREATE TABLE IF NOT EXISTS artifact_data (
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (artifact_id, scope, key)
    );
  `)
  // Additive migrations for databases created by earlier versions.
  const cols = db.prepare('PRAGMA table_info(artifacts)').all() as { name: string }[]
  if (!cols.some(c => c.name === 'pinned')) db.exec('ALTER TABLE artifacts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0')
  if (!cols.some(c => c.name === 'opened_at')) db.exec('ALTER TABLE artifacts ADD COLUMN opened_at TEXT')
  if (!cols.some(c => c.name === 'kind')) db.exec("ALTER TABLE artifacts ADD COLUMN kind TEXT NOT NULL DEFAULT 'artifact'")
  if (!cols.some(c => c.name === 'archived_at')) db.exec('ALTER TABLE artifacts ADD COLUMN archived_at TEXT')
  if (!cols.some(c => c.name === 'opens')) db.exec('ALTER TABLE artifacts ADD COLUMN opens INTEGER NOT NULL DEFAULT 0')
  // OAuth codes and tokens belong to the member who approved them, with the scopes they chose.
  for (const t of ['oauth_codes', 'oauth_tokens']) {
    const c = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]
    if (!c.some(x => x.name === 'user_id')) db.exec(`ALTER TABLE ${t} ADD COLUMN user_id TEXT`)
    if (!c.some(x => x.name === 'scope')) db.exec(`ALTER TABLE ${t} ADD COLUMN scope TEXT NOT NULL DEFAULT 'read'`)
  }
  const tc = db.prepare('PRAGMA table_info(oauth_tokens)').all() as { name: string }[]
  if (!tc.some(x => x.name === 'created_at')) db.exec('ALTER TABLE oauth_tokens ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0')
  if (!tc.some(x => x.name === 'last_used')) db.exec('ALTER TABLE oauth_tokens ADD COLUMN last_used INTEGER')
  ensureWorkspaceSchema(db)
  ensureImportSchema(db)
  return db
}

export const now = () => new Date().toISOString()
