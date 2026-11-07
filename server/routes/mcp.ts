import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildMcpServer } from '../utils/mcp'
import { baseUrl, cors, mcpCaller } from '../utils/oauth'

// Stateless streamable-HTTP MCP endpoint. Accepts OAuth 2.1 access tokens only, each tied to the member who approved it; on 401 it points clients at the protected-resource metadata (RFC 9728).
export default defineEventHandler(async (event) => {
  if (cors(event)) return ''
  const caller = mcpCaller(event)
  if (!caller) {
    setResponseHeader(event, 'WWW-Authenticate', `Bearer resource_metadata="${baseUrl(event)}/.well-known/oauth-protected-resource", scope="read comment write share"`)
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  event.context.member = caller.member
  if (event.method !== 'POST') {
    setResponseStatus(event, 405)
    setResponseHeader(event, 'Allow', 'POST')
    return { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null }
  }
  const body = await readBody(event)
  const server = buildMcpServer(baseUrl(event), caller.scopes)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  event.node.res.on('close', () => { transport.close(); server.close() })
  await server.connect(transport)
  await transport.handleRequest(event.node.req, event.node.res, body)
  event._handled = true
})
