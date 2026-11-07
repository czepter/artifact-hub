const [tool, args] = process.argv.slice(2)
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer devtoken' }
const rpc = async (body) => {
  const r = await fetch('http://localhost:3111/mcp', { method: 'POST', headers: H, body: JSON.stringify(body) })
  const t = await r.text(); const m = t.match(/data: (.*)/)
  return { status: r.status, body: m ? JSON.parse(m[1]) : t }
}
if (tool === 'tools') console.log(JSON.stringify((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools.map(t => t.name)))
else { const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: JSON.parse(args || '{}') } }); console.log(r.status, r.body.result?.content?.[0]?.text ?? JSON.stringify(r.body)) }
