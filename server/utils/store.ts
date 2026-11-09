import { warmThumbs } from './render/thumb'
import { randomUUID, randomBytes } from 'node:crypto'
import { logEvent } from './events'
import { useDb, now } from './db'
import { emitArtifact } from './bus'
import { resolveWorkspaceId } from './workspaces'
import { referencedSharedFiles, sharedPublished } from './sharedFiles'

export const LIMITS = { fileBytes: 5 * 1024 * 1024, versionBytes: 20 * 1024 * 1024, files: 500 }

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf',
}

export function contentTypeFor(path: string) {
  return TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

export function cleanPath(raw: string): string {
  const p = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p || p.length > 300 || p.split('/').some(s => s === '..' || s === '.' || s === '')) {
    throw createError({ statusCode: 400, statusMessage: `Invalid file path: ${raw}` })
  }
  return p
}

export interface FileInput { path: string, content: string, encoding?: 'utf8' | 'base64' }

export interface ArtifactRow {
  id: string, title: string, current_version: number, pinned: number, created_at: string, updated_at: string, opened_at: string | null, opens: number, workspace_id: string, kind: 'artifact' | 'shared', archived_at: string | null
}

/** `workspaceId` (an id, see resolveWorkspaceId) limits the list to one workspace. */
export function listArtifacts(workspaceId?: string, includeShared = false, archived: 'hide' | 'only' | 'all' = 'hide'): ArtifactRow[] {
  const where = [
    workspaceId ? 'workspace_id = ?' : '',
    includeShared ? '' : "kind = 'artifact'",
    archived === 'hide' ? 'archived_at IS NULL' : archived === 'only' ? 'archived_at IS NOT NULL' : '',
  ].filter(Boolean)
  const q = `SELECT * FROM artifacts${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${archived === 'only' ? 'archived_at DESC' : 'pinned DESC, updated_at DESC'}`
  return useDb().prepare(q).all(...(workspaceId ? [workspaceId] : [])) as unknown as ArtifactRow[]
}

export function getArtifact(id: string): ArtifactRow | undefined {
  return useDb().prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as unknown as ArtifactRow | undefined
}

export function requireArtifact(id: string): ArtifactRow {
  const a = getArtifact(id)
  if (!a) throw createError({ statusCode: 404, statusMessage: 'Artifact not found' })
  return a
}

export function listFiles(id: string, version: number) {
  return useDb()
    .prepare('SELECT path, content_type, changed_in AS rev, length(content) AS size FROM files WHERE artifact_id = ? AND version = ? ORDER BY path')
    .all(id, version) as unknown as { path: string, content_type: string, rev: number, size: number }[]
}

export function readFile(id: string, version: number, path: string) {
  const row = useDb()
    .prepare('SELECT content, content_type FROM files WHERE artifact_id = ? AND version = ? AND path = ?')
    .get(id, version, path) as { content: Uint8Array, content_type: string } | undefined
  return row ? { content: Buffer.from(row.content), contentType: row.content_type } : undefined
}

export function listVersions(id: string) {
  return useDb()
    .prepare('SELECT version, label, created_at FROM versions WHERE artifact_id = ? ORDER BY version DESC')
    .all(id) as unknown as { version: number, label: string | null, created_at: string }[]
}

/**
 * Publish a new version. `id` null creates the artifact. Patch semantics: files not named are
 * carried over from the previous version; `remove` drops paths. `baseVersion` must equal the
 * live version when updating, otherwise 409 (same contract as Claude's publish tools).
 */
