# Contributing

Issues and pull requests are welcome.

## Setup

Node 24 or newer.

```bash
npm install
npm run dev:login   # http://localhost:3000, signed in automatically (dev only)
```

## Before you open a pull request

- `npm run build` succeeds.
- `npm run test:unit` passes. For API changes, run the matching script in `tests/` against `PORT=3111 npm run dev:login`.
- UI follows [DESIGN.md](DESIGN.md): controls come from `app/components/ui` (shadcn-vue), and both light and dark themes work.
- Keep the UI honest: no placeholder pages, fake numbers or dead controls (see [PRODUCT.md](PRODUCT.md)).
- Never commit secrets. `.env*` files are ignored, and a production build refuses to start with the dev-login variables set.

## Layout

| Path | Contents |
|---|---|
| `app/` | Nuxt app: pages, components, composables |
| `server/` | API routes, MCP server, OAuth, storage, rendering |
| `shared/` | Code used by both (canvas operations, geometry) |
| `tests/` | API tests (`*.mjs`), unit tests and browser tests (`e2e/`) |
| `ui-library/` | The app's components as plain CSS plus showcase boards |
| `demo/` | Sample canvas used by `scripts/seed-demo.mjs` |
| `docs/` | Reference documentation |
| `site/` | Static landing page, deployed to GitHub Pages by `.github/workflows/pages.yml` |
