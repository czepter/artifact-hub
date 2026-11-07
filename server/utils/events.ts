import { useDb, now } from './db'

/** Appends to the activity log. The actor is the signed-in member of the current request (a guest shows by e-mail; background work shows as "system"). */
export function logEvent(kind: string, subject = '', actor?: string) {
  let who = actor
  if (!who) {
    try {
      const ev = useEvent()
      who = ev.context.member?.name || ev.context.member?.email || ev.context.actor
    } catch { /* outside a request */ }
  }
  useDb().prepare('INSERT INTO events (at, actor, kind, subject) VALUES (?, ?, ?, ?)').run(now(), who || 'system', kind, subject.slice(0, 200))
}