export function publish(opts: {
  id?: string | null, title?: string, files?: FileInput[], remove?: string[],
  baseVersion?: number, label?: string, replace?: boolean, workspaceId?: string,
  /** Runs inside the publish transaction, just before it commits; if it throws, nothing is published. */
  inTransaction?: (id: string, version: number) => void,
}): { id: string, version: number } {
  const db = useDb()
  const files = opts.files ?? []
  if (files.length > LIMITS.files) throw createError({ statusCode: 413, statusMessage: 'Too many files' })

  const decoded = files.map((f) => {
    const buf = Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8')
    if (buf.length > LIMITS.fileBytes) throw createError({ statusCode: 413, statusMessage: `${f.path} exceeds ${LIMITS.fileBytes} bytes` })
    const path = cleanPath(f.path)
    if (path.startsWith('_shared/')) throw createError({ statusCode: 400, statusMessage: `${path}: the _shared/ folder is the workspace's shared files and cannot be published into an artifact` })
    return { path, buf, type: contentTypeFor(path) }
  })

  db.exec('BEGIN IMMEDIATE')
  try {
    let id = opts.id ?? null
    let prev = 0
    const t = now()
    if (id) {
      const a = requireArtifact(id)
      prev = a.current_version
      if (opts.baseVersion !== prev) {
        throw createError({ statusCode: 409, statusMessage: `Conflict: live version is ${prev}, base_version was ${opts.baseVersion ?? 'missing'}. Re-read and retry.` })
      }
    } else {
      if (!opts.title) throw createError({ statusCode: 400, statusMessage: 'title is required when creating' })
      id = randomUUID()
      db.prepare('INSERT INTO artifacts (id, title, current_version, created_at, updated_at, workspace_id) VALUES (?, ?, 0, ?, ?, ?)').run(id, opts.title, t, t, resolveWorkspaceId(opts.workspaceId))
    }
    const next = prev + 1
    db.prepare('INSERT INTO versions (artifact_id, version, label, created_at) VALUES (?, ?, ?, ?)').run(id, next, opts.label ?? null, t)

    if (prev > 0 && !opts.replace) {
      db.prepare('INSERT INTO files (artifact_id, version, path, content, content_type, changed_in) SELECT artifact_id, ?, path, content, content_type, changed_in FROM files WHERE artifact_id = ? AND version = ?').run(next, id, prev)
    }
    for (const p of opts.remove ?? []) {
      db.prepare('DELETE FROM files WHERE artifact_id = ? AND version = ? AND path = ?').run(id, next, cleanPath(p))
    }
    const put = db.prepare('INSERT OR REPLACE INTO files (artifact_id, version, path, content, content_type, changed_in) VALUES (?, ?, ?, ?, ?, ?)')
    for (const f of decoded) put.run(id, next, f.path, f.buf, f.type, next)

    const total = db.prepare('SELECT COALESCE(SUM(length(content)), 0) AS n, COUNT(*) AS c FROM files WHERE artifact_id = ? AND version = ?').get(id, next) as { n: number, c: number }
    if (total.n > LIMITS.versionBytes || total.c > LIMITS.files) throw createError({ statusCode: 413, statusMessage: 'Artifact too large' })
    if (next === 1 && !decoded.some(f => f.path === 'index.html' || f.path === 'canvas.json')) {
      throw createError({ statusCode: 400, statusMessage: 'A new artifact needs index.html or canvas.json' })
    }

    db.prepare('UPDATE artifacts SET current_version = ?, updated_at = ?, title = COALESCE(?, title) WHERE id = ?').run(next, t, opts.id ? (opts.title ?? null) : null, id)
    opts.inTransaction?.(id, next)
    db.exec('COMMIT')
    emitArtifact(id, { type: 'version', version: next })
    sharedPublished(id)
    void warmThumbs(id, next).catch(() => {})
    try { logEvent(next === 1 ? 'created' : 'published', `${(db.prepare('SELECT title FROM artifacts WHERE id = ?').get(id) as { title: string }).title} v${next}`) } catch { /* the log never blocks publishing */ }
    return { id, version: next }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export type TextEdit = { old_text: string, new_text: string }

/** Applies edits in order; each old_text must occur exactly once or nothing is applied. */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  for (const [i, e] of edits.entries()) {
    const n = text.split(e.old_text).length - 1
    if (n !== 1) throw createError({ statusCode: 422, statusMessage: `Edit ${i + 1}: old_text must occur exactly once, found ${n}. Nothing was published.` })
    text = text.replace(e.old_text, () => e.new_text)
  }
  return text
}

export function editFile(id: string, path: string, edits: TextEdit[], baseVersion: number, label?: string) {
  const a = requireArtifact(id)
  const file = readFile(id, a.current_version, cleanPath(path))
  if (!file) throw createError({ statusCode: 404, statusMessage: `No such file: ${path}` })
  return publish({ id, files: [{ path, content: applyTextEdits(file.content.toString('utf8'), edits) }], baseVersion, label })
}

// ---- shares -------------------------------------------------------------------------------

export function createShare(artifactId: string, role: 'view' | 'comment') {
  requireArtifact(artifactId)
  const token = randomBytes(18).toString('base64url')
  useDb().prepare('INSERT INTO shares (token, artifact_id, role, created_at) VALUES (?, ?, ?, ?)').run(token, artifactId, role, now())
  try { logEvent('shared', `${requireArtifact(artifactId).title} (${role} link)`) } catch { /* ignore */ }
  return token
}

export function getShare(token: string) {
  return useDb().prepare('SELECT * FROM shares WHERE token = ? AND revoked = 0').get(token) as unknown as
    { token: string, artifact_id: string, role: 'view' | 'comment' } | undefined
}

export function listShares(artifactId: string) {
  return useDb().prepare('SELECT token, role, revoked, created_at FROM shares WHERE artifact_id = ? ORDER BY created_at DESC').all(artifactId)
}

export function revokeShare(artifactId: string, token: string) {
  useDb().prepare('UPDATE shares SET revoked = 1 WHERE token = ? AND artifact_id = ?').run(token, artifactId)
  try { logEvent('unshared', requireArtifact(artifactId).title) } catch { /* ignore */ }
}

// ---- comments -----------------------------------------------------------------------------

export interface AttachmentMeta { id: string, name: string, mime: string, size: number }

export interface CommentRow {
  id: string, artifact_id: string, version: number, board: string | null, anchor: unknown,
  author_email: string, author_kind: 'person' | 'model', body: string, parent_id: string | null,
  resolved: number, created_at: string, attachments: AttachmentMeta[]
}

export const ATTACHMENT_LIMITS = { bytes: 10 * 1024 * 1024, perComment: 6 }
/** Only these are ever shown inline; everything else is served as a download. */
export const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif)$/

