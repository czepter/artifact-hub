const [base, token] = process.argv.slice(2)
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }
const mcp = async (name, args) => { const r = await fetch(`${base}/mcp`, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); const t = await r.text(); const m = t.match(/data: (.*)/); const res = JSON.parse(m[1]).result; if (res.isError) throw new Error(res.content[0].text); return JSON.parse(res.content[0].text) }

const css = `*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#faf9f7;color:#1c1b19}header{padding:28px 32px;background:#1c1b19;color:#fff}h1{margin:0;font-size:28px}main{padding:28px 32px;display:grid;gap:16px;max-width:760px}button{padding:10px 16px;border-radius:8px;border:0;background:#c8553d;color:#fff;font:inherit;cursor:pointer}button.alt{background:#e9e5dc;color:#1c1b19}.card{background:#fff;border:1px solid #e4e1da;border-radius:12px;padding:16px}.bar{height:10px;border-radius:5px;background:#e9e5dc;overflow:hidden}.bar>i{display:block;height:100%;background:#c8553d;transition:width .3s}small{color:#6b675f}`
const home = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<header><h1 id="hero">Team lunch poll</h1><small style="color:#bbb" id="who">connecting…</small></header>
<main>
<p>Where should we eat on Friday? Votes are shared live between everyone who has this open.</p>
<div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap"><button data-v="pizza">Pizza</button><button data-v="ramen">Ramen</button><button data-v="salad" class="alt">Salad</button></div></div>
<div class="card" id="results"></div>
<div class="card"><strong>Your private note</strong> <small>(personal storage — only you see this)</small><br><input id="note" placeholder="Type something…" style="width:100%;padding:8px;margin-top:6px;border:1px solid #e4e1da;border-radius:8px"></div>
</main>
<script>
const opts = ['pizza','ramen','salad']; let me = null;
async function render(){
  const rows = await artifact.shared.list('vote/');
  const counts = Object.fromEntries(opts.map(o => [o, 0])); rows.forEach(r => { if (counts[r.value.choice] !== undefined) counts[r.value.choice]++ });
  const total = rows.length || 1;
  results.innerHTML = opts.map(o => '<div style="margin:8px 0"><div style="display:flex;justify-content:space-between"><span>'+o+'</span><b>'+counts[o]+'</b></div><div class="bar"><i style="width:'+(counts[o]/total*100)+'%"></i></div></div>').join('') + '<small>'+rows.length+' vote(s)</small>';
}
artifact.ready.then(async info => {
  me = info; who.textContent = info ? 'signed in as ' + info.viewer.name + ' (' + info.viewer.role + (info.viewer.canWrite ? '' : ', read-only') + ')' : 'not in viewer';
  if (!info) { results.textContent = 'Open this inside Artifact Hub.'; return }
  await render(); artifact.shared.onChange(render);
  note.value = (await artifact.personal.get('note')) || '';
});
document.querySelectorAll('button[data-v]').forEach(b => b.onclick = async () => {
  try { await artifact.shared.set('vote/' + me.viewer.name, { choice: b.dataset.v }); } catch (e) { alert(e.message) }
});
note.onchange = () => artifact.personal.set('note', note.value).catch(e => alert(e.message));
</script></body></html>`
const settings = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><header><h1>Settings</h1></header><main><div class="card"><label>Name <input value="Ada" style="padding:6px"></label></div><div class="card"><ul><li>Profile</li><li>Billing</li><li>Team</li><li>Notifications</li></ul><button>Save changes</button></div></main></body></html>`
const login = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><header><h1>Sign in</h1></header><main><div class="card" style="display:grid;gap:10px"><input placeholder="E-mail" style="padding:8px"><input placeholder="Password" type="password" style="padding:8px"><button>Continue</button><small>Forgot your password?</small></div></main></body></html>`
const canvas = { v: 3, title: 'Test canvas', launch: { view: 'canvas' },
  boards: {
    'screens/Poll.html': { x: 0, y: 0, w: 860, h: 620, title: 'Poll (interactive, double-click)', is_interactive: true },
    'screens/Settings.html': { x: 980, y: 0, w: 560, h: 620, title: 'Settings', is_interactive: true },
    'screens/Login.html': { x: 0, y: 740, w: 560, h: 420, title: 'Sign in' } },
  order: ['screens/Poll.html', 'screens/Settings.html', 'screens/Login.html'],
  notes: { t1: { x: 0, y: -180, w: 900, text: 'Test canvas', kind: 'title1' }, n1: { x: 0, y: -90, w: 700, text: 'Scroll = pan · pinch or Ctrl+scroll = zoom · double-click an interactive board to use it · Comment (top right) then click anything.', size: 's' } } }
const a = await mcp('create_artifact', { title: 'Test canvas', files: [
  { path: 'canvas.json', content: JSON.stringify(canvas) }, { path: 'screens/Poll.html', content: home },
  { path: 'screens/Settings.html', content: settings }, { path: 'screens/Login.html', content: login }] })
const single = await mcp('create_artifact', { title: 'Single page', files: [{ path: 'index.html', content: `<!doctype html><html><head><style>${css}</style></head><body><header><h1>Single-page artifact</h1></header><main><p>No canvas.json, so this fills the viewer. Comment on anything here.</p><div class="card"><button onclick="this.textContent='Clicked'">Click me</button></div></main></body></html>` }] })
const c = await mcp('share_link', { id: a.id, role: 'comment' }), v = await mcp('share_link', { id: a.id, role: 'view' })
console.log(JSON.stringify({ canvas: a.url, single: single.url, commentLink: c.url, viewLink: v.url }, null, 1))
