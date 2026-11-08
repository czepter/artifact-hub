export interface Anchor {
  selector: string
  tag: string
  text: string
  rel: { x: number, y: number }
  click: { x: number, y: number }
}

export interface Attachment { id: string, name: string, mime: string, size: number }

export interface Comment {
  id: string
  artifact_id: string
  version: number
  board: string | null
  anchor: Anchor | null
  author_email: string
  author_kind: 'person' | 'model'
  body: string
  parent_id: string | null
  resolved: number
  attachments: Attachment[]
  created_at: string
}

export interface ViewData {
  artifact: { id: string, title: string, version: number, live: number, updatedAt: string, workspaceId: string, kind?: 'artifact' | 'shared', archived?: boolean }
  versions: { version: number, label: string | null, created_at: string }[]
  role: 'owner' | 'comment' | 'view'
  email: string | null
  canvas: { boards?: Record<string, unknown>, order?: string[], notes?: Record<string, unknown>, title?: string } | null
  files: { path: string, rev: number }[]
  /** Changes when the workspace's shared files change: boards reload. */
  sharedRev: number
  frameBase: string
  /** Append a URL-encoded board path for its picture. */
  thumbBase: string
  comments: Comment[]
}

/** What the in-frame editor reports about the selected element. */
export interface EditSel {
  board: string
  id: string
  tag: string
  declared: Record<string, string>
  c: Record<string, string>
  free: boolean
  position: string
  parentFlex: boolean
  parentRow: boolean
  attrs: { src: string | null, href: string | null, alt: string | null, placeholder: string | null, title: string | null, id: string | null, cls: string | null, ariaLabel: string | null }
  contrast: { ratio: number, level: string, large: boolean } | null
  textEditable: boolean
  bound: boolean
  parentId: string | null
  canUp: boolean
  canDown: boolean
}
