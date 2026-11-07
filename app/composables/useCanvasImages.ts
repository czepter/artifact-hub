import { MAX_IMAGE_BYTES } from '#shared/canvasOps'

export interface PreparedImage { path: string, base64: string, dataUrl: string, w: number, h: number }
const MAX_SIDE = 2048

/** Images a person can paste or drop on the canvas. */
export const isImageFile = (f: File) => /^image\/(png|jpeg|webp|gif)$/.test(f.type)

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>(res => c.toBlob(res, type, q))
const toBase64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }

/**
 * Scales a picture down to at most 2048 px on its longest side and returns it ready to store: named by the hash of
 * its bytes (`assets/<16 hex>.png|jpg`), within 5 MB. Throws a readable message when that is not possible.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!isImageFile(file)) throw new Error('That file is not a PNG, JPEG, WebP or GIF picture')
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('That picture could not be read') })
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  // Keep transparency (PNG) unless the picture was a photo or the PNG is too big; then JPEG.
  let blob = file.type === 'image/jpeg' ? await toBlob(c, 'image/jpeg', 0.9) : await toBlob(c, 'image/png')
  if (blob && blob.size > MAX_IMAGE_BYTES) blob = await toBlob(c, 'image/jpeg', 0.8)
  if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error('That picture is too large (the limit is 5 MB)')
  const buf = await blob.arrayBuffer()
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png'
  return { path: `assets/${hash}.${ext}`, base64: toBase64(buf), dataUrl: URL.createObjectURL(blob), w, h }
}
