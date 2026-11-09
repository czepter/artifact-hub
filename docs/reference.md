# Artifact Hub reference

Feature and API details. For installation and configuration see the [README](../README.md).

## MCP

Endpoint: `POST /mcp` (streamable HTTP, stateless, OAuth 2.1 access tokens only).
Tools: `guide`, `list_artifacts`, `create_artifact`, `get_artifact`, `read_file`, `publish_files`,
`edit_file`, `read_comments`, `wait_for_comments`, `reply_comment`, `resolve_comment`, `share_link`,
`data_list`, `data_get`, `data_set`, `data_delete`, `render_artifact`, `list_workspaces`, `create_workspace`, `update_workspace`, `delete_workspace`, `move_artifact`.
`create_artifact` and `list_artifacts` take an optional `workspace` (id or name). Workspace tools follow the grant's scopes
like the rest (`list_workspaces` needs read; `create_workspace`, `update_workspace`, `delete_workspace` (owner only) and `move_artifact` need write, so commenters never get them).

## Dashboard, search and review endpoints
- `GET /api/artifacts?cards=1` adds a live preview, open comment threads, `canvas` and `shared` to each artifact; `?q=` filters by title or canvas board title (accent- and case-insensitive).
- `GET /api/comments/:threadId` returns one thread with all messages (root first), the board, anchor, version and attachments; reply ids are 404.
- `GET /api/search?q=` feeds the Cmd/Ctrl+K palette: up to 8 artifacts by title and 5 waiting threads (empty `q` returns recent artifacts and waiting threads). Tests: `../tests/comments-thread-test.mjs`, `../tests/search-test.mjs`.
- `HUB_BUILD_DIR` (default `.nuxt`) lets several dev servers run from one checkout. Keep it inside the repo: a build dir elsewhere breaks reka-ui type resolution in dev.

## Workspaces
A workspace is a named container (name, description, colour, icon) that groups artifacts. Every artifact is in exactly one;
existing artifacts migrate into an auto-created default workspace ("General", id `default`) on startup (idempotent).
- `GET /api/workspaces` (members, with `artifactCount`), `POST /api/workspaces` and `PATCH /api/workspaces/:id` (editors),
  `DELETE /api/workspaces/:id` (owner). Deleting is refused with 409 while the workspace holds artifacts, and always for the default one.
- `GET /api/artifacts?workspace=<id or name>` filters; `POST /api/artifacts` and `/api/artifacts/import?workspace=` place a new artifact;
  `PATCH /api/artifacts/:id {workspaceId}` moves one.
- UI: workspace switcher in the header pill, filter and edit/delete on **Artifacts**, "Move to workspace" in each row's menu and the viewer's title menu.
- Extension point: `workspaces.settings` is a JSON column, all logic is in `server/utils/workspaces.ts` (`getSettings`/`patchSettings`).
  Shared files (below) are the first thing built on it; design-token editing and a component registry can follow.
- Test: `node ../tests/workspaces-test.mjs` against `PORT=3111 npm run dev:login`.

### UI library workspace
`ui-library/` is the hub's own component set as plain CSS plus showcase boards, kept in a separate workspace so it can be reviewed and tuned (for example with Impeccable) without touching the app.
- `ui-library/css/tokens.css` (palette, radius, shadow, spacing, light/dark) and `css/components.css` (one block per `app/components/ui` component, `data-variant`/`data-size` mirror the cva variants) become the workspace's **shared files**; seven boards (Foundations, Buttons, Forms, Feedback, Surfaces, Overlays, App chrome) link them as `../_shared/css/*.css`, so an edit shows in every board at once.
- `HUB=<origin> HUB_TOKEN=<bearer> node scripts/seed-ui-library.mjs` creates the "UI Library" workspace and the artifact, or syncs a new version when they exist. Local dev: `HUB=http://localhost:3000 HUB_TOKEN=devtoken` against `npm run dev:login`.
- Direction of travel is library to app: after tuning the CSS, port the change into the matching `ui/*.vue` classes (or `main.css` tokens).

### Shared files (tokens, component styles, scripts, images across boards)
Each workspace has a library of files that every artifact, and so every board, in it can use. A board links a library file as
`_shared/<path>` relative to the artifact root, e.g. `<link rel="stylesheet" href="_shared/css/tokens.css">` (from a board in a
subfolder: `../_shared/css/tokens.css`). It is a **live link, not a copy**: saving the file updates every board that uses it, in open viewers
too (frames reload, board pictures are redrawn, server renders and the headless renderer see it as well).
- Scope: one workspace. Boards of another workspace get a 404 for the same path, so moving an artifact to a workspace without the file breaks its links.
  `_shared/` is reserved: an artifact cannot publish files under it. Limits: 5 MB per file, 200 files, 20 MB per workspace.
