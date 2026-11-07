import json, urllib.request, urllib.error
B='http://192.168.42.16:3100'; T='devtoken'
def req(path, body=None, method=None, auth=True):
    h={'content-type':'application/json'}
    if auth: h['authorization']='Bearer '+T
    r=urllib.request.Request(B+path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as x: t=x.read(); return x.status, (json.loads(t) if t[:1] in b'{[' else t.decode())
    except urllib.error.HTTPError as e:
        t=e.read(); 
        try: return e.code, json.loads(t)
        except: return e.code, t.decode()
fails=0
def ok(n,c,x=''):
    global fails
    print('PASS' if c else 'FAIL', n, '' if c else str(x)[:300]); fails += 0 if c else 1
page='<!doctype html><html><head><title>E</title></head><body><h1>Title</h1><p>Body text</p></body></html>'
s,r=req('/api/artifacts',{'title':'Editor test','files':[{'path':'index.html','content':page},{'path':'data.json','content':'{}'},{'path':'dc.dc.html','content':'<x-dc><div><span>{{x}}</span></div></x-dc><script type="text/x-dc" data-dc-script>class Component extends DCLogic{renderVals(){return {x:1}}}</script>'}]},'POST')
aid=r['id']; v=r['version']
s,view=req('/api/view/'+aid); fb=view['frameBase']
# served board is annotated + has the editor
import urllib.request as u
served=u.urlopen(u.Request(B+fb+'index.html')).read().decode()
ok('served board carries provisional ids', 'data-hub-pid="1"' in served and '<h1 data-hub-pid="1">' in served, served[:400])
ok('served board has the editor script', 'data-hub-editor' in served and 'hub:edit-mode' in served)
import zipfile, io
_z=zipfile.ZipFile(io.BytesIO(u.urlopen(u.Request(B+'/api/artifacts/%s/export'%aid, headers={'authorization':'Bearer '+T})).read()))
ok('stored source is untouched by serving', _z.read('index.html').decode()==page, _z.read('index.html').decode())
ops=[{'type':'style','id':'p1','set':{'color':'#c8553d','font-size':'40px'}},{'type':'text','id':'p2','html':'Edited <b>text</b>'},{'type':'insert','kind':'button','id':'nBtn1','target':{'id':'p2','position':'after'}}]
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'index.html','baseVersion':v,'ops':ops},'POST')
ok('edit saved as one new version', s==200 and r['version']==v+1 and r['applied']==3 and r['warnings']==[], (s,r))
# read back the stored source through MCP-free path: export zip
import zipfile, io
z=zipfile.ZipFile(io.BytesIO(u.urlopen(u.Request(B+'/api/artifacts/%s/export'%aid, headers={'authorization':'Bearer '+T})).read()))
src=z.read('index.html').decode(); print('  stored:', src)
ok('stored source has the edits and permanent ids', 'color: #c8553d; font-size: 40px' in src and 'Edited <b data-hub-id' not in src and 'Edited <b>text</b>' in src and 'data-hub-id="nBtn1"' in src and 'data-hub-id="p1"' in src, src)
ok('other bytes unchanged (title/head)', '<head><title>E</title></head>' in src)
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'index.html','baseVersion':v,'ops':ops},'POST')
ok('stale baseVersion -> 409', s==409, (s,r))
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'index.html','baseVersion':v+1,'ops':[{'type':'style','id':'p1','set':{'color':'red;x'}}]},'POST'); ok('invalid style value -> 400', s==400, (s,r))
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'index.html','baseVersion':v+1,'ops':[{'type':'delete','id':'nope'}]},'POST'); ok('only unknown ids -> 409 (nothing applied)', s==409, (s,r))
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'data.json','baseVersion':v+1,'ops':[{'type':'delete','id':'p1'}]},'POST'); ok('non-html file refused', s==400, (s,r))
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'../x.html','baseVersion':v+1,'ops':[{'type':'delete','id':'p1'}]},'POST'); ok('path traversal refused', s==400, (s,r))
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'index.html','baseVersion':v+1,'ops':[{'type':'style','id':'p1','set':{'color':'red'}}]},'POST',auth=False); ok('edit needs owner auth', s==401, (s,r))
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'dc.dc.html','baseVersion':v+1,'ops':[{'type':'text','id':'p0','html':'x'}]},'POST'); ok('hole-bound text refused (422)', s==422, (s,r))
# share viewer cannot edit even with a valid ref
s,sh=req('/api/artifacts/%s/shares'%aid,{'role':'comment'},'POST'); tok=sh['token']
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'index.html','baseVersion':v+1,'ops':[{'type':'style','id':'p1','set':{'color':'red'}}]},'POST',auth=False); ok('share-link holders cannot edit', s==401)
# second batch, then undo
s,r=req('/api/artifacts/%s/edit'%aid,{'path':'index.html','baseVersion':v+1,'ops':[{'type':'delete','id':'nBtn1'}]},'POST'); ok('second batch saved', s==200 and r['version']==v+2, (s,r))
s,r=req('/api/artifacts/%s/revert'%aid,{'path':'index.html','toVersion':v+1,'baseVersion':v+2},'POST'); ok('undo (revert file to previous version)', s==200 and r['version']==v+3, (s,r))
z=zipfile.ZipFile(io.BytesIO(u.urlopen(u.Request(B+'/api/artifacts/%s/export'%aid, headers={'authorization':'Bearer '+T})).read())); ok('undo restored the deleted button', 'data-hub-id="nBtn1"' in z.read('index.html').decode())
s,r=req('/api/artifacts/%s/revert'%aid,{'path':'index.html','toVersion':v+3,'baseVersion':v+3},'POST'); ok('revert to current/future version refused', s==400)
s,vv=req('/api/view/'+aid); ok('versions list shows labelled edits', [x['label'] for x in vv['versions']][:3]==['Undo edit of index.html','Edited index.html','Edited index.html'], [x['label'] for x in vv['versions']])
req('/api/artifacts/'+aid, None, 'DELETE')
print('ALL PASS' if not fails else '%d FAILED'%fails)
