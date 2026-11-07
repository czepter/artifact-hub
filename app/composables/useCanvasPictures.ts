import type { CanvasOp } from '#shared/canvasOps'
import type { NoteView } from '~/utils/canvasView'
import { noteKey } from '#shared/canvasItemOps'
import { isImageFile, prepareImage } from './useCanvasImages'
import type { useCanvasSelection } from './useCanvasSelection'

/**
 * Pictures pasted or dropped on the canvas: shrunk, stored in the artifact with the same save that places them
 * (so it is one undo step), and shown from memory until that save has come back.
 */
export function useCanvasPictures(o: {
  canEdit: () => boolean, canPaste: () => boolean, newId: () => string, selection: ReturnType<typeof useCanvasSelection>
  toWorld: (cx: number, cy: number) => { x: number, y: number }, pointer: () => { x: number, y: number } | null
  viewport: Ref<HTMLElement | undefined>, size: { w: number, h: number }
  emitOps: (ops: CanvasOp[], files: { path: string, content: string }[]) => void, notify: (msg: string) => void
  frameBase: () => string, rev: (path: string) => number | undefined
}) {
  const local = reactive<Record<string, string>>({})
  const imageUrl = (n: NoteView) => (n.kind === 'image' && n.src ? local[n.src] ?? `${o.frameBase()}${n.src}?r=${o.rev(n.src) ?? 0}` : undefined)
  const r1 = (n: number) => Math.round(n * 10) / 10

  async function add(files: File[], at: { x: number, y: number }) {
    const ops: CanvasOp[] = [], uploads = new Map<string, { path: string, content: string }>(), ids: string[] = []
    let off = 0
    for (const f of files.filter(isImageFile).slice(0, 5)) {
      try {
        const img = await prepareImage(f), s = Math.min(1, 480 / Math.max(img.w, img.h)), id = o.newId()
        local[img.path] = img.dataUrl; uploads.set(img.path, { path: img.path, content: img.base64 }); ids.push(id)
        ops.push({ type: 'addNote', id, note: { kind: 'image', src: img.path, x: r1(at.x + off), y: r1(at.y + off), w: r1(img.w * s), h: r1(img.h * s) } })
        off += 24
      } catch (e: any) { o.notify(e?.message ?? 'That picture could not be added') }
    }
    if (!ops.length) return
    o.emitOps(ops, [...uploads.values()])
    nextTick(() => o.selection.set(ids.map(noteKey)))
  }
  const centre = () => { const r = o.viewport.value!.getBoundingClientRect(); return o.toWorld(r.left + o.size.w / 2, r.top + o.size.h / 2) }
  function onPaste(e: ClipboardEvent) {
    if (!o.canPaste() || (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) return
    const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile)
    if (!files.length) return
    e.preventDefault()
    const p = o.pointer()
    void add(files, p ? o.toWorld(p.x, p.y) : centre())
  }
  const hasFiles = (e: DragEvent) => o.canEdit() && [...(e.dataTransfer?.types ?? [])].includes('Files')
  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
    void add([...(e.dataTransfer?.files ?? [])], o.toWorld(e.clientX, e.clientY))
  }
  return { imageUrl, onPaste, onDrop, hasFiles }
}
