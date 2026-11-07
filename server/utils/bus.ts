import { EventEmitter } from 'node:events'

// In-process pub/sub for live updates. SQLite means one node, so this is enough; swap for
// Redis/NATS if you ever run several instances. Kept on globalThis so dev reloads share one bus.
const g = globalThis as unknown as { __hubBus?: EventEmitter }
const bus = (g.__hubBus ??= new EventEmitter().setMaxListeners(0))

export type HubEvent =
  | { type: 'version', version: number }
  | { type: 'comments' }
  | { type: 'meta' }
  | { type: 'data', scope: 'shared', keys: string[] }

export const emitArtifact = (artifactId: string, ev: HubEvent) => { bus.emit(artifactId, ev) }

export function onArtifact(artifactId: string, fn: (ev: HubEvent) => void) {
  bus.on(artifactId, fn)
  return () => { bus.off(artifactId, fn) }
}
