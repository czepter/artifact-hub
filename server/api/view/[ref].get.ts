import { resolveAccess, signFrameToken } from '../../utils/auth'
import { sharedRevOfArtifact } from '../../utils/sharedFiles'
import { flowOf, type FlowEdge } from '../../../shared/protoFlow'
import { listComments, listFiles, listVersions, readFile, requireArtifact } from '../../utils/store'

export interface Board { x: number, y: number, w: number, h: number, title?: string, expand?: string, is_interactive?: boolean }

export default defineEventHandler((event) => {
  const access = resolveAccess(event, getRouterParam(event, 'ref')!)
  const artifact = requireArtifact(access.artifactId)
  const q = getQuery(event)
  const version = q.v ? Number(q.v) : artifact.current_version
  const files = listFiles(artifact.id, version)

  let canvas: Record<string, unknown> | null = null
  const raw = readFile(artifact.id, version, 'canvas.json')
  if (raw) {
    try { canvas = JSON.parse(raw.content.toString('utf8')) } catch { canvas = null }
  }

  // Links between boards (click-dummy flow), read from the boards' attributes.
  const flow: FlowEdge[] = []
  const boardPaths = canvas?.boards && typeof canvas.boards === 'object' ? Object.keys(canvas.boards as object) : []
  if (boardPaths.length > 1) {
    const set = new Set(boardPaths)
    for (const path of boardPaths) {
      const f = readFile(artifact.id, version, path)
      if (f && f.content.length < 2_000_000) flow.push(...flowOf(path, f.content.toString('utf8'), set))
    }
  }

  // Frame URL base: share links reuse their own token, the owner gets a signed short-lived one.
  const ref = access.shareToken ?? signFrameToken(artifact.id)
  return {
    artifact: { id: artifact.id, title: artifact.title, version, live: artifact.current_version, updatedAt: artifact.updated_at, pinned: !!artifact.pinned, workspaceId: artifact.workspace_id, kind: artifact.kind, archived: !!artifact.archived_at },
    versions: listVersions(artifact.id),
    role: access.role,
    email: access.email,
    canvas,
    flow,
    files: files.map(f => ({ path: f.path, rev: f.rev })),
    sharedRev: sharedRevOfArtifact(artifact.id),
    frameBase: `/f/${ref}@${version}/`,
    thumbBase: `/api/view/${access.shareToken ?? artifact.id}/thumb?v=${version}&path=`,
    comments: listComments(artifact.id),
  }
})
