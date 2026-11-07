# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner publishes visuals and design canvases through a chat model that talks to the hub over MCP, then reviews, edits and shares them in the browser. Guests open view or comment links to look at an artifact and leave comments anchored to a board or element. The model reads those comments and answers them. Team use is the next step: members will sign in with better-auth (e-mail and password, passkeys, and GitHub when its credentials are set in the environment), with roles owner, editor and commenter. Today the backend still supports exactly one owner, and guests are identified by an unverified e-mail.

## Product Purpose

A self-hosted alternative to claude.ai artifacts. It stores versioned file sets, serves them in sandboxed iframes, offers a canvas viewer and editor, and keeps a review loop (comments, replies, resolve) that a model can drive. Success: the owner publishes something, reviews it, and has the conversation about it without a third-party service holding the work.

## Positioning

The owner holds the data and the credentials. The review loop is built for a model on the other end of MCP, not just a human, and the hub sits on the owner's own infrastructure.

## Operating Context

Runs on the owner's machine or LAN host, optionally behind a reverse proxy over HTTPS. The model connects via `POST /mcp` with OAuth 2.1 only. Each grant belongs to the member who approved it, is capped by that member's role, and is narrowed on a consent screen (read, comment, publish and edit, share). Members sign in with better-auth. The first account, created at first run, is the owner; after that sign-up is invite-only. `NUXT_ADMIN_TOKEN` is to be retired. Artifacts are either a single `index.html` or a canvas (`canvas.json` plus one HTML file per board, including `.dc.html` Design Component boards).

## Capabilities and Constraints

- Routes today: `/` (artifact list, sign-in), `/dashboard`, `/a/:id` (viewer, canvas, editor, comments, present), `/s/:token` (share link view), `/account`, `/oauth/consent`, `/invite/:token`, and for the owner `/admin` (overview, members, clients, share links, activity).
- Viewer: pan/zoom canvas, focus, present, comment popovers, owner edit with layers/properties/code/tweaks panels, artifact menu (share, export, duplicate, rename, pin, refresh, delete).
- Not built yet, so the UI must not pretend otherwise: OAuth token-management UI, members and roles (better-auth decided, not implemented), verified commenter e-mail, templates (doc, slides, dashboard), design systems.
- Stack is fixed: Nuxt 4, shadcn-vue (new-york) on reka-ui, Tailwind v4, `@lucide/vue`. All controls come from `app/components/ui`; no plain HTML controls.
- Light and dark themes are both supported.
- Admin pages that need missing backend are out of scope.
- Server settings (base URL, database path, tokens, auth provider secrets) live in the environment and are never shown in the UI.

## Brand Commitments

The app chrome stays neutral. Published artifacts are the content, and the hub UI must recede and never compete with them. No product logo or brand identity beyond the name "Artifact Hub" has been established.

## Evidence on Hand

README.md documents the model and features. The design canvas "Artifact Hub – App chrome" (published on the owner's hub) holds app-chrome boards. There are no customers, testimonials, metrics or usage data; none may be invented.

## Product Principles

1. The artifact is the subject; chrome is quiet, dense enough for repeat use, and never decorative.
2. Show only what the backend can do. No placeholder pages, fake stats or dead controls.
3. The owner and the model share one review loop; state (version, open comments, who said what) is always legible.
4. Ownership is visible: where the data lives, who can see a link, and what a link permits.
5. Every control is a shadcn-vue component, keyboard-reachable, in light and dark.

## Accessibility & Inclusion

No product-specific standard was stated. Working target: WCAG 2.1 AA, keyboard operability for the viewer and all menus, visible focus, and `prefers-reduced-motion` respected.
