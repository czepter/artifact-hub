// MCP tool `render_artifact`: lets a chat model look at what it published (and get the svg/xml source of a canvas).
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { requireArtifact } from '../store'
import { FORMATS, parseRenderQuery, renderArtifact } from './index'

export function registerRenderTool(server: McpServer) {
  server.registerTool('render_artifact', {
    description: 'Render an artifact to an image so you can look at it: png (default), webp, jpeg are returned as images; svg (true vector for canvases) and xml (structured scene: boards, notes, geometry, text) as text. '
      + 'A canvas renders whole, or one board with `board`. Board HTML is drawn for real when the server has a headless browser; otherwise boards show as frames with their text outline (see the `boards` field). Size is capped; `max` fits the longest edge in px.',
    inputSchema: {
      id: z.string(),
      format: z.enum(FORMATS).default('png'),
      board: z.string().optional().describe('Board path from canvas.json, e.g. screens/Home.html: render only that board'),
      version: z.number().int().optional().describe('Default: the live version'),
      scale: z.number().min(0.1).max(4).default(1),
      max: z.number().int().min(16).max(8192).default(1568).describe('Longest edge in px; the scale is lowered to fit (1568 is about what a model sees at full detail)'),
      theme: z.enum(['light', 'dark']).default('light'),
      background: z.string().default('canvas').describe('canvas, white, transparent or #rrggbb'),
    },
  }, async (args: Record<string, unknown>) => {
    const a = requireArtifact(String(args.id))
    const req = parseRenderQuery(args)
    const r = await renderArtifact(a.id, req)
    const meta = `${a.title}: ${r.width}x${r.height}px (scale ${Math.round(r.scale * 100) / 100}), version ${r.version}, boards: ${r.boards}${r.boards === 'outline' ? ' (HTML not drawn, text outline only)' : ''}`
    if (typeof r.body === 'string') return { content: [{ type: 'text' as const, text: `${meta}\n\n${r.body}` }] }
    if (req.format === 'svg') return { content: [{ type: 'text' as const, text: `${meta}\n\n${r.body}` }] }
    return { content: [{ type: 'image' as const, data: r.body.toString('base64'), mimeType: r.type }, { type: 'text' as const, text: meta }] }
  })
}
