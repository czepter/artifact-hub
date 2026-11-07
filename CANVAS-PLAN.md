# Canvas upgrade plan (Excalidraw-inspired)

Scope: all three tiers, including multi-resize of a selection. Estimated effort is 9–12 working days, shipped as 4 pull requests (one per phase, in order).

## Starting point

- `app/components/Canvas.vue` (969 lines) holds all canvas logic: pan/zoom, single selection (`selNote` / `selectedBoard`), resize handles, creation tools, context menu, keyboard shortcuts.
- `shared/canvasOps.ts` is one pure `applyCanvasOps`, used by the server (authoritative) and the viewer (optimistic preview). Ops: `addBoard`, `updateBoard`, `removeBoard`, `addNote`, `updateNote`, `deleteNote`.
- Undo is version-based (`Viewer.vue`): each save creates a version and undo reverts to the previous one. Canvas ops are covered. A gesture is one undo step only if it goes out as one batch.
- `onKey` returns early on any Ctrl/Meta press, and `hub:key` from iframes only forwards `key`.

## Phase 0: Foundations (about 1 day, no visible change)

1. **Split up `Canvas.vue`.**
   - Move pure geometry (`noteBox`, bounds, later snapping, binding, scaling, smoothing) to `shared/canvasGeometry.ts` so it is unit-testable in `tests/canvas-unit.ts`.
   - Pull selection and gesture handling into composables under `app/composables/`.
2. **Selection model.** Replace `selNote` and `selectedBoard` with one `Set` of keys (`n:<id>`, `b:<path>`).
   - The composable exposes the combined bounding box.
   - `canvasSelect` emits an array. `BoardPanel` and `EditorPanel` handle "N items".
   - Single-item resize becomes the one-item case of the multi-resize code path, so there is one resize implementation.
3. **Batched ops.** Add `onCanvasOps(ops[])` in `Viewer.vue` so one gesture is one `queueSave` and one undo step. `applyCanvasOps` already accepts up to 200 ops.
4. **Schema additions in `shared/canvasOps.ts`**, all validated in `cleanNote` and `updateBoard`.
   - Canvas: `noteOrder: string[]` for z-order. `order` stays the present/focus sequence for boards. A canvas without `noteOrder` falls back to object key order.
   - Note fields: `locked`, `group`, `stroke`, `strokeWidth`, `strokeStyle`, `fillStyle`, `roundness`, `arrowStart`, `arrowEnd`, `bind: { start?, end? }`.
   - Board fields: `locked`, `group`.
   - New ops: `reorderNotes` and `duplicateBoard`. The server copies the board's file, because `addBoard` only writes a blank page.
5. **Keyboard handling.** Open `onKey` for canvas-level Ctrl/Meta shortcuts, calling `preventDefault` only while the canvas has focus and is in edit mode. Extend `hub:key` from iframes to also send `code` and modifier keys.
6. **Model contract.** Update the MCP canvas tool descriptions and schema docs for the new fields and ops. (Location not yet found.)

## Phase 1: Tier 1 (about 3–3.5 days)

| # | Feature | Implementation |
|---|---|---|
| 1 | **Multi-select and multi-resize** | See the section below. |
| 2 | **Copy, paste, duplicate** | Ctrl+C, V and D, and Alt-drag to clone. Notes use `addNote` with new ids. Boards use `duplicateBoard`. Paste lands at an offset or at the cursor. |
| 3 | **Z-order** | `]` and `[` for forward and back, Ctrl+`]` and Ctrl+`[` for front and back. The context menu gets the same entries. Rendering follows `noteOrder`. |
| 4 | **Snapping and guides** | Pure `snapBox(moving, others, threshold / k)` in shared geometry. Snaps to edges and centers of boards and notes. Guide lines render in the world layer. Alt disables snapping. Align and distribute buttons appear for 2+ selected items. |
| 5 | **Tool lock** | `toolLock` state next to `tool`. `Q` or a double-click on a toolbar item toggles it. `finishCreate` skips `emit('tool','select')` when locked. A lock badge shows on the active tool. |
| 6 | **Space-pan and number keys** | Hold Space for a temporary hand. Keys 1–9 pick toolbar slots. `Shift+1` fits all and `Shift+2` zooms to the selection, using `e.code` so it works on any layout. |
| 7 | **Shift and Alt constraints** | Shift draws a square or circle and snaps lines and arrows to 15°. Alt draws from the center. Applies in the create branch and the resize handles of `onPointerMove`. |

### Item 1 in detail: multi-select and multi-resize

**Selection**
- Shift-click toggles an item.
- A marquee drag starts on empty canvas, or with Shift over a board's shield. It never starts on an iframe.
- Group move, delete, nudge and Ctrl+A.

**Interaction**
- A selection of 2+ items shows one bounding box with 8 handles.
- Corner handles keep the aspect ratio. Side handles stretch one axis.
- Alt scales from the center. Snapping from item 4 applies to the bounding box edges.
- A locked item (Phase 2, item 11) can be shift-clicked into a selection but is skipped by every transform.

**How each kind scales**

