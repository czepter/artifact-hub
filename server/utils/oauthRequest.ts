import type { H3Event } from 'h3'
import { getClient, resourceUrl } from './oauth'

export const PARAMS = ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope'] as const

export function collect(src: Record<string, unknown>) {
  const out: Record<string, string> = {}
  for (const k of PARAMS) if (typeof src[k] === 'string') out[k] = src[k] as string
  return out
}

/** Validates everything that decides whether we may redirect. Returns an error string, or the client. */
export function check(event: H3Event, q: Record<string, string>) {
  const client = q.client_id ? getClient(q.client_id) : null
  if (!client) return { fatal: 'Unknown client. Register it first (POST /oauth/register).' }
  // Never redirect to an unregistered URI: show the error instead.
  if (!q.redirect_uri || !client.redirect_uris.includes(q.redirect_uri)) return { fatal: 'The redirect URI does not match this client\'s registration.' }
  if (q.response_type !== 'code') return { client, redirectError: 'unsupported_response_type' }
  if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge ?? '')) return { client, redirectError: 'invalid_request' }
  if (q.resource && q.resource !== resourceUrl(event)) return { client, redirectError: 'invalid_target' }
  return { client }
}

export function redirectUrl(q: Record<string, string>, params: Record<string, string>) {
  const u = new URL(q.redirect_uri!)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  if (q.state) u.searchParams.set('state', q.state)
  return u.toString()
}
