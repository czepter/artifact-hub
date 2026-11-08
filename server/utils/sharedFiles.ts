import type { DatabaseSync } from 'node:sqlite'
import { useDb, now } from './db'
import { logEvent } from './events'
import { emitArtifact } from './bus'
import { cleanPath, contentTypeFor, listFiles, readFile, requireArtifact } from './store'
import { getSettings, patchSettings, requireWorkspace } from './workspaces'

/**
 * Shared files: a per-workspace library that every artifact (and so every board) in the workspace can use.
 * A board references a library file as `_shared/<path>` relative to the artifact root, e.g.
 * `<link rel="stylesheet" href="_shared/tokens.css">` (from a board in a subfolder: `../_shared/tokens.css`).
 * It is a live link, not a copy: change the file once and every board that uses it shows the new version.
 * Tokens (css custom properties), component styles, scripts, fonts and images all travel the same way.
 * The prefix is reserved: an artifact cannot publish files under it.
 */
export const SHARED_PREFIX = '_shared/'
export const SHARED_LIMITS = { fileBytes: 5 * 1024 * 1024, files: 200, totalBytes: 20 * 1024 * 1024 }

export interface SharedFile { path: string, contentType: string, size: number, rev: number, updatedAt: string, updatedBy: string, ref: string }

const bad = (m: string, code = 400) => createError({ statusCode: code, statusMessage: m })

/** Idempotent; called from ensureWorkspaceSchema. Files go away with their workspace. */
export function ensureSharedFilesSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_files (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      content BLOB NOT NULL,
      content_type TEXT NOT NULL,
      rev INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (workspace_id, path)
    );
  `)
}

/** The `[...path]` route param, fully decoded (so an encoded `..%2F` is seen for what it is before cleanPath checks it). */
export function sharedPathParam(event: Parameters<typeof getRouterParam>[0]): string {
  const raw = getRouterParam(event, 'path') ?? ''
  try { return decodeURIComponent(raw) } catch { throw bad('Invalid path') }
}

export const isSharedPath = (p: string) => p.startsWith(SHARED_PREFIX)

/** `_shared/css/a.css` and `css/a.css` both mean the library path `css/a.css`. */
export function cleanSharedPath(raw: unknown): string {
  if (typeof raw !== 'string') throw bad('path must be a string')
  const p = cleanPath(raw)
  return isSharedPath(p) ? cleanPath(p.slice(SHARED_PREFIX.length)) : p
}

const toFile = (r: { path: string, content_type: string, size: number, rev: number, updated_at: string, updated_by: string }): SharedFile => ({
  path: r.path, contentType: r.content_type, size: r.size, rev: r.rev, updatedAt: r.updated_at, updatedBy: r.updated_by, ref: SHARED_PREFIX + r.path,
})

export function listSharedFiles(workspaceId: string): SharedFile[] {
  return (useDb().prepare('SELECT path, content_type, length(content) AS size, rev, updated_at, updated_by FROM workspace_files WHERE workspace_id = ? ORDER BY path')
    .all(workspaceId) as unknown as Parameters<typeof toFile>[0][]).map(toFile)
}

export function readSharedFile(workspaceId: string, path: string) {
  const row = useDb().prepare('SELECT content, content_type FROM workspace_files WHERE workspace_id = ? AND path = ?')
    .get(workspaceId, path) as { content: Uint8Array, content_type: string } | undefined
  return row ? { content: Buffer.from(row.content), contentType: row.content_type } : undefined
}

/** Changes whenever any shared file of the workspace is written or removed; it is part of frame URLs and picture keys. */
export function sharedRev(workspaceId: string): number {
  const v = getSettings(workspaceId).sharedRev
  return typeof v === 'number' ? v : 0
}

export function sharedRevOfArtifact(artifactId: string): number {
  const r = useDb().prepare('SELECT workspace_id FROM artifacts WHERE id = ?').get(artifactId) as { workspace_id: string } | undefined
  return r ? sharedRev(r.workspace_id) : 0
}

/** Open viewers of every artifact in the workspace refetch and reload their boards. */
function changed(workspaceId: string) {
  patchSettings(workspaceId, { sharedRev: sharedRev(workspaceId) + 1 })
  const ids = useDb().prepare('SELECT id FROM artifacts WHERE workspace_id = ?').all(workspaceId) as { id: string }[]
  for (const { id } of ids) emitArtifact(id, { type: 'meta' })
}

export function putSharedFile(workspaceId: string, rawPath: unknown, content: Buffer, by: string): SharedFile {
  requireWorkspace(workspaceId)
  const path = cleanSharedPath(rawPath)
  if (content.length > SHARED_LIMITS.fileBytes) throw bad(`${path} exceeds ${SHARED_LIMITS.fileBytes} bytes`, 413)
  const db = useDb()
  const cur = db.prepare('SELECT length(content) AS n, rev FROM workspace_files WHERE workspace_id = ? AND path = ?').get(workspaceId, path) as { n: number, rev: number } | undefined
  const tot = db.prepare('SELECT COALESCE(SUM(length(content)), 0) AS n, COUNT(*) AS c FROM workspace_files WHERE workspace_id = ?').get(workspaceId) as { n: number, c: number }
  if (!cur && tot.c >= SHARED_LIMITS.files) throw bad(`A workspace holds at most ${SHARED_LIMITS.files} shared files`, 413)
  if (tot.n - (cur?.n ?? 0) + content.length > SHARED_LIMITS.totalBytes) throw bad('Shared files are full (20 MB per workspace)', 413)
  db.prepare(`INSERT INTO workspace_files (workspace_id, path, content, content_type, rev, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(workspace_id, path) DO UPDATE SET content = excluded.content, content_type = excluded.content_type, rev = workspace_files.rev + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(workspaceId, path, content, contentTypeFor(path), now(), by)
  changed(workspaceId)
  try { logEvent('shared file saved', `${requireWorkspace(workspaceId).name}: ${path}`) } catch { /* the log never blocks */ }
  return listSharedFiles(workspaceId).find(f => f.path === path)!
}

