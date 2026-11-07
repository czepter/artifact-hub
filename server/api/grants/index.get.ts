import { requireMember } from '../../utils/auth'
import { useDb } from '../../utils/db'

// Connected clients: one row per OAuth grant (token family) that is still usable. Owners see everyone's, members their own.
export default defineEventHandler((event) => {
  const me = requireMember(event)
  const nowS = Math.floor(Date.now() / 1000)
  const rows = useDb().prepare(`
    SELECT r.family, c.name AS client, r.user_id, u.name AS member_name, u.email AS member_email, r.scope, r.expires_at AS refresh_expires,
           (SELECT MIN(NULLIF(created_at, 0)) FROM oauth_tokens x WHERE x.family = r.family) AS authorized_at,
           (SELECT MAX(last_used) FROM oauth_tokens x WHERE x.family = r.family) AS last_used
    FROM oauth_tokens r
    JOIN oauth_clients c ON c.client_id = r.client_id
    LEFT JOIN "user" u ON u.id = r.user_id
    WHERE r.kind = 'refresh' AND r.revoked = 0 AND r.expires_at > ?
    ORDER BY last_used IS NULL, last_used DESC, authorized_at DESC
  `).all(nowS) as { user_id: string | null }[]
  return me.role === 'owner' ? rows : rows.filter(r => r.user_id === me.id)
})
