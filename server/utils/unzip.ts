import { inflateRawSync } from 'node:zlib'

export interface ZipEntry { name: string, data: Buffer }

const MAX_ENTRIES = 1000
const MAX_TOTAL = 60 * 1024 * 1024

/**
 * Reads a ZIP held in memory (stored or deflated entries; no zip64, no encryption).
 * Defensive on purpose: the archive is untrusted. Entry count and the inflated size are capped, and a
 * deflate stream is never allowed to grow past the declared size.
 */
export function readZip(buf: Buffer): { entries: ZipEntry[], skipped: string[] } {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw createError({ statusCode: 422, statusMessage: 'Not a valid .zip file' })
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || p === 0xffffffff) throw createError({ statusCode: 422, statusMessage: 'zip64 archives are not supported' })
  if (count > MAX_ENTRIES) throw createError({ statusCode: 422, statusMessage: `Archive has too many entries (max ${MAX_ENTRIES})` })

  const entries: ZipEntry[] = [], skipped: string[] = []
  let total = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw createError({ statusCode: 422, statusMessage: 'Corrupt zip directory' })
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    p += 46 + nlen + xlen + clen
    if (name.endsWith('/')) continue
    if (flags & 1) { skipped.push(`${name} (encrypted)`); continue }
    total += usize
    if (total > MAX_TOTAL) throw createError({ statusCode: 413, statusMessage: 'Archive is too large when unpacked (max 60 MB)' })
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw createError({ statusCode: 422, statusMessage: 'Corrupt zip entry' })
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + csize)
    let data: Buffer
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) })
    else { skipped.push(`${name} (compression method ${method})`); continue }
    entries.push({ name, data })
  }
  return { entries, skipped }
}