| Item | Behavior |
|---|---|
| Board | `x`, `y`, `w`, `h` scale. The iframe reflows, as with a single resize. |
| Rect, oval | `x`, `y`, `w`, `h` scale. |
| Line, arrow | All four values scale, including negative extents. |
| Pen | `x`, `y` and every point scale. Stroke width does not. |
| Sticky, text | `x`, `y` and `w` scale. Height stays automatic and font size is unchanged. Scaling text size is a possible follow-up. |
| Bound arrows | Endpoints resolve at render time and follow their targets. An arrow that is itself selected also scales its stored coordinates. |

**Clamping**
- Smallest allowed scale is the largest ratio of (minimum size ÷ current size) across the selection. Minimums are 40 for boards and 8 for notes.
- Largest allowed scale is the smallest ratio of (8000 ÷ current size).
- Clamping applies to the whole selection, so relative layout never distorts.

**Implementation**
- `scaleItems(items, bbox, handle, { keepAspect, fromCenter })` is a pure function in `shared/canvasGeometry.ts` that returns a patch per item.
- `boardOv` and `noteOv` already hold live geometry during a drag. `noteOv` gets an optional `points` field so pen strokes preview correctly.
- On release, all patches go out as one batch of `updateBoard` and `updateNote` ops, so the resize is one undo step.
- Rounding stays at 0.1. Large scale-downs can drift slightly because each item rounds on its own.

## Phase 2: Tier 2 (about 3–4 days)

| # | Feature | Implementation |
|---|---|---|
| 8 | **Arrow binding** | Store only `bind: { start: {type,id}, end: {...} }`. Resolve endpoints at render time as the intersection of the line with the target box, plus a gap. Moving a target needs no extra ops. Dragging an endpoint near a target highlights it. Deleting a target clears the binding in the same batch. Targets: boards, rects, ovals, stickies, text. Elbow and curved arrows are out of scope. |
| 9 | **Text inside shapes** | Double-click a rect or oval to edit, reusing the existing `contenteditable` flow, centered. Auto-delete of empty notes stays limited to sticky and text. |
| 10 | **Shape style panel** | In `BoardPanel`: stroke color, width, solid / dashed / dotted, fill, roundness, arrowheads at each end. Applies to all selected items as one batch. |
| 11 | **Lock and group** | Locked items can't be dragged, marquee-selected or resized, and the context menu shows Unlock. Ctrl+G and Ctrl+Shift+G group and ungroup. Clicking selects the whole group, double-click selects a member. |
| 12 | **Eraser** | Tool `E`. Dragging marks the notes under the cursor and release deletes them in one batch. Boards are not erasable here, because deleting one is destructive and already has a confirm dialog. |

## Phase 3: Tier 3 (about 2–3 days)

- **Pen smoothing.** Simplify points with Ramer–Douglas–Peucker on commit, which keeps shape better under the 400-point cap. Draw with Catmull-Rom curves at render. No schema change.
- **Laser pointer.** Present mode only, local only. A fading-trail overlay sits above the iframe, toggled from the focus bar. Sharing it with other viewers would need realtime and is out of scope.
- **Image paste and drop.** New note kind `image` with `src` pointing to an artifact file such as `assets/<hash>.png`. Images are downscaled client-side to at most 2048px and capped at about 5 MB. Needs a binary upload path, since `addFiles` currently carries text content.
- **Command palette.** Ctrl+K using shadcn's Command component (added if `components/ui` lacks it). Lists tools, zoom and fit, add board, present, panel toggles.
- **Minimap.** Bottom-right, shown only when content extends past the viewport. Click to jump.
- **Sketch fill.** Only a hatch or cross-hatch `fillStyle` as an SVG pattern. No rough.js, so the hub chrome stays neutral.

## Testing

- **Unit tests** in `tests/canvas-unit.ts` for the new ops and validation, and for snapping, binding intersection, simplification, z-order and `scaleItems`. The `scaleItems` tests cover min/max clamping, negative-extent lines, pen point scaling, Alt from-center, skipping locked items, and rounding drift on a 10× round trip.
- **Browser tests** following the `tests/e2e/bt-*.mjs` pattern: `bt-multiselect`, `bt-multiresize`, `bt-snap`, `bt-arrows`, `bt-clipboard`. Each also checks that one gesture produces one undo step. `bt-multiresize` selects a board, a sticky, an arrow and a pen stroke, drags a corner handle, then checks the result and that undo restores everything.

## Risks

- **Iframes swallow pointer events.** The marquee must start on the shield or the background. Laser mode and the image drop zone need the same overlay approach.
- **One server version per save.** Arrow-key nudging is debounced today. Batching must keep it that way, so test that holding an arrow key doesn't create dozens of versions.
- **Shortcut conflicts.** Ctrl+D, Ctrl+G and Ctrl+K collide with browser defaults. They are intercepted only when the canvas is focused and in edit mode.
- **Old canvases.** A canvas without `noteOrder` falls back to key order, so existing artifacts render as before.

## Decisions (defaults used unless changed)

1. Duplicating a board copies its HTML file via the new `duplicateBoard` op.
2. Images are stored as artifact files, capped at about 5 MB.
3. Multi-resize is included (decided).

## Delivery order

| PR | Contents | Effort |
|---|---|---|
| 1 | Phase 0: foundations | about 1 day |
| 2 | Phase 1: Tier 1 | about 3–3.5 days |
| 3 | Phase 2: Tier 2 | about 3–4 days |
| 4 | Phase 3: Tier 3 | about 2–3 days |