- `GET /api/workspaces/:id/files` (members; `:id` may be a name), `GET|PUT|DELETE /api/workspaces/:id/files/<path>` (read text source / create or replace
  `{content, encoding?}` / remove; PUT and DELETE need an editor), `POST /api/artifacts/:id/share-file {files:[{path, as?}]}` copies files of an artifact into its workspace's library.
- MCP: `list_shared_files`, `read_shared_file` (read), `write_shared_files`, `edit_shared_file` (in-place old_text/new_text edits), `share_file` (write). `read_file` also reads `_shared/…` paths and `get_artifact` lists `shared_files`.
- UI: **Shared files…** in the workspace menu on **Artifacts** (list, new file, upload, edit, delete, copy the link tag); **Share files with workspace…** in an artifact's title menu promotes its css/js/fonts/images.
- The `.zip` export includes the shared files the artifact actually references (following references between shared files).
- Test: `node ../tests/shared-files-test.mjs` against `PORT=3111 npm run dev:login`.

### Copy or move boards between artifacts
`POST /api/artifacts/:id/transfer-boards {target, boards?, mode?: 'copy' | 'move'}` (editors; MCP: `transfer_boards`). `boards` are paths from `canvas.json`; omit it for the whole
canvas, which also brings the notes (stickies, shapes, arrows with their bindings, pictures). A plain single-page artifact counts as a canvas of one board, in the source and in the target.
- Travels along: the board HTML, its canvas entry (title, size, tweaks), and every local file it needs: stylesheets (also through `@import` and `url()`), scripts, images, fonts, other pages it links.
  Boards keep their layout relative to each other and are placed to the right of the target's boards. Group ids are renewed.
- Never overwrites: a taken board path gets a free name (`home-2.html`; links between the transferred boards are updated); a dependency that exists in the target with different bytes stays as the target has it and is reported in `warnings`
  (put it in the workspace's shared files to have one version for both). Links to boards that were not transferred, and `_shared/…` files the target's workspace lacks, are reported too.
- Move = copy, then remove the boards (and, for the whole canvas, the notes) from the source. Their dependency files stay (other boards may use them) and comments stay with the source. A single page cannot be moved, only copied.
- UI: board right-click menu (**Copy to artifact…** / **Move to artifact…**) and **Copy or move canvas…** in the artifact's title menu.
- Test: `node ../tests/transfer-test.mjs` against `PORT=3111 npm run dev:login`.


## Rendering (PNG, SVG, WebP, JPEG, XML)
`GET /api/artifacts/:id/render?format=png` draws an artifact on the server. `:id` is an artifact id (signed-in member) or a share token
(any role), the same access as `/api/view/:ref`. The viewer's **Export as image…** dialog and the MCP tool `render_artifact` (read scope;
returns the image so a chat model can look at its own work) use it.