export function listComments(artifactId: string): CommentRow[] {
  const db = useDb()
  const rows = db.prepare('SELECT * FROM comments WHERE artifact_id = ? ORDER BY created_at').all(artifactId) as unknown as (Omit<CommentRow, 'attachments'> & { anchor: string | null })[]
  const files = db.prepare('SELECT id, comment_id, name, mime, size FROM comment_attachments WHERE artifact_id = ? AND comment_id IS NOT NULL ORDER BY created_at, rowid').all(artifactId) as unknown as (AttachmentMeta & { comment_id: string })[]
  const by = new Map<string, AttachmentMeta[]>()
  for (const f of files) by.set(f.comment_id, [...(by.get(f.comment_id) ?? []), { id: f.id, name: f.name, mime: f.mime, size: f.size }])
  return rows.map(r => ({ ...r, anchor: r.anchor ? JSON.parse(r.anchor) : null, attachments: by.get(r.id) ?? [] }))
}

/** Stages an upload; it belongs to no comment until addComment claims it. */
export function addAttachment(artifactId: string, name: string, mime: string, content: Buffer): AttachmentMeta {
  if (!content.length) throw createError({ statusCode: 400, statusMessage: 'Empty file' })
  if (content.length > ATTACHMENT_LIMITS.bytes) throw createError({ statusCode: 413, statusMessage: `File too large (max ${ATTACHMENT_LIMITS.bytes / 1024 / 1024} MB)` })
  const db = useDb()
  // Staged uploads that were never posted are dropped after an hour.
  db.prepare('DELETE FROM comment_attachments WHERE comment_id IS NULL AND created_at < ?').run(new Date(Date.now() - 3600_000).toISOString())
  const id = randomUUID()
  const clean = { name: name.replace(/[\u0000-\u001f\\/]/g, '_').slice(0, 120) || 'file', mime: mime.toLowerCase().split(';')[0]!.trim().slice(0, 100) || 'application/octet-stream' }
  db.prepare('INSERT INTO comment_attachments (id, artifact_id, comment_id, name, mime, size, content, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)')
    .run(id, artifactId, clean.name, clean.mime, content.length, content, now())
  return { id, name: clean.name, mime: clean.mime, size: content.length }
}

export function readAttachment(artifactId: string, id: string) {
  const row = useDb().prepare('SELECT name, mime, size, content FROM comment_attachments WHERE id = ? AND artifact_id = ?').get(id, artifactId) as { name: string, mime: string, size: number, content: Uint8Array } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  return { ...row, content: Buffer.from(row.content) }
}

