import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { useDb, now } from './db'
import { logEvent } from './events'
import { emitArtifact } from './bus'

/**
 * Workspaces group artifacts. Every artifact belongs to exactly one; the auto-created default workspace
 * (id `default`) holds everything that predates workspaces and anything created without naming one.
 *
 * Extension point: `settings` is a JSON object owned by the workspace. Design tokens and a component library
 * are meant to live under keys such as `settings.tokens` and `settings.components` (or, when they outgrow a
 * JSON blob, in their own tables keyed by `workspace_id`). Nothing reads those keys yet; `getSettings` and
 * `patchSettings` are the only access path so the shape can change in one place.
 */
export const DEFAULT_WORKSPACE_ID = 'default'

export interface WorkspaceRow {
  id: string, name: string, description: string, color: string | null, icon: string | null,
  settings: string, is_default: number, created_at: string, updated_at: string,
}
export interface Workspace {
  id: string, name: string, description: string, color: string | null, icon: string | null,
  isDefault: boolean, artifactCount: number, createdAt: string, updatedAt: string,
}

/** Idempotent: creates the table, the default workspace, and the artifacts.workspace_id column. Called from useDb(). */
export function ensureWorkspaceSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT,
      icon TEXT,
      settings TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workspaces_name ON workspaces(lower(name));
    CREATE UNIQUE INDEX IF NOT EXISTS workspaces_one_default ON workspaces(is_default) WHERE is_default = 1;
  `)
  const t = now()
  db.prepare("INSERT OR IGNORE INTO workspaces (id, name, is_default, created_at, updated_at) VALUES (?, 'General', 1, ?, ?)").run(DEFAULT_WORKSPACE_ID, t, t)
  // SQLite cannot add a REFERENCES column with a non-NULL default, so the link is enforced here (see deleteWorkspace/moveArtifact).
  const cols = db.prepare('PRAGMA table_info(artifacts)').all() as { name: string }[]
  if (!cols.some(c => c.name === 'workspace_id')) db.exec(`ALTER TABLE artifacts ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ID}'`)
  db.exec('CREATE INDEX IF NOT EXISTS artifacts_by_workspace ON artifacts(workspace_id, updated_at)')
}

const bad = (m: string, code = 400) => createError({ statusCode: code, statusMessage: m })

function clean(input: { name?: unknown, description?: unknown, color?: unknown, icon?: unknown }, partial: boolean) {
  const out: { name?: string, description?: string, color?: string | null, icon?: string | null } = {}
  if (!partial || input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 60) throw bad('Name must be 1-60 characters')
    out.name = name
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string' || input.description.length > 500) throw bad('Description must be at most 500 characters')
    out.description = input.description.trim()
  }
  if (input.color !== undefined && input.color !== null && input.color !== '') {
    if (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color)) throw bad('Color must be #rrggbb')
    out.color = input.color.toLowerCase()
  } else if (input.color !== undefined) out.color = null
  if (input.icon !== undefined && input.icon !== null && input.icon !== '') {
    if (typeof input.icon !== 'string' || !/^[a-z0-9-]{1,40}$/.test(input.icon)) throw bad('Icon must be a lucide icon name such as "folder"')
    out.icon = input.icon
  } else if (input.icon !== undefined) out.icon = null
  return out
}

const toWorkspace = (r: WorkspaceRow & { n: number }): Workspace => ({
  id: r.id, name: r.name, description: r.description, color: r.color, icon: r.icon,
  isDefault: !!r.is_default, artifactCount: r.n, createdAt: r.created_at, updatedAt: r.updated_at,
})

export function listWorkspaces(): Workspace[] {
  const rows = useDb().prepare(`
    SELECT w.*, (SELECT COUNT(*) FROM artifacts a WHERE a.workspace_id = w.id) AS n
    FROM workspaces w ORDER BY w.is_default DESC, lower(w.name)`).all() as unknown as (WorkspaceRow & { n: number })[]
  return rows.map(toWorkspace)
}

export function getWorkspace(id: string): Workspace | undefined {
  const r = useDb().prepare('SELECT w.*, (SELECT COUNT(*) FROM artifacts a WHERE a.workspace_id = w.id) AS n FROM workspaces w WHERE w.id = ?').get(id) as unknown as (WorkspaceRow & { n: number }) | undefined
  return r && toWorkspace(r)
}

