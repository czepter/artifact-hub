import { resolveAccess } from '../../../utils/auth'
import { onArtifact } from '../../../utils/bus'

// Server-sent events: new versions, comment changes, shared-data changes.
export default defineEventHandler(async (event) => {
  const access = resolveAccess(event, getRouterParam(event, 'ref')!)
  const stream = createEventStream(event)
  // Flush the response head right away: without a first write the client sees no 'open' (and proxies see
  // an idle request) until the first real event or the 25 s heartbeat.
  stream.push({ event: 'ready', data: '{}' })
  const off = onArtifact(access.artifactId, ev => { stream.push({ event: ev.type, data: JSON.stringify(ev) }) })
  const beat = setInterval(() => { stream.push({ event: 'ping', data: '1' }) }, 25_000)
  stream.onClosed(() => { off(); clearInterval(beat) })
  return stream.send()
})