| Query | Meaning |
|---|---|
| `format` | `png` (default), `svg`, `webp`, `jpeg`, `xml` |
| `version` | Default: the live version. Old versions are immutable and cached for a day by the browser. |
| `board` | A board path from `canvas.json`: only that board, exactly its size. Default: the whole canvas with 48 px around it (`padding`, 0 to 400). |
| `scale` | 0.1 to 4 (default 1). |
| `max` | Longest edge in px; lowers the scale to fit. Hard limits apply regardless: 8192 px per edge, 36 megapixels, scale 4. The response says what was used (`X-Render-Size`, `X-Render-Scale`). |
| `background` | `canvas` (default, the theme's canvas colour), `white`, `transparent` (not for jpeg) or `#rrggbb`. |
| `theme` | `light` (default) or `dark`: default ink, canvas and title colours. Boards stay white, like in the viewer. |
| `width`, `height` | Page size for a single-page artifact (default 1280x800; the picture grows to the page's height, up to 8000). |
| `quality` | 10 to 100 for webp and jpeg (default 85). |
| `html` | `0` skips the headless browser and draws boards as text outlines. |
| `download` | Any value: `Content-Disposition: attachment`. |

**How it is drawn.** `shared/canvasRender.ts` turns `canvas.json` into SVG: stickies, text, rectangles, ovals (with hatch fills and labels), lines, arrows
(bound arrows end on their targets), pen strokes, images, board frames and titles, laid out with the same geometry and style code as the viewer
(`shared/canvasGeometry.ts`, `shared/canvasStyle.ts`). Text is wrapped with the real font's metrics (Liberation Sans, bundled in `server/assets/fonts`,
SIL OFL). The SVG is true vector output; PNG, WebP and JPEG rasterize it with [resvg](https://github.com/yisibl/resvg-js) (prebuilt for linux amd64/arm64, no
system libraries) and wasm encoders. The SVG has no scripts, no `foreignObject` and no external references; every string and number from `canvas.json`
is escaped or validated, images are embedded only after their bytes check out as png/jpeg/gif/webp, and the response carries a sandbox CSP.

**Board HTML.** Boards are real web pages, which a vector renderer cannot draw. If a Chromium is installed they are drawn by it and embedded as
pictures; otherwise each board is a frame with the page's text (headings, paragraphs, buttons...) and the response header `X-Render-Boards: outline`
(`screenshot` when drawn for real). The browser is found at `HUB_CHROMIUM`, `/usr/bin/chromium*`, Chrome, or a Playwright download in `~/.cache/ms-playwright`.
Boards run in a fresh context with **no network** (requests, WebSockets and WebRTC are blocked; only the artifact's own files are served to them) and a time limit per board. `HUB_CHROMIUM_NO_SANDBOX=1` adds `--no-sandbox`
for containers that cannot start the sandbox; that lets page scripts run with less isolation, so enable it only if you trust the artifacts' authors.
`HUB_RENDER_HTML=0` turns the browser off. The published image includes one; a plain `docker build .` has none, add it with `--build-arg WITH_CHROMIUM=1` (about +350 MB). The zoomed-out canvas uses it too: without a browser, boards load as live pages at every zoom.
`HUB_RENDER_SYSTEM_FONTS=1` also loads system fonts (for scripts the bundled font lacks, e.g. CJK, which otherwise render as boxes).

**Cache and load.** Finished renders and board pictures are cached in memory (96 MB, keyed by artifact, version and options, with ETags); two renders run at once,
twelve may wait, then 503.

**XML** (`urn:artifact-hub:scene:1`) is the resolved scene for tools that read a canvas rather than look at it:
```xml
<scene xmlns="urn:artifact-hub:scene:1" version="1" artifact="…" artifactVersion="3" title="…" theme="light" background="#e6e6e6" x="-48" y="-218" width="1000" height="784">
  <board path="screens/Home.html" title="Home" x="0" y="0" width="640" height="420" interactive="true" render="screenshot|outline">
    <outline><line size="32" bold="true">Team lunch</line>…</outline>       <!-- only render="outline" -->
  </board>
  <note id="n1" kind="sticky" x="0" y="-170" width="260" height="96" fill="yellow" size="13"><text>Context for reviewers</text></note>
  <note id="n5" kind="arrow" x="640" y="210" width="160" height="30" arrowEnd="arrow"><bind end="start" type="board" target="screens/Home.html"/>…</note>
  <note id="n7" kind="pen" …><points><p x="0" y="0"/>…</points></note>
</scene>
```
Boards come in the viewer's order, notes back to front. Geometry is what is drawn (bound arrows resolved, sticky and text heights measured), in canvas px; colours are `#rrggbb` or a named fill.

## Admin (owner)
Under **Admin**: Overview (MCP endpoint, storage), Members (invite, roles, remove), Clients (every OAuth grant with its member, scopes,
last use; revoke), Share links (all active links across artifacts) and Activity (published, comments, links, clients, members).
Members also see and revoke their own clients under **Account**.

## Connecting a client
- **Remote connectors (claude.ai etc.)**: add `https://<your host>/mcp`. The client discovers OAuth via
  `/.well-known/oauth-protected-resource`, registers itself (`/oauth/register`), and sends you to `/oauth/authorize`, which
  signs you in if needed and opens the consent screen. There you choose what to allow: read (always), comment, publish and edit,
  share. OAuth 2.1: PKCE (S256) only, public clients, single-use codes, 1 h access tokens, 30 d refresh tokens with rotation and
  reuse detection (a replayed refresh token revokes the whole grant), `/oauth/revoke`.
- A grant belongs to the member who approved it and can never exceed that member's role (commenters get read and comment only).
  Tools outside the grant are not offered. Removing a member revokes their grants.
- There is no static bearer token. Scripts connect the same way as any client, or use the development login above.
- Serve over HTTPS in production (cookies are `secure` outside dev).

## window.artifact (interactive pages)
Every HTML page gets `window.artifact`; calls go through the viewer, so the sandboxed page never holds credentials.
```js
const info = await artifact.ready                        // { viewer:{name,role,canWrite}, ... } or null outside the viewer
await artifact.shared.set('poll/ada', { choice: 'A' })   // everyone using the artifact; survives new versions
await artifact.personal.get('draft')                     // only the current viewer (owner, or commenter e-mail)
await artifact.shared.list('poll/')                      // [{ key, value, updatedAt, updatedBy }]
artifact.shared.onChange(({ keys }) => render())         // live (server-sent events)
```
Values are JSON, 256 KB each, 20 MB per artifact. View-only links read but cannot write. The model reads and
writes the shared scope with the `data_*` tools. The viewer receives live version, comment and data changes over SSE
(a 30 s poll remains as a safety net). The stream sends `X-Accel-Buffering: no` and an immediate `ready` event; the viewer
resyncs whenever it reconnects. Behind a proxy, keep response buffering and compression off for `/api/view/*/events`
(nginx honours the header; Traefik/Caddy/Cloudflare need their own flush settings). Not yet tested through a real proxy.

## Viewer
- **Canvas:** scroll = pan, pinch/Ctrl+scroll = zoom, `0` fits all. Click a board to select it, double-click an interactive board to use it.
- **Focus:** the ⤢ button on a board (or `F`) expands it to fill the canvas area; `←`/`→` step through boards, `Esc` returns. Page-type boards (`"expand": "fill"`) reflow to the window.
- **Present:** the canvas takes the whole app window (header and sidebar hide) and steps through the boards in `order` (arrow keys, `Esc` to leave). It does not use browser fullscreen.
- **Comments:** the composer and thread open as a popover on the marker and follow pan/zoom; the sidebar is only an overview list.
- **Edit** (header, owner only; live version only) has two levels, like Claude's design view:
  - **Canvas level:** a floating toolbar (Select `V`, Hand `H`, Text `T`, Board `A`, Sticky `S`, Rectangle `R`, Oval `O`, Arrow `L`,
    Pen `P`). Drag to move boards, resize them with the 8 handles, rename a board by double-clicking its title, drag-draw shapes and
    new boards, click to drop sticky notes and text. Board headers carry Tweaks, download, full window and PLAY. Everything is saved to
    `canvas.json` (new boards create a starter file); notes and shapes draw above the boards.
  - **Element level** (double-click a board, or open a single page): click an element to select it, double-click text to retype it,
    **dragging moves an element anywhere by default** (it lands where you let go; Alt reorders in the flow instead, and the panel's
    Dragging switch flips the default), **drag palette items in**.
  - **Free placement:** Position → Free (or hold **Alt** and drag any element) takes an element out of the flow without it jumping.
    Drag to move, 8 handles resize (Shift keeps the aspect ratio), arrow keys nudge (Shift = 10 px), it snaps to its container and
    neighbours with guide lines, and the Align row centres or pins it to the container. Its parent becomes the positioning context
    and keeps its height. Flow puts it back.
  - **Layers at canvas level:** the panel lists every note, shape and board; a board expands into its element tree, and picking an
    element opens that board with the element selected.
  - **Panel tabs:** *Properties* (layer tree; position, align; size with Hug/Fixed/Fill, min width, grow; layout Block/Stack/Grid with
    direction, align, distribute, wrap, gap; padding and radius as one value or per side/corner; fill, opacity, border style/colour/
    width; text presets, font, weight, size, spacing, line height, colour with a WCAG contrast check, align; shadow; image/link
    attributes; id/class/aria-label; Copy HTML, Download board), *Code* (the selected element's source, or any text file, with
    Apply), *Tweaks* (the levers a `.dc.html` board declares in `data-props`, previewed live and saved per board in `canvas.json`).
  - Edits show instantly, are batched (about one saved version per burst) and replayed by the server on the stored source as exact
    string splices, so only the edited bytes change. A batch is refused with 409 if the artifact changed elsewhere meanwhile.
  - Elements are addressed by `data-hub-id`. Boards are served with provisional ids (`data-hub-pid`); the first saved edit makes
    them permanent in the file. The MCP `guide` tells the model to keep them.
  - Script-generated elements have no id and cannot be edited. Text bound to template `{{holes}}` in `.dc.html` boards can be styled
    but not retyped (use the Code tab). Undo reverts the last saved batch, or discards unsaved edits.
  - **Drag and drop:** blue line = before/after, dashed box = inside an empty container; Esc cancels; tables' rows never receive
    foreign children; on `.dc.html` boards a drop on the page lands inside `<x-dc>`.
- **Artifact menu** (title, owner only): Share, Export as image…, Export `.zip`, Duplicate, Rename, Pin, Refresh, Delete.

## Design Component boards (`.dc.html`) and import
- Boards written in Claude's Design format (`<x-dc>` templates, `{{holes}}`, `<sc-for>`, `<sc-if>`, `<dc-import>`, `DCLogic`)
  render through our own runtime (`server/assets/dc/dc-runtime.js` on React 18, MIT). It is served for any `./support.js`
  request; a runtime shipped inside an import is never stored or used. It follows the documented syntax only: no
  properties panel, tweaks UI, guides, pages, print flow or design-system mounting. Links between boards are plain
  relative `href`s and navigate inside the frame.
- **Import .zip** (artifact list): accepts our own exports and Design exports. The archive root is the folder holding
  `canvas.json` (else `index.html`); everything outside it is dropped. Hostile archives are bounded (entries, inflated
  size, path traversal). `POST /api/artifacts/import` takes the raw zip bytes.
- **Import pages saved from claude.ai** (MCP `request_import`, `list_imports`). The agent never carries file content:
  `request_import {source_url, source_version, workspace?, dry_run?}` returns a link (`PUT /api/import/upload/<token>`, valid
  once, at most 60 minutes, bound to the requesting member, up to 16 MB); the file goes there with `curl --data-binary`, and
  the answer is the report (`status` imported|skipped|failed, `action` created|updated, `hub_url`, `boards`, `warnings`,
  `reason`). A page with `<script type="application/json" id="appifact-doc">` becomes a canvas (`title`, `launch`; `artboards`
  become `boards` and `order`, `annotations` become `notes`; the editor shell, `support.js` and `vendor/react*.js` are dropped);
  any other page becomes `index.html`. The page is only parsed, nothing in it runs. Rejected for that artifact only: paths with
  `..`, absolute paths, `_shared/`, boards or notes over 8000 px, more than 1000 notes. Warnings: unknown fields (never dropped
  silently), comments (not imported), `window.claude` calls. `source_url` is the key: the same `source_version` is skipped
  (no link is issued), a new one adds a hub version to the same artifact (files no longer in the source are removed in that
  version). The artifact and its ledger entry commit in one transaction, so an import is whole or absent. New artifacts are
  private. `dry_run` does everything except create. Tables: `import_sources` (key), `import_requests` (log, source of `list_imports`).

## Model
- Artifact = versioned file set. Patch publishes (unnamed files carry over), `base_version` conflict check.
- `canvas.json` + one HTML file per board = a canvas (same shape as Claude Design's). Otherwise `index.html`.
- Boards render in sandboxed iframes served from `/f/<token>@<version>/…` with `Content-Security-Policy: sandbox`.
  No cookies reach them; access is the path token.
- Share links (`/s/<token>`): `view` or `comment`. Commenters give an e-mail (unverified, stored in a cookie).
- Comments anchor to board + element (CSS path + text fingerprint) and are re-located on newer versions.

## UI
The app chrome uses shadcn-vue (new-york, Tailwind v4, reka-ui, `@lucide/vue`); components live in `app/components/ui`. New UI must use them, no plain HTML controls.

## Credits
`shared/vendor/open-design/` is copied from https://github.com/nexu-io/open-design (Apache-2.0): preview
sandbox/redirect guards and tag-aware HTML injection helpers. See NOTICE.md there.

## Not done yet
- OAuth: no grant-management UI yet (revoke via `/oauth/revoke`; removing a member revokes theirs), no rate limiting on
  `/oauth/register` and `/oauth/token` (put a reverse-proxy limit in front).
- Members: invitations are links (no mailer), so there is no password reset by e-mail and no e-mail verification.
- `window.artifact`: no "ask Claude" call, no connectors, no file uploads; personal-scope changes are not pushed live.
- Templates (doc, slides, dashboard) and design systems; the canvas is the only structured type.
- Verified e-mail for commenters.
- Wheel zoom/pan is disabled while comment mode is on (the iframe takes the wheel).
- Browser coverage: the editor, canvas tools, tweaks, code tab, comments, present and the storage bridge were exercised in headless Chromium (Playwright). Not covered: touch/mobile, Safari/Firefox, drawing with a real pen/trackpad.