export function requireWorkspace(id: string): Workspace {
  const w = getWorkspace(id)
  if (!w) throw bad('Workspace not found', 404)
  return w
}

/** Accepts a workspace id or its name (case-insensitive); nothing means the default workspace. */
export function resolveWorkspaceId(ref?: string | null): string {
  if (!ref) return DEFAULT_WORKSPACE_ID
  const r = useDb().prepare('SELECT id FROM workspaces WHERE id = ? OR lower(name) = lower(?) ORDER BY id = ? DESC').get(ref, ref, ref) as { id: string } | undefined
  if (!r) throw bad(`No such workspace: ${ref}`, 404)
  return r.id
}

function nameTaken(name: string, exceptId?: string) {
  const r = useDb().prepare('SELECT id FROM workspaces WHERE lower(name) = lower(?)').get(name) as { id: string } | undefined
  return !!r && r.id !== exceptId
}

export function createWorkspace(input: { name?: unknown, description?: unknown, color?: unknown, icon?: unknown }): Workspace {
  const v = clean(input, false)
  if (nameTaken(v.name!)) throw bad('A workspace with that name already exists', 409)
  const id = randomUUID()
  const t = now()
  useDb().prepare('INSERT INTO workspaces (id, name, description, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, v.name!, v.description ?? '', v.color ?? null, v.icon ?? null, t, t)
  try { logEvent('workspace created', v.name!) } catch { /* the log never blocks */ }
  return requireWorkspace(id)
}

export function updateWorkspace(id: string, input: { name?: unknown, description?: unknown, color?: unknown, icon?: unknown }): Workspace {
  const cur = requireWorkspace(id)
  const v = clean(input, true)
  if (v.name !== undefined && nameTaken(v.name, id)) throw bad('A workspace with that name already exists', 409)
  useDb().prepare('UPDATE workspaces SET name = ?, description = ?, color = ?, icon = ?, updated_at = ? WHERE id = ?').run(
    v.name ?? cur.name, v.description ?? cur.description,
    v.color !== undefined ? v.color : cur.color, v.icon !== undefined ? v.icon : cur.icon, now(), id,
  )
  return requireWorkspace(id)
}

/** Refused while the workspace holds artifacts (move them first) and for the default workspace. */
export function deleteWorkspace(id: string) {
  const w = requireWorkspace(id)
  if (w.isDefault) throw bad('The default workspace cannot be deleted', 409)
  if (w.artifactCount > 0) {
    throw bad(`“${w.name}” still holds ${w.artifactCount} artifact${w.artifactCount === 1 ? '' : 's'}. Move them to another workspace first.`, 409)
  }
  useDb().prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  try { logEvent('workspace deleted', w.name) } catch { /* ignore */ }
}

export function moveArtifact(artifactId: string, workspaceRef: string) {
  const target = requireWorkspace(resolveWorkspaceId(workspaceRef))
  const r = useDb().prepare('UPDATE artifacts SET workspace_id = ? WHERE id = ?').run(target.id, artifactId)
  if (!r.changes) throw bad('Artifact not found', 404)
  emitArtifact(artifactId, { type: 'meta' })
  return target
}

export function getWorkspaceOf(artifactId: string): { id: string, name: string } | undefined {
  return useDb().prepare('SELECT w.id, w.name FROM artifacts a JOIN workspaces w ON w.id = a.workspace_id WHERE a.id = ?').get(artifactId) as { id: string, name: string } | undefined
}

// ---- settings (room for per-workspace design tokens and component library; not used yet) ----

export function getSettings(id: string): Record<string, unknown> {
  requireWorkspace(id)
  const r = useDb().prepare('SELECT settings FROM workspaces WHERE id = ?').get(id) as { settings: string }
  try { return JSON.parse(r.settings) } catch { return {} }
}

export function patchSettings(id: string, patch: Record<string, unknown>) {
  const next = { ...getSettings(id), ...patch }
  useDb().prepare('UPDATE workspaces SET settings = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), now(), id)
  return next
}
