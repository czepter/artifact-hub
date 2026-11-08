// The renderer's font: Liberation Sans (SIL OFL, metric-compatible with Arial), bundled under server/assets/fonts so the
// output does not depend on what the host has installed. Used twice: to measure text for wrapping (a small TrueType
// reader: cmap format 4 + hmtx) and as the font files handed to the rasterizer.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface Face { upm: number, advance: (cp: number) => number | null }

export function parseFace(buf: Buffer): Face {
  const tables = new Map<string, number>()
  const n = buf.readUInt16BE(4)
  for (let i = 0; i < n; i++) tables.set(buf.toString('latin1', 12 + i * 16, 16 + i * 16), buf.readUInt32BE(12 + i * 16 + 8))
  const head = tables.get('head')!, hhea = tables.get('hhea')!, hmtx = tables.get('hmtx')!, cmap = tables.get('cmap')!
  const upm = buf.readUInt16BE(head + 18), nHM = buf.readUInt16BE(hhea + 34)
  // pick a Unicode BMP subtable of format 4
  let sub = -1
  const nt = buf.readUInt16BE(cmap + 2)
  for (let i = 0; i < nt; i++) {
    const plat = buf.readUInt16BE(cmap + 4 + i * 8), enc = buf.readUInt16BE(cmap + 6 + i * 8), off = cmap + buf.readUInt32BE(cmap + 8 + i * 8)
    if (buf.readUInt16BE(off) === 4 && ((plat === 3 && enc === 1) || plat === 0)) { sub = off; break }
  }
  if (sub < 0) throw new Error('font has no format 4 cmap')
  const segX2 = buf.readUInt16BE(sub + 6), seg = segX2 / 2
  const endO = sub + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2
  const glyphOf = (cp: number) => {
    if (cp > 0xffff) return 0
    for (let s = 0; s < seg; s++) {
      if (cp > buf.readUInt16BE(endO + s * 2)) continue
      const start = buf.readUInt16BE(startO + s * 2)
      if (cp < start) return 0
      const delta = buf.readInt16BE(deltaO + s * 2), ro = buf.readUInt16BE(rangeO + s * 2)
      if (ro === 0) return (cp + delta) & 0xffff
      const g = buf.readUInt16BE(rangeO + s * 2 + ro + (cp - start) * 2)
      return g ? (g + delta) & 0xffff : 0
    }
    return 0
  }
  return {
    upm,
    advance: (cp) => {
      const g = glyphOf(cp)
      if (!g) return null
      return buf.readUInt16BE(hmtx + Math.min(g, nHM - 1) * 4)
    },
  }
}

interface Loaded { files: { regular: string, bold: string }, regular: Face, bold: Face }
let loaded: Promise<Loaded> | null = null

/** Reads the bundled fonts once; writes copies to the temp dir because the rasterizer wants file paths. */
export function loadFonts(): Promise<Loaded> {
  return loaded ??= (async () => {
    const storage = useStorage('assets:server')
    const get = async (name: string) => {
      const raw = await storage.getItemRaw(`fonts/${name}`)
      if (!raw) throw new Error(`Missing server asset fonts/${name}`)
      return Buffer.from(raw as Uint8Array)
    }
    const [reg, bold] = await Promise.all([get('LiberationSans-Regular.ttf'), get('LiberationSans-Bold.ttf')])
    const dir = join(tmpdir(), `artifact-hub-fonts-${reg.length}-${bold.length}`)
    mkdirSync(dir, { recursive: true })
    const files = { regular: join(dir, 'LiberationSans-Regular.ttf'), bold: join(dir, 'LiberationSans-Bold.ttf') }
    if (!existsSync(files.regular)) writeFileSync(files.regular, reg)
    if (!existsSync(files.bold)) writeFileSync(files.bold, bold)
    return { files, regular: parseFace(reg), bold: parseFace(bold) }
  })().catch((e) => { loaded = null; throw e })
}

/** A `measure` function for the renderer. Unknown glyphs (CJK, emoji) count as 0.6 em. */
export function measurer(l: Loaded) {
  const cache = new Map<string, number>()
  return (text: string, px: number, bold: boolean) => {
    const face = bold ? l.bold : l.regular
    let units = 0
    for (const ch of text) {
      const key = (bold ? 'b' : 'r') + ch
      let a = cache.get(key)
      if (a === undefined) { a = face.advance(ch.codePointAt(0)!) ?? face.upm * 0.6; cache.set(key, a) }
      units += a
    }
    return units / face.upm * px
  }
}
