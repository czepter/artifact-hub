// Render isolation: untrusted board HTML drawn for thumbnails must not reach the network or stall drawing.
//
//   node .output/server/index.mjs   (HUB_DB pointing at a throwaway database)
//   node tests/e2e/bt-render-isolation.mjs   (HUB=http://localhost:3199)
import net from 'node:net'
import dgram from 'node:dgram'
import { request } from 'playwright-core'

const B = process.env.HUB || 'http://localhost:3199'
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Throwaway account on the local benchmark database only.
const ACCOUNT = { email: 'perf@example.test', password: 'perf-local-benchmark', name: 'Perf' }

let tcp = 0, udp = 0
const tcpSrv = net.createServer((s) => { tcp++; s.on('error', () => {}); s.destroy() })
await new Promise(r => tcpSrv.listen(0, '127.0.0.1', r))
const PORT = tcpSrv.address().port
const udpSock = dgram.createSocket('udp4')
udpSock.on('message', () => { udp++ })
await new Promise((res, rej) => { udpSock.once('error', rej); udpSock.bind(PORT, '127.0.0.1', res) })

const net_ = `<!doctype html><body>net<script>
const t = f => { try { f() } catch (e) {} }
t(() => new WebSocket('ws://127.0.0.1:${PORT}/a'))
t(() => fetch('http://127.0.0.1:${PORT}/b', { mode: 'no-cors' }).catch(() => {}))
t(() => { new Image().src = 'http://127.0.0.1:${PORT}/c' })
t(() => new Worker(URL.createObjectURL(new Blob(["new WebSocket('ws://127.0.0.1:${PORT}/d')"]))))
t(() => { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${PORT}' }] }); pc.createDataChannel('x'); pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {}) })
</script></body>`
const hang = `<!doctype html><body>hang<script>addEventListener('load', () => setTimeout(() => { for (;;); }, 0))</script></body>`
const ok = t => `<!doctype html><body style="font:48px system-ui">${t}</body>`
const P = { net: 'screens/net.html', hang: 'screens/hang.html', ok: 'screens/ok.html' }
const canvas = { v: 3, title: 'Isolation fixture', launch: { view: 'canvas' }, order: Object.values(P),
  boards: Object.fromEntries(Object.values(P).map((p, i) => [p, { x: i * 1300, y: 0, w: 1200, h: 700, title: p }])) }

let bad = 0
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`) }
const api = await request.newContext({ extraHTTPHeaders: { origin: B } })
let r = await api.post(`${B}/api/auth/sign-in/email`, { data: ACCOUNT })
if (!r.ok()) r = await api.post(`${B}/api/auth/sign-up/email`, { data: ACCOUNT })
if (!r.ok()) throw new Error(`sign-in failed: ${r.status()}`)
r = await api.post(`${B}/api/artifacts`, { data: { title: 'Isolation fixture', files: [
  { path: 'canvas.json', content: JSON.stringify(canvas) }, { path: P.net, content: net_ }, { path: P.hang, content: hang }, { path: P.ok, content: ok('ok 1') }] } })
if (!r.ok()) throw new Error(`publish failed: ${r.status()} ${await r.text()}`)
const id = (await r.json()).id

// {status, ms}; a timeout is status 0, never a crash.
const thumb = async (path, ms, extra = '') => {
  const t0 = Date.now()
  try { const res = await api.get(`${B}/api/view/${id}/thumb?path=${encodeURIComponent(path)}${extra}`, { timeout: ms }); return { status: res.status(), ms: Date.now() - t0 } }
  catch { return { status: 0, ms: Date.now() - t0 } }
}
const d = x => `status=${x.status || 'timeout'} ${x.ms}ms`

// 1. network isolation
let x = await thumb(P.net, 60000)
await sleep(1500)
check('net.html draws and reaches no network', x.status === 200 && !tcp && !udp, `${d(x)} tcp=${tcp} udp=${udp}`)

// 2-4. a hanging board must neither hang the request nor stall the queue, and is not redrawn every time
x = await thumb(P.hang, 40000)
check('hang.html answers non-200 within 40s', x.status !== 200 && x.status !== 0, d(x))
x = await thumb(P.ok, 20000)
check('ok.html drawn after hang (queue not stalled)', x.status === 200, d(x))
x = await thumb(P.hang, 2000)
check('hang.html again answers fast', x.status !== 200 && x.status !== 0 && x.ms < 2000, d(x))

// 5. malformed versions
for (const v of ['abc', '999']) {
  x = await thumb(P.ok, 10000, `&v=${v}`)
  check(`v=${v} answers non-200 below 500`, x.status !== 200 && x.status >= 1 && x.status < 500, d(x))
}

// 6. old versions cannot force drawing
r = await api.post(`${B}/api/artifacts/${id}/source`, { data: { path: P.ok, baseVersion: 1, source: ok('ok 2 changed') } })
if (!r.ok()) throw new Error(`update failed: ${r.status()} ${await r.text()}`)
const v2 = (await r.json()).version
let drawn = { status: 0, ms: 0 }
for (let t0 = Date.now(); drawn.status !== 200 && Date.now() - t0 < 60000; await sleep(500)) drawn = await thumb(P.ok, 30000, `&v=${v2}`)
check('new version ok.html drawn', drawn.status === 200, d(drawn))
x = await thumb(P.ok, 10000, '&v=1')
check('old v=1 cannot force drawing', x.status !== 200 && x.status !== 0 && x.ms < 2000, d(x))
x = await thumb(P.ok, 10000)
check('current version still served from store', x.status === 200 && x.ms < 2000, d(x))

await api.dispose()
tcpSrv.close(); udpSock.close()
process.exit(bad ? 1 : 0)