export function deleteSharedFile(workspaceId: string, rawPath: unknown) {
  const path = cleanSharedPath(rawPath)
  const r = useDb().prepare('DELETE FROM workspace_files WHERE workspace_id = ? AND path = ?').run(workspaceId, path)
  if (!r.changes) throw bad(`No such shared file: ${path}`, 404)
  changed(workspaceId)
  try { logEvent('shared file removed', `${requireWorkspace(workspaceId).name}: ${path}`) } catch { /* ignore */ }
}

/** Copies files of an artifact's live version into its workspace's library (`as` renames); the artifact's own copies stay. */
export function shareArtifactFiles(artifactId: string, items: { path: string, as?: string }[], by: string): SharedFile[] {
  const a = requireArtifact(artifactId)
  if (!items.length) throw bad('Name at least one file')
  if (items.length > 50) throw bad('At most 50 files at once')
  const picked = items.map((it) => {
    const src = cleanPath(it.path)
    if (isSharedPath(src)) throw bad(`${src} already is a shared file`)
    if (src === 'canvas.json') throw bad('canvas.json belongs to this artifact and cannot be shared')
    const f = readFile(a.id, a.current_version, src)
    if (!f) throw bad(`No such file: ${src}`, 404)
    return { to: it.as ? cleanSharedPath(it.as) : src, f }
  })
  return picked.map(p => putSharedFile(a.workspace_id, p.to, p.f.content, by))
}

/** Like readFile, but `_shared/…` comes from the artifact's workspace. Everything that serves or draws artifact files goes through this. */
export function readServedFile(artifactId: string, version: number, path: string) {
  if (!isSharedPath(path)) return readFile(artifactId, version, path)
  const w = useDb().prepare('SELECT workspace_id FROM artifacts WHERE id = ?').get(artifactId) as { workspace_id: string } | undefined
  return w ? readSharedFile(w.workspace_id, path.slice(SHARED_PREFIX.length)) : undefined
}

/** The library files an artifact version actually points at (searching text files, following the library's own references). Used by the .zip export. */
export function referencedSharedFiles(artifactId: string, version: number): { path: string, content: Buffer }[] {
  const a = requireArtifact(artifactId)
  const lib = listSharedFiles(a.workspace_id)
  if (!lib.length) return []
  const texts: string[] = []
  for (const f of listFiles(artifactId, version)) {
    if (!/^(text\/|application\/json|image\/svg)/.test(f.content_type)) continue
    const file = readFile(artifactId, version, f.path)
    if (file) texts.push(file.content.toString('utf8'))
  }
  const out = new Map<string, Buffer>()
  for (let grew = true; grew;) {
    grew = false
    for (const l of lib) {
      if (out.has(l.path) || !texts.some(t => t.includes(l.ref))) continue
      const f = readSharedFile(a.workspace_id, l.path)
      if (!f) continue
      out.set(l.path, f.content)
      if (/^(text\/|image\/svg)/.test(f.contentType)) texts.push(f.content.toString('utf8'))
      grew = true
    }
  }
  return [...out].map(([path, content]) => ({ path: SHARED_PREFIX + path, content }))
}