export function addComment(c: {
  artifactId: string, version: number, board?: string | null, anchor?: unknown, email: string,
  kind: 'person' | 'model', body: string, parentId?: string | null, attachmentIds?: string[],
}) {
  const body = (c.body ?? '').trim()
  const attachmentIds = [...new Set(c.attachmentIds ?? [])]
  if (attachmentIds.length > ATTACHMENT_LIMITS.perComment) throw createError({ statusCode: 400, statusMessage: `At most ${ATTACHMENT_LIMITS.perComment} attachments per comment` })
  if ((!body && !attachmentIds.length) || body.length > 5000) throw createError({ statusCode: 400, statusMessage: 'Comment must be 1-5000 characters' })
  const db = useDb()
  let { version, board, anchor } = c
  if (c.parentId) {
    const parent = db.prepare('SELECT * FROM comments WHERE id = ? AND artifact_id = ?').get(c.parentId, c.artifactId) as { version: number, board: string | null, anchor: string | null, parent_id: string | null } | undefined
    if (!parent) throw createError({ statusCode: 404, statusMessage: 'Parent comment not found' })
    if (parent.parent_id) throw createError({ statusCode: 400, statusMessage: 'Reply to the thread root, not to a reply' })
    version = parent.version
    board = parent.board
    anchor = parent.anchor ? JSON.parse(parent.anchor) : null
  }
  const id = randomUUID()
  db.prepare('INSERT INTO comments (id, artifact_id, version, board, anchor, author_email, author_kind, body, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, c.artifactId, version, board ?? null, anchor ? JSON.stringify(anchor) : null, c.email, c.kind, body, c.parentId ?? null, now())
  if (attachmentIds.length) {
    const claim = db.prepare('UPDATE comment_attachments SET comment_id = ? WHERE id = ? AND artifact_id = ? AND comment_id IS NULL')
    for (const a of attachmentIds) {
      if (!claim.run(id, a, c.artifactId).changes) {
        db.prepare('DELETE FROM comments WHERE id = ?').run(id) // cascades the files already claimed
        throw createError({ statusCode: 400, statusMessage: 'An attachment expired. Paste it again.' })
      }
    }
  }
  emitArtifact(c.artifactId, { type: 'comments' })
  try { logEvent(c.parentId ? 'replied' : 'commented', (db.prepare('SELECT title FROM artifacts WHERE id = ?').get(c.artifactId) as { title: string }).title, c.kind === 'model' ? `Claude (${useEvent().context.member?.name ?? 'MCP'})` : c.email) } catch { /* ignore */ }
  return id
}

export function resolveComment(artifactId: string, id: string, resolved: boolean) {
  const r = useDb().prepare('UPDATE comments SET resolved = ? WHERE id = ? AND artifact_id = ? AND parent_id IS NULL').run(resolved ? 1 : 0, id, artifactId)
  if (!r.changes) throw createError({ statusCode: 404, statusMessage: 'Thread not found' })
  emitArtifact(artifactId, { type: 'comments' })
}

// ---- artifact data (the window.artifact storage) ------------------------------------------
// Not versioned: data survives republishing. Scopes: 'shared' (everyone) and 'u:<identity>' (one viewer).

export const DATA_LIMITS = { valueBytes: 256 * 1024, keyChars: 200, totalBytes: 20 * 1024 * 1024, keysPerScope: 5000, listMax: 1000 }

export interface DataRow { key: string, value: unknown, updatedAt: string, updatedBy: string }

function rowOut(r: { key: string, value: string, updated_at: string, updated_by: string }): DataRow {
  return { key: r.key, value: JSON.parse(r.value), updatedAt: r.updated_at, updatedBy: r.updated_by }
}

function cleanKey(key: unknown): string {
  if (typeof key !== 'string' || !key || key.length > DATA_LIMITS.keyChars) {
    throw createError({ statusCode: 400, statusMessage: `key must be a string of 1-${DATA_LIMITS.keyChars} characters` })
  }
  return key
}

export function dataGet(artifactId: string, scope: string, key: unknown): DataRow | null {
  const r = useDb().prepare('SELECT key, value, updated_at, updated_by FROM artifact_data WHERE artifact_id = ? AND scope = ? AND key = ?')
    .get(artifactId, scope, cleanKey(key)) as { key: string, value: string, updated_at: string, updated_by: string } | undefined
  return r ? rowOut(r) : null
}

export function dataList(artifactId: string, scope: string, prefix = ''): DataRow[] {
  const rows = useDb().prepare('SELECT key, value, updated_at, updated_by FROM artifact_data WHERE artifact_id = ? AND scope = ? AND substr(key, 1, ?) = ? ORDER BY key LIMIT ?')
    .all(artifactId, scope, prefix.length, prefix, DATA_LIMITS.listMax) as { key: string, value: string, updated_at: string, updated_by: string }[]
  return rows.map(rowOut)
}

export function dataSet(artifactId: string, scope: string, key: unknown, value: unknown, by: string) {
  const k = cleanKey(key)
  const json = value === undefined ? undefined : JSON.stringify(value)
  if (json === undefined) throw createError({ statusCode: 400, statusMessage: 'value must be JSON-serializable' })
  if (Buffer.byteLength(json) > DATA_LIMITS.valueBytes) throw createError({ statusCode: 413, statusMessage: `value exceeds ${DATA_LIMITS.valueBytes} bytes` })
  const db = useDb()
  const existing = db.prepare('SELECT length(key) + length(value) AS n FROM artifact_data WHERE artifact_id = ? AND scope = ? AND key = ?').get(artifactId, scope, k) as { n: number } | undefined
  const tot = db.prepare('SELECT COALESCE(SUM(length(key) + length(value)), 0) AS n, COUNT(*) AS c FROM artifact_data WHERE artifact_id = ?').get(artifactId) as { n: number, c: number }
  if (tot.n - (existing?.n ?? 0) + k.length + json.length > DATA_LIMITS.totalBytes) throw createError({ statusCode: 413, statusMessage: 'Artifact storage is full (20 MB)' })
  if (!existing) {
    const inScope = (db.prepare('SELECT COUNT(*) AS c FROM artifact_data WHERE artifact_id = ? AND scope = ?').get(artifactId, scope) as { c: number }).c
    if (inScope >= DATA_LIMITS.keysPerScope) throw createError({ statusCode: 413, statusMessage: `Too many keys (max ${DATA_LIMITS.keysPerScope} per scope)` })
  }
  db.prepare('INSERT INTO artifact_data (artifact_id, scope, key, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(artifact_id, scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .run(artifactId, scope, k, json, now(), by)
  if (scope === 'shared') emitArtifact(artifactId, { type: 'data', scope: 'shared', keys: [k] })
}

export function dataDelete(artifactId: string, scope: string, key: unknown) {
  const k = cleanKey(key)
  useDb().prepare('DELETE FROM artifact_data WHERE artifact_id = ? AND scope = ? AND key = ?').run(artifactId, scope, k)
  if (scope === 'shared') emitArtifact(artifactId, { type: 'data', scope: 'shared', keys: [k] })
}

// ---- artifact management (menu actions) ----------------------------------------------------

export function renameArtifact(id: string, title: string) {
  const t = title.trim()
  if (!t || t.length > 200) throw createError({ statusCode: 400, statusMessage: 'Title must be 1-200 characters' })
  requireArtifact(id)
  useDb().prepare('UPDATE artifacts SET title = ? WHERE id = ?').run(t, id)
  emitArtifact(id, { type: 'meta' })
}

export function setPinned(id: string, pinned: boolean) {
  requireArtifact(id)
  useDb().prepare('UPDATE artifacts SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
  emitArtifact(id, { type: 'meta' })
}

/** Archived artifacts drop out of lists, the dashboard and search-by-list; links, share links and comments keep working. */
export function setArchived(id: string, archived: boolean) {
  if (requireArtifact(id).kind === 'shared') throw createError({ statusCode: 409, statusMessage: "The workspace's shared files cannot be archived" })
  useDb().prepare('UPDATE artifacts SET archived_at = ? WHERE id = ?').run(archived ? now() : null, id)
  emitArtifact(id, { type: 'meta' })
  try { logEvent(archived ? 'archived' : 'unarchived', requireArtifact(id).title) } catch { /* the log never blocks */ }
}

export function deleteArtifact(id: string) {
  if (requireArtifact(id).kind === 'shared') throw createError({ statusCode: 409, statusMessage: "The workspace's shared files cannot be deleted. Remove the files instead." })
  // Cascades to versions, files, shares, comments and stored data.
  useDb().prepare('DELETE FROM artifacts WHERE id = ?').run(id)
}

/** Copies the live version's files into a new artifact. Comments, shares and stored data stay behind. */
export function duplicateArtifact(id: string) {
  const a = requireArtifact(id)
  if (a.kind === 'shared') throw createError({ statusCode: 409, statusMessage: "The workspace's shared files cannot be duplicated" })
  const files = listFiles(id, a.current_version).map((f) => {
    const file = readFile(id, a.current_version, f.path)!
    return { path: f.path, content: file.content.toString('base64'), encoding: 'base64' as const }
  })
  return publish({ title: `${a.title} (copy)`, files, label: `Copy of ${a.title}`.slice(0, 60), workspaceId: a.workspace_id })
}

export function exportFiles(id: string, version?: number) {
  const a = requireArtifact(id)
  const v = version ?? a.current_version
  const own = listFiles(id, v).map(f => ({ name: f.path, data: readFile(id, v, f.path)!.content }))
  // Boards that link `_shared/…` files keep working offline: the ones they point at travel in the zip.
  const shared = referencedSharedFiles(id, v).map(f => ({ name: f.path, data: f.content }))
  return { artifact: a, files: [...own, ...shared] }
}
