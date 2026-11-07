// The canvas tools in toolbar order. Keys 1-9 pick them by position.
export type Tool = 'select' | 'hand' | 'text' | 'artboard' | 'sticky' | 'rect' | 'oval' | 'arrow' | 'line' | 'pen'
export const TOOL_ORDER = ['select', 'hand', 'text', 'artboard', 'sticky', 'rect', 'oval', 'arrow', 'pen'] as const satisfies readonly Tool[]
/** Letter shortcuts. */
export const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text', a: 'artboard', s: 'sticky', r: 'rect', o: 'oval', l: 'arrow', p: 'pen' }
