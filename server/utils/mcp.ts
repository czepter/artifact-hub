import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  dataDelete, dataGet, dataList, dataSet,
  addComment, createShare, editFile, getArtifact, listArtifacts, listComments, listFiles, listVersions,
  publish, readFile, requireArtifact, resolveComment,
} from './store'

const GUIDE = `# Artifact Hub: how to publish

An artifact is a set of text/binary files, versioned. Every publish creates a new version; files you do not
name are carried over, and \`remove\` drops paths. Updating requires base_version = the live version
(409 on conflict: re-read and retry).

## Single page
Publish \`index.html\` (a full document or a fragment). It is shown in a sandboxed iframe (scripts allowed, no
same-origin access, no cookies). Relative paths to other files in the artifact work (css/site.css, img/a.png).

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
line/arrow {x,y,w,h} (w and h may be negative: drawn from x,y to x+w,y+h), pen {x,y,points:[[dx,dy],…]}. fill is yellow, gray, red, orange, green, teal,
blue, purple, pink, none or a #rrggbb colour. A board entry may carry \`tweaks\`: {prop: value} for the levers a .dc.html board declares in data-props.

Optional canvas fields (all validated; omit them for the defaults):
- canvas \`noteOrder\`: ["n2","n1"] is the back-to-front stacking of notes. Without it notes stack in key order. \`order\` is unchanged: it is the present/focus sequence of boards.
- note and board \`locked\`: true (cannot be moved, resized or marquee-selected in the viewer) and \`group\`: "g1" (items sharing a group id select together).
- note styling: \`stroke\` (#rrggbb), \`strokeWidth\` (1-24), \`strokeStyle\` solid|dashed|dotted, \`fillStyle\` solid|hatch|cross, \`roundness\` sharp|round, and for line/arrow \`arrowStart\`/\`arrowEnd\` none|arrow|triangle|dot|bar.
- arrow \`bind\`: {"start":{"type":"note","id":"n1"},"end":{"type":"board","id":"screens/Home.html"}} attaches an end to a note or board; the viewer draws the end at the target's edge and follows it when it moves. Targets must exist.
Limits: 1000 notes, 400 pen points per stroke, boards and notes at most 8000 px wide or high, 200 operations per edit.

## Visual editor
The owner can edit boards in the viewer (select, retype text, change styles, add elements). Saved edits add \`data-hub-id\` attributes to elements: they are editor bookkeeping, keep them when you rewrite a file (the editor re-adds missing ones).

## Comments
People comment on the page; threads anchor to a board + element (CSS path + text fingerprint).
Use read_comments to see open threads, reply_comment to answer, resolve_comment when handled.
Comments belong to the version they were made on; the viewer re-locates them on newer versions.
`

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

const fileSchema = z.object({
  path: z.string().describe('Served path, e.g. index.html or screens/Home.html'),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).optional().describe('Use base64 for binary files such as images'),
})

const TOOL_SCOPE: Record<string, string> = {
  guide: 'read', list_artifacts: 'read', get_artifact: 'read', read_file: 'read', read_comments: 'read', data_list: 'read', data_get: 'read',
  reply_comment: 'comment', resolve_comment: 'comment',
  create_artifact: 'write', publish_files: 'write', edit_file: 'write', data_set: 'write', data_delete: 'write',
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

  server.registerTool('list_artifacts', { description: 'List artifacts, most recently updated first.' }, () =>
    text(listArtifacts().map(a => ({ id: a.id, title: a.title, version: a.current_version, updated_at: a.updated_at, url: `${origin}/a/${a.id}` }))))

  server.registerTool('create_artifact', {
    description: 'Create an artifact (private to the owner). Needs index.html or canvas.json.',
    inputSchema: { title: z.string().min(1).max(200), files: z.array(fileSchema).min(1), label: z.string().max(60).optional() },
  }, ({ title, files, label }) => {
    const r = publish({ title, files, label })
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
      id: a.id, title: a.title, live_version: a.current_version, version: v, url: `${origin}/a/${a.id}`,
      files: listFiles(id, v), versions: listVersions(id), canvas_json: canvas ?? null,
    })
  })

  server.registerTool('read_file', {
    description: 'Read one text file of an artifact.',
    inputSchema: { id: z.string(), path: z.string(), version: z.number().int().optional() },
  }, ({ id, path, version }) => {
    const a = requireArtifact(id)
    const f = readFile(id, version ?? a.current_version, path)
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
      author: r.author_email, kind: r.author_kind, body: r.body, created_at: r.created_at,
      replies: all.filter(c => c.parent_id === r.id).map(c => ({ id: c.id, author: c.author_email, kind: c.author_kind, body: c.body, created_at: c.created_at })),
    })))
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

  return server
}
