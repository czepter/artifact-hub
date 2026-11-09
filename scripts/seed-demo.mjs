// Publishes the sample design canvas in demo/ (three boards, a comment thread and the model's answer) to a hub.
// Used for the landing-page screenshots and to give a fresh instance something to look at.
//   HUB=http://localhost:3000 HUB_TOKEN=<bearer token> node scripts/seed-demo.mjs
// Prints the artifact URL and a view-only share link. Re-running creates another copy.
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HUB = process.env.HUB ?? 'http://localhost:3000'
const TOKEN = process.env.HUB_TOKEN ?? 'devtoken'
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo')

const mcp = async (name, args) => {
  const r = await fetch(`${HUB}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  const t = await r.text(); const res = JSON.parse(t.match(/data: (.*)/)?.[1] ?? t).result
  if (res.isError) throw new Error(res.content[0].text)
  return JSON.parse(res.content[0].text)
}

const boards = (await readdir(join(root, 'boards'))).filter(f => f.endsWith('.html'))
const files = [
  { path: 'canvas.json', content: await readFile(join(root, 'canvas.json'), 'utf8') },
  ...await Promise.all(boards.map(async f => ({ path: `boards/${f}`, content: await readFile(join(root, 'boards', f), 'utf8') }))),
]
const a = await mcp('create_artifact', { title: 'Northwind: pricing, onboarding, dashboard', files, label: 'First draft' })

const post = async (body) => {
  const r = await fetch(`${HUB}/api/view/${a.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`comment -> ${r.status} ${await r.text()}`)
  return r.json()
}
const root1 = await post({
  body: 'The “Most popular” tag is easy to miss. Can the Team plan stand out more, and should the trial button say what happens after 14 days?',
  board: 'boards/pricing.html', anchor: { selector: 'html > body > section.grid > div.plan.pop > span.tag', tag: 'span', text: 'Most popular', rel: { x: 0.5, y: 0.5 }, click: { x: 0.5, y: 0.5 } }, version: a.version,
})
await mcp('reply_comment', { id: a.id, comment_id: root1.id, body: 'Agreed. I would give the Team card a heavier border and change the button to “Start 14-day trial, no card needed”. Starter and Enterprise can stay as they are. Want me to publish that as the next version?' })
const share = await mcp('share_link', { id: a.id, role: 'view' })
console.log(JSON.stringify({ artifact: a.id, open: a.url, share: share.url }, null, 2))
