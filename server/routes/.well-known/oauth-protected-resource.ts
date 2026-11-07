import { baseUrl, cors, resourceUrl, SCOPES } from '../../utils/oauth'

// RFC 9728. MCP clients find the authorization server from here after a 401 on /mcp.
export default defineEventHandler((event) => {
  if (cors(event)) return ''
  return {
    resource: resourceUrl(event),
    authorization_servers: [baseUrl(event)],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Artifact Hub',
  }
})
