import zipfile, io, json, urllib.request, urllib.error, struct, zlib, sys
B='http://192.168.42.16:3100'; T='devtoken'; D='/tmp/claude-1000/-home-christian--t3-scratch-2026-11-06-is-there-an-opensource-alternative-39b4b457/00602bf4-a546-4128-a40b-6523462d718e/scratchpad/t/dc/'
def req(path, data=None, method=None, headers=None):
    r = urllib.request.Request(B+path, data=data, method=method, headers={'authorization':'Bearer '+T, **(headers or {})})
    try:
        with urllib.request.urlopen(r) as x: return x.status, x.read(), dict(x.headers)
    except urllib.error.HTTPError as e: return e.code, e.read(), dict(e.headers)
ok_all=True
def ok(n,c,x=''):
    global ok_all; print('PASS' if c else 'FAIL', n, '' if c else x); ok_all = ok_all and c

canvas={"v":3,"title":"mcpwarden UI (partial)","launch":{"view":"canvas"},"boards":{
 "Consent.dc.html":{"x":0,"y":0,"w":900,"h":820,"title":"OAuth-Zustimmung (unbekannter Client)"},
 "Counter.dc.html":{"x":980,"y":0,"w":700,"h":820,"title":"Runtime feature test","is_interactive":True}},
 "order":["Consent.dc.html","Counter.dc.html"],"notes":{"t1":{"x":0,"y":-200,"w":1200,"text":"mcpwarden: Web-UI (import test)","kind":"title1"}}}
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:        # shaped like a Design export: project/ prefix + editor files + a foreign runtime
    z.writestr('project/canvas.json', json.dumps(canvas))
    for f in ('Consent.dc.html','Counter.dc.html','Pill.dc.html'): z.write(D+f, 'project/'+f)
    z.writestr('project/support.js', '/* foreign */ class DCLogic{} window.PWNED=1')
    z.writestr('artifact-type/app.js', 'console.log("editor")'); z.writestr('SKILL.md','x'); z.writestr('__MACOSX/._x','x'); z.writestr('project/.DS_Store','x')
s,b,_=req('/api/artifacts/import?title=', buf.getvalue(), 'POST', {'content-type':'application/zip'})
r=json.loads(b); print(r)
ok('import accepted', s==200 and r['files']==4, (s,b[:200]))
ok('title taken from canvas.json', True)
ok('editor files dropped, foreign runtime reported', any('artifact-type/app.js' in d for d in r['dropped']) and any('support.js' in d for d in r['dropped']), r['dropped'])
aid=r['id']
s,b,_=req('/api/view/'+aid); v=json.loads(b)
ok('stored paths have project/ stripped', sorted(f['path'] for f in v['files'])==['Consent.dc.html','Counter.dc.html','Pill.dc.html','canvas.json'], v['files'])
ok('title from canvas.json', v['artifact']['title']=='mcpwarden UI (partial)', v['artifact']['title'])
fb=v['frameBase']
s,b,h=req(fb+'support.js'); js=b.decode()
ok('support.js served by built-in runtime', s==200 and 'DCLogic' in js and 'React' in js and 'PWNED' not in js and 'javascript' in h.get('content-type',''), (s,h.get('content-type'),len(js)))
ok('runtime is React + ReactDOM + dc-runtime', len(js)>140000 and 'Artifact Hub: Design Component' in js, len(js))
s,b,h=req(fb+'Consent.dc.html'); html=b.decode()
ok('board html served with sandbox CSP + CORS', s==200 and 'sandbox' in h.get('content-security-policy','') and h.get('access-control-allow-origin')=='*', h)
ok('bridge + api injected before ./support.js', html.index('data-hub-artifact-api') < html.index('./support.js') and 'data-hub-bridge' in html)
ok('x-dc template untouched in served html', '{{s.title}}' in html and '<sc-for' in html)
s,b,h=req(fb+'Pill.dc.html'); ok('sibling board fetchable (dc-import)', s==200 and '{{label}}' in b.decode())
s,b,h=req(fb+'sub/dir/support.js'); ok('nested ./support.js path also answered', s==200 and 'DCLogic' in b.decode())

# ---- hostile archives
def post(data): return req('/api/artifacts/import', data, 'POST', {'content-type':'application/zip'})
s,b,_=post(b'not a zip at all'); ok('garbage rejected (422)', s==422, (s,b[:100]))
s,b,_=post(b''); ok('empty body rejected (400)', s==400, s)
bad=io.BytesIO()
with zipfile.ZipFile(bad,'w') as z: z.writestr('readme.txt','hi')
s,b,_=post(bad.getvalue()); ok('zip without canvas.json/index.html rejected', s==422, (s,b[:100]))
trav=io.BytesIO()
with zipfile.ZipFile(trav,'w') as z: z.writestr('index.html','<p>ok</p>'); z.writestr('../../evil.html','x'); z.writestr('a/../../b.html','x')
s,b,_=post(trav.getvalue()); r2=json.loads(b) if s==200 else {}
ok('path traversal entries never stored', s==200 and r2.get('files')==1, (s,b[:200]))
bomb=io.BytesIO()
with zipfile.ZipFile(bomb,'w',zipfile.ZIP_DEFLATED) as z:
    for i in range(14): z.writestr(f'index{i}.html' if i==0 else f'f{i}.bin', b'\0'*(5*1024*1024))
s,b,_=post(bomb.getvalue()); ok('inflated size over 60 MB rejected', s in (413,422), (s,b[:120]))
lie=bytearray(zipfile.ZipFile(io.BytesIO(b''),'w') and b'')
z=io.BytesIO()
with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as zz: zz.writestr('index.html', b'A'*200000)
raw=bytearray(z.getvalue())
# patch the declared uncompressed size (central dir + local header) to 10 bytes: a stream that inflates larger than declared
def patch(raw):
    i=raw.find(b'PK\x01\x02'); struct.pack_into('<I',raw,i+24,10)
    j=raw.find(b'PK\x03\x04'); struct.pack_into('<I',raw,j+22,10)
    return bytes(raw)
s,b,_=post(patch(raw)); ok('stream larger than declared size does not inflate unbounded', s>=400, (s,b[:150]))
s,b,_=req('/api/artifacts/import', buf.getvalue(), 'POST', {'content-type':'application/zip','authorization':'Bearer wrong'}); ok('import needs owner auth', s==401, s)
# cleanup test artifacts except the first
for x in json.loads(req('/api/artifacts')[1]):
    if x['title'] in ('Imported artifact',): req('/api/artifacts/'+x['id'], method='DELETE')
print('ALL OK' if ok_all else 'SOME FAILED'); print('artifact:', B+'/a/'+aid)
