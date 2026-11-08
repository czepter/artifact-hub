// SVG -> PNG / WebP / JPEG. resvg (Rust, prebuilt binaries for linux amd64 and arm64, macOS, Windows) draws the SVG;
// WebP and JPEG are encoded by wasm codecs (@jsquash), so nothing here needs libvips, ImageMagick or a browser.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const RASTER_LIMITS = { maxScale: 4, maxEdge: 8192, maxPixels: 36_000_000 }
export interface RasterOptions { format: 'png' | 'webp' | 'jpeg', scale: number, max?: number, background: string, quality: number }

let webpReady: Promise<(d: ImageData, q: number) => Promise<ArrayBuffer>> | null = null
let jpegReady: Promise<(d: ImageData, q: number) => Promise<ArrayBuffer>> | null = null
type ImageData = { data: Uint8ClampedArray, width: number, height: number }
const wasmDir = (pkg: string) => dirname(createRequire(import.meta.url).resolve(`${pkg}/package.json`))
async function webpEncoder() {
  return webpReady ??= (async () => {
    const m = await import('@jsquash/webp/encode.js')
    await m.init(await WebAssembly.compile(readFileSync(join(wasmDir('@jsquash/webp'), 'codec/enc/webp_enc.wasm'))))
    return (d, q) => m.default(d as any, { quality: q })
  })()
}
async function jpegEncoder() {
  return jpegReady ??= (async () => {
    const m = await import('@jsquash/jpeg/encode.js')
    await m.init(await WebAssembly.compile(readFileSync(join(wasmDir('@jsquash/jpeg'), 'codec/enc/mozjpeg_enc.wasm'))))
    return (d, q) => m.default(d as any, { quality: q })
  })()
}

export async function rasterize(svg: string, req: RasterOptions, w: number, h: number, fontFiles: { regular: string, bold: string }): Promise<{ body: Buffer, width: number, height: number, scale: number }> {
  const { Resvg } = await import('@resvg/resvg-js')
  // Pixel size: the asked scale, lowered to honour `max` and the hard limits.
  let s = req.scale
  const edge = Math.max(w, h)
  if (req.max) s = Math.min(s, req.max / edge)
  s = Math.min(s, RASTER_LIMITS.maxEdge / edge, Math.sqrt(RASTER_LIMITS.maxPixels / (w * h)))
  const width = Math.max(1, Math.round(w * s)), height = Math.max(1, Math.round(h * s))
  const flat = req.format === 'jpeg' // no alpha in jpeg: a transparent background becomes white
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: flat && req.background === 'transparent' ? '#ffffff' : undefined,
    font: { fontFiles: [fontFiles.regular, fontFiles.bold], loadSystemFonts: process.env.HUB_RENDER_SYSTEM_FONTS === '1', defaultFontFamily: 'Liberation Sans', sansSerifFamily: 'Liberation Sans' },
    imageRendering: 0,
  })
  const img = r.render()
  const px = { data: new Uint8ClampedArray(img.pixels.buffer, img.pixels.byteOffset, img.pixels.byteLength), width: img.width, height: img.height }
  let body: Buffer
  if (req.format === 'png') body = img.asPng()
  else if (req.format === 'webp') body = Buffer.from(await (await webpEncoder())(px, req.quality))
  else body = Buffer.from(await (await jpegEncoder())(px, req.quality))
  return { body, width: img.width, height: img.height, scale: s }
}

