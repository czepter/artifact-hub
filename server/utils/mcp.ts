import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  dataDelete, dataGet, dataList, dataSet,
  addComment, createShare, editFile, getArtifact, listArtifacts, listComments, listFiles, listVersions,
  publish, readAttachment, readFile, requireArtifact, resolveComment, INLINE_IMAGE,
} from './store'
import { onArtifact } from './bus'
import { registerRenderTool } from './render/tool'
import { requireOwner } from './auth'
import { deleteSharedFile, listSharedFiles, putSharedFile, readServedFile, readSharedFile, shareArtifactFiles, cleanSharedPath, sharedRev, SHARED_PREFIX } from './sharedFiles'
import { transferBoards } from './transfer'
import { createWorkspace, deleteWorkspace, getWorkspaceOf, listWorkspaces, moveArtifact, resolveWorkspaceId, updateWorkspace } from './workspaces'

const GUIDE = `# Artifact Hub: how to publish

An artifact is a set of text/binary files, versioned. Every publish creates a new version; files you do not
name are carried over, and \`remove\` drops paths. Updating requires base_version = the live version
(409 on conflict: re-read and retry).

## Single page
Publish \`index.html\` (a full document or a fragment). It is shown in a sandboxed iframe (scripts allowed, no
same-origin access, no cookies). Relative paths to other files in the artifact work (css/site.css, img/a.png).

Links between views: a plain \`<a href="screens/Detail.html">\` to another board (path relative to the page, as in canvas.json) opens that board
in the viewer; a link to another file of the artifact loads it in the same frame; http(s) links open in a new tab. \`#anchor\` links scroll in place.
Dropdowns, tabs, toggles, forms and \`alert/confirm\` work as in any page (scripts run; state lives in the page or in artifact.shared/personal).
On a canvas a board is clicked through after a double-click (or in focus/present mode, where links navigate between boards).

## Canvas (several screens/boards on one pannable, zoomable surface)
Publish \`canvas.json\` plus one HTML file per board:
{
  "v": 3, "title": "My UI", "launch": { "view": "canvas" },
  "boards": { "screens/Home.html": { "x": 0, "y": 0, "w": 1440, "h": 900, "title": "Home", "is_interactive": true } },
  "order": ["screens/Home.html"],
  "notes": { "n1": { "x": 0, "y": -140, "w": 560, "text": "Context for reviewers", "size": "s" } }
}
- x/y/w/h are canvas coordinates in px; boards render at exactly w x h. Leave ~120px between boards.
- Each board is an HTML file (full document or fragment), self-contained or using relative assets.
- is_interactive: false boards are static previews until the viewer double-clicks into them.
- Edit one board or canvas.json with edit_file instead of republishing everything.

## Shared files (tokens, components, patterns across boards)
Every workspace has a library of shared files that all of its artifacts and boards can use. A board links a library file as
\`_shared/<path>\` relative to the artifact root: \`<link rel="stylesheet" href="_shared/tokens.css">\` (from a board in a subfolder
use \`../_shared/tokens.css\`; inside \`_shared/css/a.css\` an \`@import\` of a sibling is relative too). It is a live link, not a copy: edit the file
once with write_shared_files and every board that uses it changes (open viewers reload). Good candidates: design tokens as css custom properties,
component styles (buttons, cards, nav), small scripts, fonts, logos.
- list_shared_files / read_shared_file: see what exists before you write your own copy of a style.
- write_shared_files: create, replace or remove library files. share_file: promote files you already published in an artifact into its workspace's library.
- Rules: an artifact cannot publish its own files under \`_shared/\`; a library file lives in exactly one workspace, so moving an artifact to another workspace
  breaks its \`_shared/\` links unless that workspace has the same files. read_file on an artifact also reads \`_shared/…\` paths.
- Prefer one tokens file (\`_shared/tokens.css\`) that other shared css builds on, so a re-theme is a one-file change.

## Moving boards between artifacts
transfer_boards copies (or moves) boards from one artifact into another: pass \`id\` (source), \`target\`, optional \`boards\` (paths; omit for the whole canvas, notes
included) and \`mode\` copy|move. The boards' stylesheets, scripts, images and linked pages come along, boards keep their relative layout and land to the right of the
target's boards, taken names get a free one, and nothing existing in the target is overwritten (differing dependency files are kept as they are and reported in \`warnings\`).
Use shared files (above) for what both artifacts should keep in sync; a move leaves comments behind on the source.

## Interactivity: window.artifact
Every HTML page gets \`window.artifact\` (not available when the file is opened outside the viewer):
  const info = await artifact.ready;   // { viewer:{name,role,canWrite}, artifactId, version, live } or null
  await artifact.shared.set('poll/ada', { choice: 'A' });   // visible to everyone; persists across versions
  const mine = await artifact.personal.get('draft');        // private to the current viewer
  const rows = await artifact.shared.list('poll/');         // [{ key, value, updatedAt, updatedBy }]
  const off = artifact.shared.onChange(({ keys }) => refresh());   // live updates
Values are JSON, max 256 KB each, 20 MB per artifact. View-only links can read but not write; personal
storage needs a signed-in viewer (owner or commenter e-mail). Always handle ready === null and rejected calls.
The model reads and writes the shared scope with data_list, data_get, data_set, data_delete.

## Notes, shapes and tweaks in canvas.json
\`notes\` entries beyond text: sticky {kind:'sticky',x,y,w,h,text,fill}, text {kind:'text',x,y,w,text,size,bold,color}, rect/oval {x,y,w,h,fill,color},
line/arrow {x,y,w,h} (w and h may be negative: drawn from x,y to x+w,y+h), pen {x,y,points:[[dx,dy],…]} (drawn as a smooth curve),
image {kind:'image',x,y,w,h,src:'assets/<first 16 hex of the file's sha-256>.png'} (the file must be in the artifact: png, jpg, webp or gif up to 5 MB; people paste or drop pictures on the canvas in the viewer). fill is yellow, gray, red, orange, green, teal,
blue, purple, pink, none or a #rrggbb colour. A board entry may carry \`tweaks\`: {prop: value} for the levers a .dc.html board declares in data-props.

Optional canvas fields (all validated; omit them for the defaults):
- canvas \`noteOrder\`: ["n2","n1"] is the back-to-front stacking of notes. Without it notes stack in key order. \`order\` is unchanged: it is the present/focus sequence of boards.
- note and board \`locked\`: true (cannot be moved, resized or marquee-selected in the viewer) and \`group\`: "g1" (items sharing a group id select together).
- note styling: \`stroke\` (#rrggbb), \`strokeWidth\` (1-24), \`strokeStyle\` solid|dashed|dotted, \`fillStyle\` solid|hatch|cross (rect and oval with a fill: hatch and cross draw a sketch-style pattern), \`roundness\` sharp|round, and for line/arrow \`arrowStart\`/\`arrowEnd\` none|arrow|triangle|dot|bar.
- arrow \`bind\`: {"start":{"type":"note","id":"n1"},"end":{"type":"board","id":"screens/Home.html"}} attaches an end to a note or board; the viewer draws the end at the target's edge and follows it when it moves. Only arrows can be bound, to boards, rect, oval, sticky and text; targets must exist. A rect or oval may carry \`text\` (shown centred).
Limits: 1000 notes, 400 pen points per stroke, boards and notes at most 8000 px wide or high, 200 operations per edit.

## Looking at your work
render_artifact draws the live version (or \`version\`) as png/webp/jpeg (returned as an image), svg (vector, from canvas.json) or xml (structured scene). \`board\` renders one board. Use it after publishing to check layout; boards show as text outlines when the server has no headless browser (the \`boards\` field says which).

## Visual editor
The owner can edit boards in the viewer (select, retype text, change styles, add elements). Saved edits add \`data-hub-id\` attributes to elements: they are editor bookkeeping, keep them when you rewrite a file (the editor re-adds missing ones).

## Comments
People comment on the page; threads anchor to a board + element (CSS path + text fingerprint).
Comments can carry pasted images/files (the attachments field); fetch one with read_comment_attachment. Use read_comments to see open threads, wait_for_comments (long-poll, loop it) to react to new ones as they arrive, reply_comment to answer, resolve_comment when handled.
Comments belong to the version they were made on; the viewer re-locates them on newer versions.
`

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

