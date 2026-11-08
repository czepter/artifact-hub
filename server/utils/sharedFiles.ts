import type { DatabaseSync } from 'node:sqlite'
import { useDb } from './db'
import { logEvent } from './events'
import { emitArtifact } from './bus'
import { cleanPath, contentTypeFor, getArtifact, listFiles, publish, readFile, requireArtifact, type ArtifactRow } from './store'
import { getSettings, patchSettings, requireWorkspace } from './workspaces'
import { BOARD_PATH, emptyCanvas, type Canvas } from '../../shared/canvasOps'

/**
 * Shared files: a per-workspace library that every artifact (and so every board) in the workspace can use.
 * A board references a library file as `_shared/<path>` relative to the artifact root, e.g.
 * `<link rel="stylesheet" href="_shared/tokens.css">` (from a board in a subfolder: `../_shared/tokens.css`).
 * It is a live link, not a copy: change the file once and every board that uses it shows the new version.
 * Tokens (css custom properties), component styles, scripts, fonts and images all travel the same way.
 * The prefix is reserved: an artifact cannot publish files under it.
 *
 * The library is stored as one hidden artifact per workspace (`artifacts.kind = 'shared'`). Its live version's files are
 * the library, so it opens in the normal canvas viewer: HTML components are boards you can look at, comment on and edit,
 * and every save is a version you can undo. Saving through the dialog, the API or MCP all publish a version of it.
 */
export const SHARED_PREFIX = '_shared/'
export const SHARED_LIMITS = { fileBytes: 5 * 1024 * 1024, files: 200, totalBytes: 20 * 1024 * 1024 }
const CANVAS = 'canvas.json'

export interface SharedFile { path: string, contentType: string, size: number, rev: number, updatedAt: string, updatedBy: string, ref: string }

const bad = (m: string, code = 400) => createError({ statusCode: code, statusMessage: m })

/** Idempotent; called from ensureWorkspaceSchema. `workspace_files` is the pre-canvas storage: read once to migrate, never written. */
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
  const out = isSharedPath(p) ? cleanPath(p.slice(SHARED_PREFIX.length)) : p
  if (out === CANVAS) throw bad(`${CANVAS} is reserved for the library's canvas`)
  return out
}

const isHtml = (p: string) => /\.html?$/i.test(p)

/** A library board: where a new HTML file lands on the canvas (right of everything, components are small). */
function withBoard(canvas: Canvas, path: string): Canvas {
  if (canvas.boards[path] || !isHtml(path) || !BOARD_PATH.test(path)) return canvas
  const right = Object.values(canvas.boards).reduce((m, b) => Math.max(m, (+(b as any).x || 0) + (+(b as any).w || 0)), -120)
  canvas.boards[path] = { x: right + 120, y: 0, w: 640, h: 420, title: path.replace(/\.html?$/i, '') }
  canvas.order.push(path)
  return canvas
}

function readCanvas(artifactId: string, version: number): Canvas {
  const raw = readFile(artifactId, version, CANVAS)
  try {
    const c = raw ? JSON.parse(raw.content.toString('utf8')) as Canvas : emptyCanvas('Shared files')
    c.boards ??= {}; c.order ??= []; c.notes ??= {}
    return c
  } catch { return emptyCanvas('Shared files') }
}

/** The workspace's library artifact. Without `create`, a workspace that never had a library has none (and nothing is made); one that has legacy rows is migrated on first use. */
function libraryArtifact(workspaceId: string, create = false): ArtifactRow | undefined {
  const db = useDb()
  const find = () => db.prepare("SELECT * FROM artifacts WHERE workspace_id = ? AND kind = 'shared'").get(workspaceId) as unknown as ArtifactRow | undefined
  const found = find()
  if (found) return found
  const legacy = db.prepare('SELECT path, content, content_type FROM workspace_files WHERE workspace_id = ? ORDER BY path').all(workspaceId) as { path: string, content: Uint8Array, content_type: string }[]
  if (!create && !legacy.length) return undefined
  requireWorkspace(workspaceId)
  let canvas = emptyCanvas('Shared files')
  for (const f of legacy) canvas = withBoard(canvas, f.path)
  const made = publish({
    title: 'Shared files', workspaceId, label: legacy.length ? 'Migrated shared files' : 'Created',
    files: [{ path: CANVAS, content: JSON.stringify(canvas, null, 2) }, ...legacy.map(f => ({ path: f.path, content: Buffer.from(f.content).toString('base64'), encoding: 'base64' as const }))],
  })
  db.prepare("UPDATE artifacts SET kind = 'shared' WHERE id = ?").run(made.id)
  return find()
}

/** The library artifact's id, so the UI can open it as a canvas. `create` makes the library if the workspace has none yet. */
export function sharedArtifactId(workspaceId: string, create = false): string | null {
  return libraryArtifact(workspaceId, create)?.id ?? null
}

