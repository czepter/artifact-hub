import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { useDb, now } from './db'
import { getArtifact, publish } from './store'
import { resolveWorkspaceId } from './workspaces'
import { memberById } from './betterAuth'
import { convertSource, ImportError, IMPORT_LIMITS, type Converted } from './importConvert'

// Import of pages saved from claude.ai. The agent never carries file content: `request_import` returns a one-time upload
// link, the file goes there with curl, and the answer is a report. `import_sources` is the idempotence key (source_url);
// `import_requests` is the log of every request and its outcome, which is what list_imports reports.

export const LINK_TTL_MS = 60 * 60 * 1000
export type ImportStatus = 'imported' | 'skipped' | 'failed'

export interface ImportReport {
  source: string, source_version: string, dry_run: boolean
  status: ImportStatus
  /** For status "imported": whether this created an artifact or added a version to the one imported earlier. */
  action?: 'created' | 'updated'
  reason?: string
  artifact_id?: string, hub_url?: string, hub_version?: number
  kind?: 'canvas' | 'page', boards?: number, notes?: number, files?: number
  warnings: string[], dropped?: string[]
}

export function ensureImportSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_sources (
      source_url TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      source_version TEXT NOT NULL,
      hub_version INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS import_requests (
      token_hash TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_version TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at TEXT,
      status TEXT,
      report TEXT
    );
    CREATE INDEX IF NOT EXISTS import_requests_by_member ON import_requests(member_id, created_at);
  `)
}

const bad = (statusCode: number, m: string) => createError({ statusCode, statusMessage: m })
const hash = (t: string) => createHash('sha256').update(t).digest('hex')
interface SourceRow { source_url: string, artifact_id: string, source_version: string, hub_version: number }
const sourceRow = (url: string) => useDb().prepare('SELECT * FROM import_sources WHERE source_url = ?').get(url) as SourceRow | undefined

function cleanSource(url: unknown, version: unknown) {
  const u = typeof url === 'string' ? url.trim() : ''
  const v = typeof version === 'string' || typeof version === 'number' ? String(version).trim() : ''
  if (!u || u.length > 2000) throw bad(400, 'source_url is required (at most 2000 characters)')
  if (!v || v.length > 200) throw bad(400, 'source_version is required (at most 200 characters)')
  return { u, v }
}

function record(tokenHash: string | null, req: { member_id: string, source_url: string, source_version: string, workspace_id: string, dry_run: boolean }, report: ImportReport) {
  const t = now()
  if (tokenHash) {
    useDb().prepare('UPDATE import_requests SET used_at = COALESCE(used_at, ?), status = ?, report = ? WHERE token_hash = ?').run(t, report.status, JSON.stringify(report), tokenHash)
  } else {
    // A request answered without a link (already imported): logged as a finished row.
    useDb().prepare('INSERT INTO import_requests (token_hash, member_id, source_url, source_version, workspace_id, dry_run, created_at, expires_at, used_at, status, report) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
      .run(hash(randomBytes(16).toString('hex')), req.member_id, req.source_url, req.source_version, req.workspace_id, req.dry_run ? 1 : 0, t, t, report.status, JSON.stringify(report))
  }
}

/** Issues a one-time upload link, or, when this exact source version is already in the hub, answers "skipped" without one. */
export function requestImport(member: { id: string }, input: { source_url: unknown, source_version: unknown, workspace?: string, dry_run?: boolean }, origin: string):
  { upload_url: string, method: 'PUT', expires_at: string, max_bytes: number, curl: string } | { skipped: ImportReport } {
  const { u, v } = cleanSource(input.source_url, input.source_version)
  const workspace_id = resolveWorkspaceId(input.workspace)
  const dry_run = !!input.dry_run
  const done = sourceRow(u)
  if (done && done.source_version === v && getArtifact(done.artifact_id)) {
    const report: ImportReport = { source: u, source_version: v, dry_run, status: 'skipped', reason: `Version ${v} is already imported`, artifact_id: done.artifact_id, hub_url: `${origin}/a/${done.artifact_id}`, hub_version: done.hub_version, warnings: [] }
    record(null, { member_id: member.id, source_url: u, source_version: v, workspace_id, dry_run }, report)
    return { skipped: report }
  }
  const token = 'imp_' + randomBytes(32).toString('base64url')
  const expires = Date.now() + LINK_TTL_MS
  useDb().prepare('INSERT INTO import_requests (token_hash, member_id, source_url, source_version, workspace_id, dry_run, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(hash(token), member.id, u, v, workspace_id, dry_run ? 1 : 0, now(), expires)
  const upload_url = `${origin}/api/import/upload/${token}`
  return { upload_url, method: 'PUT', expires_at: new Date(expires).toISOString(), max_bytes: IMPORT_LIMITS.sourceBytes, curl: `curl -sS -X PUT --data-binary @<file> '${upload_url}'` }
}

interface RequestRow { token_hash: string, member_id: string, source_url: string, source_version: string, workspace_id: string, dry_run: number, expires_at: number, used_at: string | null }

/** Checks a link without using it up. Unknown, used and expired links all answer 404/410 without saying which artifact they were for. */
export function peekUpload(token: string): RequestRow {
  const row = token.startsWith('imp_') ? useDb().prepare('SELECT * FROM import_requests WHERE token_hash = ?').get(hash(token)) as RequestRow | undefined : undefined
  if (!row) throw bad(404, 'Not found')
  if (row.used_at) throw bad(410, 'This upload link was already used')
  if (row.expires_at < Date.now()) throw bad(410, 'This upload link has expired')
  return row
}

/** Uses the link up (exactly one caller wins), converts the page and, unless it is a dry run, publishes it. */
export function runUpload(token: string, body: Buffer, origin: string): ImportReport {
  const row = peekUpload(token)
  const tokenHash = row.token_hash
  const used = useDb().prepare('UPDATE import_requests SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').run(now(), tokenHash, Date.now())
  if (used.changes !== 1) throw bad(410, 'This upload link was already used')

  const req = { member_id: row.member_id, source_url: row.source_url, source_version: row.source_version, workspace_id: row.workspace_id, dry_run: !!row.dry_run }
  const base: ImportReport = { source: row.source_url, source_version: row.source_version, dry_run: req.dry_run, status: 'failed', warnings: [] }
  const fail = (reason: string, extra: Partial<ImportReport> = {}) => {
    const r: ImportReport = { ...base, ...extra, status: 'failed', reason }
    record(tokenHash, req, r)
    return r
  }

  const member = memberById(row.member_id)
  if (!member || (member.role !== 'owner' && member.role !== 'editor')) return fail('The account that requested this link may no longer import')
  if (body.length > IMPORT_LIMITS.sourceBytes) return fail(`The file is larger than ${IMPORT_LIMITS.sourceBytes / 1024 / 1024} MB`)

  let c: Converted
  try { c = convertSource(body.toString('utf8'), row.source_url) } catch (e) {
    return fail(e instanceof ImportError ? e.message : `Unexpected error while reading the page: ${(e as Error).message}`)
  }
  const shape = { kind: c.kind, boards: c.boards, notes: c.notes, files: c.files.length, warnings: c.warnings, dropped: c.dropped }

  const done = sourceRow(row.source_url)
  const existing = done && getArtifact(done.artifact_id)
  if (done && existing && done.source_version === row.source_version) {
    const r: ImportReport = { ...base, ...shape, status: 'skipped', reason: `Version ${row.source_version} is already imported`, artifact_id: done.artifact_id, hub_url: `${origin}/a/${done.artifact_id}`, hub_version: done.hub_version }
    record(tokenHash, req, r)
    return r
  }
  const action = done && existing ? 'updated' : 'created'
  if (req.dry_run) {
    const r: ImportReport = { ...base, ...shape, status: 'imported', action, ...(existing ? { artifact_id: existing.id, hub_url: `${origin}/a/${existing.id}` } : {}) }
    record(tokenHash, req, r)
    return r
  }

  try {
    const remember = (artifactId: string, version: number) => {
      useDb().prepare('INSERT INTO import_sources (source_url, artifact_id, source_version, hub_version, imported_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_url) DO UPDATE SET artifact_id = excluded.artifact_id, source_version = excluded.source_version, hub_version = excluded.hub_version, imported_at = excluded.imported_at')
        .run(row.source_url, artifactId, row.source_version, version, now())
    }
    // Ledger and artifact commit together (publish runs `remember` before its COMMIT): an import is whole or absent.
    const p = publish({
      id: action === 'updated' ? existing!.id : null,
      baseVersion: existing?.current_version,
      title: c.title, files: c.files, replace: true, label: `Import ${row.source_version}`.slice(0, 60),
      workspaceId: row.workspace_id, inTransaction: remember,
    })
    const r: ImportReport = { ...base, ...shape, status: 'imported', action, artifact_id: p.id, hub_url: `${origin}/a/${p.id}`, hub_version: p.version }
    record(tokenHash, req, r)
    return r
  } catch (e) {
    const m = (e as { statusMessage?: string }).statusMessage ?? (e as Error).message
    return fail(`Not imported: ${m}`, shape)
  }
}

export interface ImportListRow { source: string, source_version: string, status: string, action?: string, reason?: string, hub_url?: string, boards?: number, warnings: string[], dry_run: boolean, requested_at: string }

/** Every import request of this member, newest first, as one row per source (the latest request wins). */
export function listImports(memberId: string, opts: { status?: string, limit?: number } = {}): { counts: Record<string, number>, rows: ImportListRow[] } {
  const rows = useDb().prepare('SELECT source_url, source_version, dry_run, created_at, expires_at, used_at, status, report FROM import_requests WHERE member_id = ? ORDER BY created_at DESC, rowid DESC').all(memberId) as
    { source_url: string, source_version: string, dry_run: number, created_at: string, expires_at: number, used_at: string | null, status: string | null, report: string | null }[]
  const seen = new Set<string>()
  const out: ImportListRow[] = []
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const key = `${r.source_url}\n${r.dry_run}`
    if (seen.has(key)) continue
    seen.add(key)
    const rep = r.report ? JSON.parse(r.report) as ImportReport : null
    const status = rep?.status ?? (r.expires_at < Date.now() ? 'expired' : 'pending')
    counts[`${r.dry_run ? 'dry_run_' : ''}${status}`] = (counts[`${r.dry_run ? 'dry_run_' : ''}${status}`] ?? 0) + 1
    if (opts.status && opts.status !== status) continue
    out.push({ source: r.source_url, source_version: r.source_version, status, action: rep?.action, reason: rep?.reason, hub_url: rep?.hub_url, boards: rep?.boards, warnings: rep?.warnings ?? [], dry_run: !!r.dry_run, requested_at: r.created_at })
  }
  return { counts, rows: out.slice(0, opts.limit ?? 300) }
}