const fileSchema = z.object({
  path: z.string().describe('Served path, e.g. index.html or screens/Home.html'),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).optional().describe('Use base64 for binary files such as images'),
})

const TOOL_SCOPE: Record<string, string> = {
  guide: 'read', list_shared_files: 'read', read_shared_file: 'read', render_artifact: 'read', list_workspaces: 'read', list_artifacts: 'read', get_artifact: 'read', read_file: 'read', read_comments: 'read', read_comment_attachment: 'read', wait_for_comments: 'read', data_list: 'read', data_get: 'read',
  reply_comment: 'comment', resolve_comment: 'comment',
  write_shared_files: 'write', transfer_boards: 'write', share_file: 'write', create_artifact: 'write', create_workspace: 'write', update_workspace: 'write', delete_workspace: 'write', move_artifact: 'write', publish_files: 'write', edit_file: 'write', data_set: 'write', data_delete: 'write',
  share_link: 'share',
}

/** `scopes` are what the grant allows; tools outside them are not offered at all. */
export function buildMcpServer(origin: string, scopes: string[] = []) {
  const server = new McpServer(
    { name: 'artifact-hub', version: '0.1.0' },
    { instructions: 'Publish, version and review visual artifacts and design canvases. Call guide first.' },
  )
  const register = server.registerTool.bind(server) as (name: string, ...rest: unknown[]) => unknown
  ;(server as unknown as { registerTool: unknown }).registerTool = (name: string, ...rest: unknown[]) =>
    scopes.includes(TOOL_SCOPE[name] ?? '') ? register(name, ...rest) : undefined

  server.registerTool('guide', { description: 'How to structure artifacts and canvases. Read before the first publish.' }, () => text(GUIDE))

  server.registerTool('list_workspaces', { description: 'List workspaces (groups of artifacts) with their artifact counts. Artifacts without a named workspace live in the default one.' }, () =>
    text(listWorkspaces()))

  server.registerTool('create_workspace', {
    description: 'Create a workspace to group artifacts. Names are unique (case-insensitive).',
    inputSchema: { name: z.string().min(1).max(60), description: z.string().max(500).optional(), color: z.string().optional().describe('#rrggbb') },
  }, ({ name, description, color }) => text(createWorkspace({ name, description, color })))

  server.registerTool('update_workspace', {
    description: 'Change a workspace (id or name): rename it, or set description, color (#rrggbb) or icon. Only the fields you pass change.',
    inputSchema: {
      workspace: z.string(), name: z.string().min(1).max(60).optional(), description: z.string().max(500).optional(),
      color: z.string().optional().describe('#rrggbb'), icon: z.string().optional(),
    },
  }, ({ workspace, ...fields }) => text(updateWorkspace(resolveWorkspaceId(workspace), fields)))

  server.registerTool('delete_workspace', {
    description: 'Delete an empty workspace (id or name; owner only). Refused while it holds artifacts (move_artifact them first) and for the default workspace.',
    inputSchema: { workspace: z.string() },
  }, ({ workspace }) => { requireOwner(useEvent()); deleteWorkspace(resolveWorkspaceId(workspace)); return text({ ok: true }) })

  server.registerTool('move_artifact', {
    description: 'Move an artifact to another workspace (id or name).',
    inputSchema: { id: z.string(), workspace: z.string() },
  }, ({ id, workspace }) => { requireArtifact(id); const w = moveArtifact(id, workspace); return text({ ok: true, workspace: { id: w.id, name: w.name } }) })

  server.registerTool('list_artifacts', {
    description: 'List artifacts, most recently updated first. Pass workspace (id or name) to list one workspace.',
    inputSchema: { workspace: z.string().optional() },
  }, ({ workspace }) =>
    text(listArtifacts(workspace ? resolveWorkspaceId(workspace) : undefined).map(a => ({
      id: a.id, title: a.title, version: a.current_version, updated_at: a.updated_at, workspace_id: a.workspace_id, url: `${origin}/a/${a.id}`,
    }))))

  server.registerTool('create_artifact', {
    description: 'Create an artifact (private to the owner). Needs index.html or canvas.json. Optional workspace (id or name; default workspace if omitted).',
    inputSchema: { title: z.string().min(1).max(200), files: z.array(fileSchema).min(1), label: z.string().max(60).optional(), workspace: z.string().optional() },
  }, ({ title, files, label, workspace }) => {
    const r = publish({ title, files, label, workspaceId: workspace })
    return text({ ...r, url: `${origin}/a/${r.id}` })
  })

  server.registerTool('get_artifact', {
    description: 'Current state: live version, files and versions. Read this before publishing to get base_version.',
    inputSchema: { id: z.string(), version: z.number().int().optional() },
  }, ({ id, version }) => {
    const a = requireArtifact(id)
    const v = version ?? a.current_version
    const canvas = readFile(id, v, 'canvas.json')?.content.toString('utf8')
    return text({
      id: a.id, title: a.title, workspace: getWorkspaceOf(a.id), live_version: a.current_version, version: v, url: `${origin}/a/${a.id}`,
      files: listFiles(id, v), shared_files: listSharedFiles(a.workspace_id).map(f => ({ ref: f.ref, size: f.size, content_type: f.contentType })), versions: listVersions(id), canvas_json: canvas ?? null,
    })
  })

  server.registerTool('list_shared_files', {
    description: 'List the shared files of a workspace (id or name; default workspace if omitted): the library every artifact in it can link as `_shared/<path>`.',
    inputSchema: { workspace: z.string().optional() },
  }, ({ workspace }) => {
    const ws = resolveWorkspaceId(workspace)
    return text({ workspace_id: ws, rev: sharedRev(ws), files: listSharedFiles(ws).map(f => ({ ref: f.ref, path: f.path, size: f.size, content_type: f.contentType, updated_at: f.updatedAt, updated_by: f.updatedBy })) })
  })

  server.registerTool('read_shared_file', {
    description: 'Read one text shared file of a workspace.',
    inputSchema: { workspace: z.string().optional(), path: z.string().describe('With or without the `_shared/` prefix') },
  }, ({ workspace, path }) => {
    const f = readSharedFile(resolveWorkspaceId(workspace), cleanSharedPath(path))
    if (!f) throw new Error(`No such shared file: ${path}`)
    if (!/^(text\/|application\/json|image\/svg)/.test(f.contentType)) return text(`(${f.contentType}, ${f.content.length} bytes, not shown)`)
    return text(f.content.toString('utf8'))
  })

  server.registerTool('write_shared_files', {
    description: 'Create or replace shared files of a workspace, and/or remove some. Boards linking `_shared/<path>` change immediately; removing a file breaks the boards that still link it.',
    inputSchema: { workspace: z.string().optional(), files: z.array(fileSchema).default([]), remove: z.array(z.string()).optional() },
  }, ({ workspace, files, remove }) => {
    const ws = resolveWorkspaceId(workspace)
    const written = files.map(f => putSharedFile(ws, f.path, Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8'), 'claude').ref)
    for (const p of remove ?? []) deleteSharedFile(ws, p)
    return text({ ok: true, written, removed: (remove ?? []).map(p => SHARED_PREFIX + cleanSharedPath(p)) })
  })

  server.registerTool('share_file', {
    description: 'Copy files of an artifact\'s live version into its workspace\'s shared files (`as` renames). The artifact keeps its own copy: edit the boards to link `_shared/<path>` instead.',
    inputSchema: { id: z.string(), files: z.array(z.object({ path: z.string(), as: z.string().optional() })).min(1).max(50) },
  }, ({ id, files }) => text({ shared: shareArtifactFiles(id, files, 'claude').map(f => f.ref) }))

  server.registerTool('transfer_boards', {
    description: 'Copy or move boards from one artifact to another (the whole canvas with its notes when `boards` is omitted). Dependencies (css, js, images, linked pages) travel along; nothing in the target is overwritten. Returns the new paths and any warnings.',
    inputSchema: { id: z.string().describe('Source artifact'), target: z.string().describe('Target artifact id'), boards: z.array(z.string()).optional().describe('Board paths from canvas.json; omit for all'), mode: z.enum(['copy', 'move']).default('copy') },
  }, ({ id, target, boards, mode }) => text(transferBoards({ sourceId: id, targetId: target, boards, mode })))

  server.registerTool('read_file', {
    description: 'Read one text file of an artifact. `_shared/<path>` reads a shared file of the artifact\'s workspace.',
    inputSchema: { id: z.string(), path: z.string(), version: z.number().int().optional() },
  }, ({ id, path, version }) => {
    const a = requireArtifact(id)
    const f = readServedFile(id, version ?? a.current_version, path)
    if (!f) throw new Error(`No such file: ${path}`)
    if (!/^(text\/|application\/json|image\/svg)/.test(f.contentType)) return text(`(${f.contentType}, ${f.content.length} bytes, not shown)`)
    return text(f.content.toString('utf8'))
  })

  server.registerTool('publish_files', {
    description: 'Publish a new version. Only the files named change; `remove` deletes paths. base_version must be the live version.',
    inputSchema: {
      id: z.string(), base_version: z.number().int(), files: z.array(fileSchema).default([]),
      remove: z.array(z.string()).optional(), label: z.string().max(60).optional(), title: z.string().max(200).optional(),
    },
  }, ({ id, base_version, files, remove, label, title }) => {
    const r = publish({ id, baseVersion: base_version, files, remove, label, title })
    return text({ ...r, url: `${origin}/a/${r.id}` })
  })

  server.registerTool('edit_file', {
    description: 'Small change to one text file: each old_text must occur exactly once; all edits apply or none. Publishes a new version.',
    inputSchema: {
      id: z.string(), path: z.string(), base_version: z.number().int(),
      edits: z.array(z.object({ old_text: z.string().min(1), new_text: z.string() })).min(1).max(64),
      label: z.string().max(60).optional(),
    },
  }, ({ id, path, base_version, edits, label }) => text(editFile(id, path, edits, base_version, label)))

  server.registerTool('read_comments', {
    description: 'Comment threads on an artifact with their anchors (board, selector, text). Replies are nested under their thread.',
    inputSchema: { id: z.string(), only_open: z.boolean().default(true) },
  }, ({ id, only_open }) => {
    requireArtifact(id)
    const all = listComments(id)
    const roots = all.filter(c => !c.parent_id && (!only_open || !c.resolved))
    return text(roots.map(r => ({
      id: r.id, version: r.version, board: r.board, anchor: r.anchor, resolved: !!r.resolved,
      author: r.author_email, kind: r.author_kind, body: r.body, attachments: r.attachments, created_at: r.created_at,
      replies: all.filter(c => c.parent_id === r.id).map(c => ({ id: c.id, author: c.author_email, kind: c.author_kind, body: c.body, attachments: c.attachments, created_at: c.created_at })),
    })))
  })

  server.registerTool('read_comment_attachment', {
    description: 'Fetch a file pasted into a comment (ids are in the `attachments` of read_comments / wait_for_comments). Images come back as images; other files as base64 text.',
    inputSchema: { id: z.string(), attachment_id: z.string() },
  }, ({ id, attachment_id }) => {
    requireArtifact(id)
    const f = readAttachment(id, attachment_id)
    if (INLINE_IMAGE.test(f.mime)) return { content: [{ type: 'image' as const, data: f.content.toString('base64'), mimeType: f.mime }] }
    return text({ name: f.name, mime: f.mime, size: f.size, encoding: 'base64', content: f.content.toString('base64') })
  })

  server.registerTool('wait_for_comments', {
    description: 'Long-poll: returns as soon as a person has commented on (or replied under) this artifact after `since`, or after timeout_s with an empty list. Pass `since` = the `next_since` of the previous call (omit on the first call to start from now). Call again in a loop to react to web comments; your own replies never wake it.',
    inputSchema: { id: z.string(), since: z.string().optional(), timeout_s: z.number().int().min(1).max(50).default(25) },
  }, async ({ id, since, timeout_s }, extra: { signal?: AbortSignal }) => {
    requireArtifact(id)
    const from = since ?? new Date().toISOString()
    const fresh = () => listComments(id).filter(c => c.author_kind === 'person' && c.created_at > from)
    const result = (list: ReturnType<typeof fresh>) => text({
      comments: list.map(c => ({ id: c.id, thread_id: c.parent_id ?? c.id, board: c.board, anchor: c.anchor, author: c.author_email, body: c.body, attachments: c.attachments, created_at: c.created_at })),
      next_since: list.length ? list[list.length - 1]!.created_at : from,
    })
    let hits = fresh()
    if (hits.length) return result(hits)
    await new Promise<void>((resolve) => {
      let off = () => {}
      const done = () => { clearTimeout(timer); off(); extra?.signal?.removeEventListener('abort', done); resolve() }
      const timer = setTimeout(done, timeout_s * 1000)
      off = onArtifact(id, (ev) => { if (ev.type === 'comments' && fresh().length) done() })
      extra?.signal?.addEventListener('abort', done)
    })
    hits = fresh()
    return result(hits)
  })

  server.registerTool('reply_comment', {
    description: 'Reply to a comment thread (use the thread root id).',
    inputSchema: { id: z.string(), comment_id: z.string(), body: z.string().min(1).max(5000) },
  }, ({ id, comment_id, body }) => {
    const a = requireArtifact(id)
    return text({ id: addComment({ artifactId: id, version: a.current_version, email: 'claude', kind: 'model', body, parentId: comment_id }) })
  })

  server.registerTool('resolve_comment', {
    description: 'Mark a thread resolved or reopen it.',
    inputSchema: { id: z.string(), comment_id: z.string(), resolved: z.boolean().default(true) },
  }, ({ id, comment_id, resolved }) => {
    resolveComment(id, comment_id, resolved)
    return text({ ok: true })
  })

  // Shared storage is what the page's window.artifact.shared reads and writes (see guide). The model
  // can read what viewers saved (votes, form entries, tracker rows) or update it without republishing.
  server.registerTool('data_list', {
    description: 'List shared-storage entries of an artifact (what window.artifact.shared holds), optionally by key prefix.',
    inputSchema: { id: z.string(), prefix: z.string().default('') },
  }, ({ id, prefix }) => { requireArtifact(id); return text(dataList(id, 'shared', prefix)) })

  server.registerTool('data_get', {
    description: 'Read one shared-storage entry.',
    inputSchema: { id: z.string(), key: z.string() },
  }, ({ id, key }) => { requireArtifact(id); return text(dataGet(id, 'shared', key)) })

  server.registerTool('data_set', {
    description: 'Write one shared-storage entry (any JSON value, max 256 KB). Open pages update live.',
    inputSchema: { id: z.string(), key: z.string(), value: z.any() },
  }, ({ id, key, value }) => { requireArtifact(id); dataSet(id, 'shared', key, value, 'claude'); return text({ ok: true }) })

  server.registerTool('data_delete', {
    description: 'Delete one shared-storage entry.',
    inputSchema: { id: z.string(), key: z.string() },
  }, ({ id, key }) => { requireArtifact(id); dataDelete(id, 'shared', key); return text({ ok: true }) })

  server.registerTool('share_link', {
    description: 'Create a share link. role "comment" lets people comment with their e-mail; "view" is read-only. Links can be revoked in the UI.',
    inputSchema: { id: z.string(), role: z.enum(['view', 'comment']).default('comment') },
  }, ({ id, role }) => {
    if (!getArtifact(id)) throw new Error('Artifact not found')
    const token = createShare(id, role)
    return text({ url: `${origin}/s/${token}`, role })
  })

  registerRenderTool(server)

  return server
}