/** Who saved: dialog, API and MCP saves label their version `<who> · <path>`; edits made in the canvas have no such label. */
const savedBy = (label: string | null) => (label && label.includes(' · ') ? label.split(' · ')[0]! : '')

export function listSharedFiles(workspaceId: string): SharedFile[] {
  const a = libraryArtifact(workspaceId)
  if (!a) return []
  return (useDb().prepare(`
    SELECT f.path, f.content_type, length(f.content) AS size, f.changed_in, v.created_at, v.label
    FROM files f JOIN versions v ON v.artifact_id = f.artifact_id AND v.version = f.changed_in
    WHERE f.artifact_id = ? AND f.version = ? AND f.path <> ? ORDER BY f.path`).all(a.id, a.current_version, CANVAS) as unknown as
    { path: string, content_type: string, size: number, changed_in: number, created_at: string, label: string | null }[])
    .map(r => ({ path: r.path, contentType: r.content_type, size: r.size, rev: Math.max(1, r.changed_in - 1), updatedAt: r.created_at, updatedBy: savedBy(r.label), ref: SHARED_PREFIX + r.path }))
}

export function readSharedFile(workspaceId: string, path: string) {
  if (path === CANVAS) return undefined
  const a = libraryArtifact(workspaceId)
  return a ? readFile(a.id, a.current_version, path) : undefined
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

/**
 * Called after every published version of any artifact: when it is a library, open viewers of every other artifact in the
 * workspace refetch and reload their boards. Covers saves from the dialog, the API, MCP and edits made in the canvas.
 */
export function sharedPublished(artifactId: string) {
  const a = getArtifact(artifactId)
  if (!a || a.kind !== 'shared') return
  patchSettings(a.workspace_id, { sharedRev: sharedRev(a.workspace_id) + 1 })
  const ids = useDb().prepare('SELECT id FROM artifacts WHERE workspace_id = ? AND id <> ?').all(a.workspace_id, a.id) as { id: string }[]
  for (const { id } of ids) emitArtifact(id, { type: 'meta' })
}

export function putSharedFile(workspaceId: string, rawPath: unknown, content: Buffer, by: string): SharedFile {
  requireWorkspace(workspaceId)
  const path = cleanSharedPath(rawPath)
  if (content.length > SHARED_LIMITS.fileBytes) throw bad(`${path} exceeds ${SHARED_LIMITS.fileBytes} bytes`, 413)
  const a = libraryArtifact(workspaceId, true)!
  const files = listFiles(a.id, a.current_version).filter(f => f.path !== CANVAS)
  const cur = files.find(f => f.path === path)
  const total = files.reduce((n, f) => n + f.size, 0)
  if (!cur && files.length >= SHARED_LIMITS.files) throw bad(`A workspace holds at most ${SHARED_LIMITS.files} shared files`, 413)
  if (total - (cur?.size ?? 0) + content.length > SHARED_LIMITS.totalBytes) throw bad('Shared files are full (20 MB per workspace)', 413)
  const same = cur && readFile(a.id, a.current_version, path)?.content.equals(content)
  if (!same) {
    const canvas = withBoard(readCanvas(a.id, a.current_version), path)
    publish({
      id: a.id, baseVersion: a.current_version, label: `${by} · ${path}`.slice(0, 60),
      files: [{ path: CANVAS, content: JSON.stringify(canvas, null, 2) }, { path, content: content.toString('base64'), encoding: 'base64' }],
    })
    try { logEvent('shared file saved', `${requireWorkspace(workspaceId).name}: ${path}`) } catch { /* the log never blocks */ }
  }
  return listSharedFiles(workspaceId).find(f => f.path === path)!
}

export function deleteSharedFile(workspaceId: string, rawPath: unknown) {
  const path = cleanSharedPath(rawPath)
  const a = libraryArtifact(workspaceId)
  if (!a || !listFiles(a.id, a.current_version).some(f => f.path === path)) throw bad(`No such shared file: ${path}`, 404)
  const canvas = readCanvas(a.id, a.current_version)
  delete canvas.boards[path]
  canvas.order = canvas.order.filter(p => p !== path)
  publish({ id: a.id, baseVersion: a.current_version, label: `Removed ${path}`.slice(0, 60), files: [{ path: CANVAS, content: JSON.stringify(canvas, null, 2) }], remove: [path] })
  try { logEvent('shared file removed', `${requireWorkspace(workspaceId).name}: ${path}`) } catch { /* ignore */ }
}

/** Copies files of an artifact's live version into its workspace's library (`as` renames); the artifact's own copies stay. */
export function shareArtifactFiles(artifactId: string, items: { path: string, as?: string }[], by: string): SharedFile[] {
  const a = requireArtifact(artifactId)
  if (a.kind === 'shared') throw bad("These already are the workspace's shared files")
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
