// Builds a page the way claude.ai saves a Design artifact: a large outer shell (editor code) with the document as JSON in
// <script type="application/json" id="appifact-doc">. Synthetic: the real format is only known from one sample.
export const BOARDS = [
  { file: 'overview.dc.html', x: 0, y: 0, w: 1440, h: 900, title: 'Overview' },
  { file: 'keywords.dc.html', x: 1560, y: 0, w: 1440, h: 900, title: 'Keywords' },
  { file: 'pages.dc.html', x: 0, y: 1020, w: 1440, h: 1200, title: 'Pages' },
  { file: 'screens/vitals.dc.html', x: 1560, y: 1020, w: 1440, h: 900, title: 'Vitals' },
]

export const boardHtml = (name: string) => `<x-dc>
<script src="./support.js"></script>
<div class="card"><h1>${name}</h1><a href="keywords.dc.html">next</a></div>
<script>document.title = "x</script"+">"; const t = "</script>";</script>
<script type="text/x-dc" data-dc-script>class Component extends DCLogic { renderVals() { return { name: ${JSON.stringify(name)} } } }</script>
</x-dc>`

export function doc(over: Record<string, unknown> = {}, canvasOver: Record<string, unknown> = {}) {
  const canvas = {
    launch: { view: 'canvas' },
    artboards: BOARDS,
    annotations: [{ id: 'a1', x: 0, y: -140, w: 560, text: 'Context for reviewers' }, { id: 'a2', x: 1560, y: -140, w: 400, text: 'Second note' }],
    ...canvasOver,
  }
  const files: Record<string, string> = { 'canvas.json': JSON.stringify(canvas) }
  for (const b of BOARDS) files[b.file] = boardHtml(b.title)
  return { title: 'Rankheld Performance Dashboards', content: { files }, comments: [], ...over }
}

/** The saved page: editor shell around the document. `</` is escaped the way an inline JSON script needs it. */
export function savedPage(d: unknown = doc(), shellKb = 600) {
  const json = JSON.stringify(d).replace(/</g, '\\u003c')
  const junk = '/* editor */ var __e = "appifact-doc"; function f(){ return 1 }\n'.repeat(Math.ceil(shellKb * 1024 / 64))
  return `<!doctype html><html><head><meta charset="utf-8"><title>Editor</title><script>${junk}</script></head><body><div id="root"></div><script type="application/json" id="appifact-doc">${json}</script></body></html>`
}
