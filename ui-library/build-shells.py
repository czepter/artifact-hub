#!/usr/bin/env python3
"""Generates boards/shell-*.html (one whole page of Artifact Hub per board) and extends canvas.json.
Run from ui-library/: python3 build-shells.py"""
import json, os, re

P = {
 'plus':'<path d="M5 12h14M12 5v14"/>','upload':'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
 'layers':'<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
 'updown':'<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>','down':'<path d="m6 9 6 6 6-6"/>',
 'more':'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
 'pencil':'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
 'library':'<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"/>',
 'trash':'<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
 'msg':'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>','check':'<path d="M20 6 9 17l-5-5"/>',
 'copy':'<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
 'download':'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
 'pin':'<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
 'key':'<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5"/>',
 'user':'<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>','logout':'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
 'sun':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
 'moon':'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>','monitor':'<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
 'plug':'<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>','back':'<path d="m12 19-7-7 7-7M19 12H5"/>',
 'play':'<polygon points="6 3 20 12 6 21 6 3"/>','share':'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
 'panel':'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>','archive':'<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
 'arrows':'<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>','refresh':'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>',
 'image':'<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
 'github':'<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
 'cursor':'<path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/>',
}
def I(n, cls=''):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{f" class={chr(34)}{cls}{chr(34)}" if cls else ""}><use href="../icons.svg#{n}"/></svg>'
def sprite():
    return '<svg xmlns="http://www.w3.org/2000/svg">' + ''.join(f'<symbol id="{k}" viewBox="0 0 24 24">{v}</symbol>' for k, v in P.items()) + '</svg>\n'
def btn(label='', v='default', s=None, icon=None, cur=False, extra='', tag='button', href=None):
    a = f' data-size="{s}"' if s else ''
    c = ' aria-current="page"' if cur else ''
    h = f' href="{href or "#"}"' if tag == 'a' else ''
    return f'<{tag} class="ui-btn" data-variant="{v}"{a}{c}{h}{extra}>{I(icon) if icon else ""}{label}</{tag}>'
def badge(t, v='secondary', icon=None, cls=''):
    return f'<span class="ui-badge{(" "+cls) if cls else ""}" data-variant="{v}">{I(icon) if icon else ""}{t}</span>'
def avatar(t, size=None):
    st = f' style="width:{size}px;height:{size}px"' if size else ''
    return f'<span class="ui-avatar"{st}>{t}</span>'
def board(label, inner, foot=None, cls=''):
    f = f'<div class="board-foot">{foot}</div>' if foot else ''
    return f'<section class="board{(" "+cls) if cls else ""}"><h2>{label}</h2><div class="board-frame">{inner}{f}</div></section>'
def ul(items, cls='divide'): return f'<ul class="{cls}" style="margin:0;padding:0;list-style:none">' + ''.join(f'<li>{i}</li>' for i in items) + '</ul>'
def link(t): return f'<a class="shell-link" href="#">{t}</a>'
def field(id, label, inner, help=None):
    return f'<div class="ui-field"><label class="ui-label" for="{id}">{label}</label>{inner}{f"<p class={chr(34)}ui-help{chr(34)}>{help}</p>" if help else ""}</div>'
def inp(id, **kw):
    at = ' '.join(f'{k.replace("_","-")}="{v}"' for k, v in kw.items())
    return f'<input id="{id}" class="ui-input" {at}>'

LINKS = ['Dashboard', 'Artifacts', 'Comments', 'Admin']
ADMIN = ['Overview', 'Members', 'Clients', 'Share links', 'Activity']
def shell(active, body, admin=None, actions='', ws='All workspaces', count=3, main_cls=''):
    nav = ''.join(btn(l + (f'<span class="shell-count">{count}</span>' if l == 'Comments' and count else ''), 'ghost', 'sm', cur=(l == active), tag='a') for l in LINKS)
    sw = btn(f'{I("layers")}<span>{ws}</span>{I("updown")}', 'ghost', 'sm', extra=' aria-label="Switch workspace"')
    sub = ''
    if admin:
        sub = '<div class="shell-pill"><nav aria-label="Admin sections">' + ''.join(btn(l, 'ghost', 'sm', cur=(l == admin), tag='a') for l in ADMIN) + '</nav></div>'
    return (f'<div class="shell-page"><header class="shell-bar"><div class="shell-stack"><div class="shell-pill"><span class="shell-brand">Artifact Hub</span><nav aria-label="Main">{nav}</nav>{sw}</div>{sub}</div>'
            f'<div class="shell-pill">{actions}{avatar("CZ")}</div></header><main class="shell-main"{" data-admin" if admin else ""}{main_cls}>{body}</main></div>')
def head(title, sub=None, right=''):
    return f'<div class="shell-head"><div><h1 class="shell-title">{title}</h1>{f"<p class={chr(34)}shell-sub{chr(34)}>{sub}</p>" if sub else ""}</div>{right}</div>'
NEWACT = btn('New canvas', 'default', 'sm', 'plus') + btn('Import .zip', 'ghost', 'sm', 'upload')

def page(title, body):
    return (f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>'
            '<link rel="stylesheet" href="../_shared/css/tokens.css"><link rel="stylesheet" href="../_shared/css/components.css"><link rel="stylesheet" href="../_shared/css/shells.css"><body>' + body + '</body></html>\n')

# ---------- sample data ----------
def card(title, v, ago, canvas=False, comments=0, pinned=False, opened='Opened 2h ago · 14 opens'):
    return (f'<li><a class="card-link ui-btn" data-variant="outline" style="padding:0;height:100%;font-weight:400;white-space:normal;flex-direction:column;align-items:stretch;justify-content:space-between"><div class="thumb"><i></i><i></i><i></i></div><div class="card-body">'
            f'<span class="card-title">{I("pin","icon-lead") if pinned else ""}<span>{title}</span></span><span class="card-meta"><span>v{v}</span><span aria-hidden="true">·</span><span>{ago}</span>{badge("canvas") if canvas else ""}{badge(I("msg")+str(comments),"default") if comments else ""}</span>'
            f'<span class="card-meta">{opened}</span></div></a></li>')
EV = [('chr.zepter','published','UI library','2 min ago'),('Claude','replied on','Pricing page','18 min ago'),('chr.zepter','shared','Clients','1 h ago'),('Claude','created','Release notes','3 h ago'),('dev','joined','Artifact Hub','yesterday'),('chr.zepter','approved client','Claude Desktop','2 days ago')]
def events(n=5):
    return ul([f'<div class="row row-tight"><span class="row-main row-title" style="font-weight:400"><b style="font-weight:500">{a}</b> {k} <b style="font-weight:500">{s}</b></span><time class="row-time">{t}</time></div>' for a,k,s,t in EV[:n]])
def thread(who, on, body, t, resolved=False, replies=0):
    r = ''
    if resolved: r += badge('Resolved','secondary','check')
    if replies: r += badge(I('msg')+str(replies),'outline')
    cls = ' style="color:var(--muted-foreground)"' if resolved else ''
    return (f'<a class="ui-btn row-link row-stack" data-variant="ghost"><span class="row-line"><span class="row-title" style="font-weight:400"><strong>{who}</strong> on {on}</span><span style="display:flex;gap:8px;align-items:center">{r}<time class="row-time">{t}</time></span></span><span class="row-clamp"{cls}>{body}</span></a>')

boards = {}

# 1 dashboard
dash = (head('Dashboard', '5 artifacts · 3 open threads · 2 active share links') + '<div class="shell-grid" data-cols="side"><div class="shell-col">'
  + board('Recent artifacts', '<ul class="cards">' + card('UI library',3,'5 min ago',True,1,True) + card('Pricing page',12,'1 h ago',False,2) + card('Clients',7,'yesterday',True) + card('Release notes',2,'3 days ago',False,0,False,'Not opened yet') + '</ul>', foot=link('All 5 artifacts'))
  + board('Activity', events(5), foot=link('Full log')) + '</div><div class="shell-col">'
  + board('Waiting for a reply (3)', ul([thread('reviewer@example.test','Pricing page','Can the second plan be highlighted? It reads as the default one.','12 min ago'), thread('chr.zepter','UI library','Make the focus ring a bit calmer on the dark theme.','1 h ago'), thread('guest@example.test','Clients','Typo in the third row.','yesterday')]))
  + board('Connected clients', ul([f'<div class="row row-tight"><span class="row-title">{c}</span><span class="row-time">{t}</span></div>' for c,t in [('Claude Desktop','used 3 min ago'),('Claude Code','used 1 h ago'),('Cursor','never used')]]), foot=link('Manage'))
  + board('Storage', '<dl class="kv"><div><dt>Files, all versions</dt><dd>4.2 MB</dd></div><div><dt>Shared data</dt><dd>18 KB</dd></div><div><dt>Database file</dt><dd>1.1 MB</dd></div></dl>') + '</div></div>')
boards['dashboard'] = ('Dashboard shell', shell('Dashboard', dash, actions=NEWACT))

# 2 artifacts
def arow(title, v, when, opened, ws=None, pinned=False):
    wsh = f'<span style="display:inline-flex;align-items:center;gap:6px"><span class="shell-dot"></span>{ws} ·</span> ' if ws else ''
    return (f'<div style="display:flex;align-items:center"><a class="ui-btn row-link" data-variant="ghost" style="flex:1;min-width:0"><span style="display:inline-flex;min-width:0;align-items:center;gap:6px;font-weight:500">{I("pin","icon-lead") if pinned else ""}<span class="row-title">{title}</span></span>'
            f'<span class="row-time" style="display:flex;gap:6px;align-items:center">{wsh}<span>v{v} · {when} · opened {opened}</span></span></a>{btn(I("more"),"ghost","icon-sm",extra=" aria-label=&quot;Actions&quot; style=&quot;margin-right:8px&quot;".replace("&quot;",chr(34)))}</div>')
art = (head('<span class="shell-dot"></span>artifact-hub', 'Components and shells of the hub itself.', right='<span style="display:flex;align-items:center;gap:4px;margin-left:auto"><a class="shell-link shell-link-quiet" href="#">Archived</a>' + btn(I('more'),'ghost','icon-sm',extra=' aria-label="Workspace actions"') + '</span>')
  + '<div class="shell-grid">' + board('Pinned', ul([arow('UI library',3,'5 min ago','2 h ago',None,True)])) + board('Recent', ul([arow('Pricing page',12,'1 h ago','today'), arow('Clients',7,'yesterday','yesterday'), arow('Release notes',2,'3 days ago','2 days ago'), arow('Onboarding flow',5,'last week','last week')])) + '</div>')
boards['artifacts'] = ('Artifacts shell', shell('Artifacts', art, actions=NEWACT, ws='artifact-hub'))

# 3 comments
cm = (f'<div class="shell-head"><div><h1 class="shell-title">Comments</h1><p class="shell-sub">3 open · 2 resolved</p></div><div class="ui-tabs-list" role="tablist"><button class="ui-tab" role="tab" aria-selected="true">Open</button><button class="ui-tab" role="tab" aria-selected="false">Resolved</button><button class="ui-tab" role="tab" aria-selected="false">All</button></div></div>'
  + board('Open threads', ul([thread('reviewer@example.test','Pricing page · home.html','Can the second plan be highlighted? It reads as the default one.','12 min ago',False,2), thread('chr.zepter','UI library · buttons.html','Make the focus ring a bit calmer on the dark theme.','1 h ago'), thread('Claude','Clients · overview.html','Added the missing empty state; check the spacing under the table.','yesterday',False,1)])))
boards['comments'] = ('Comments shell', shell('Comments', cm, actions=''))

# 4 account
def meth(icon, name, state, action): return f'<div class="row">{I(icon,"icon-lead")}<div class="row-main"><div style="font-weight:500">{name}</div><div class="row-meta">{state}</div></div>{action}</div>'
acct = (head('Account') + '<div class="shell-narrow" style="display:grid;gap:24px">'
  + board('Profile','<dl class="dl-grid"><div><dt>Name</dt><dd>Christian</dd></div><div><dt>E-mail</dt><dd>chr.zepter@gmail.com</dd></div><div><dt>Role</dt><dd class="cap">owner</dd></div></dl>')
  + board('Sign-in methods', ul([meth('github','GitHub','Connected',btn('Disconnect','outline','sm')), meth('key','Password','Set',btn('Change','outline','sm')), meth('key','MacBook passkey','Added 3 weeks ago',btn('Remove','ghost','sm')), f'<div class="row">{btn("Add a passkey","outline","sm","plus")}</div>']))
  + board('Connected clients (2)', ul([f'<div class="row"><div class="row-main"><div style="font-weight:500">{c}</div><div class="row-meta">{m}</div></div>{btn("Revoke","outline","sm")}</div>' for c,m in [('Claude Desktop','Read · Comment · Publish and edit · used 3 min ago'),('Claude Code','Read · Publish and edit · used 1 h ago')]]))
  + board('Sessions (2)', ul([f'<div class="row"><div class="row-main"><div style="font-weight:500">{d}</div><div class="row-meta">{a}</div></div>{x}</div>' for d,a,x in [('Firefox on Linux','Active just now',badge('This device')),('Safari on a phone','Active 2 days ago',btn('Sign out','ghost','sm'))]] + [f'<div class="row">{btn("Sign out other devices","outline","sm")}</div>']))
  + '</div>')
boards['account'] = ('Account shell', shell('', acct, actions=''))

# 5 admin overview
ao = (head('Overview') + '<div class="shell-grid" data-cols="even"><div class="shell-col">'
  + board('Connect a client', f'<div class="board-pad stackf"><label class="ui-help" for="ep">MCP endpoint</label><div style="display:flex;gap:8px"><input id="ep" class="ui-input mono" readonly value="https://design.czpt.de/mcp">{btn("Copy","outline",None,"copy")}</div></div>')
  + board('Recent activity', events(6), foot=link('All activity')) + '</div>'
  + board('Storage', '<dl class="kv"><div><dt>Artifacts</dt><dd>5 (17 versions)</dd></div><div><dt>Files, all versions</dt><dd>4.2 MB</dd></div><div><dt>Shared data</dt><dd>18 KB</dd></div><div><dt>Comments</dt><dd>9</dd></div><div><dt>Database file</dt><dd>1.1 MB</dd></div></dl><div class="board-foot" style="padding:12px">' + btn('Export all as zip','outline','sm','download') + '</div>') + '</div>')
boards['admin-overview'] = ('Admin overview shell', shell('Admin', ao, admin='Overview'))

# 6 members
def mrow(init, name, email, role, you=False):
    r = badge('Owner') if role == 'owner' else btn(f'<span class="cap">{role}</span>{I("down")}', 'outline', 'sm') + btn(I('more'),'ghost','icon-sm',extra=' aria-label="Member actions"')
    return f'<div class="row">{avatar(init)}<div class="row-main"><div class="row-title" style="font-size:14px">{name}{" <span style=&quot;font-weight:400;color:var(--muted-foreground)&quot;>(you)</span>".replace("&quot;",chr(34)) if you else ""}</div><div class="row-meta">{email}</div></div>{r}</div>'
mem = (head('Members') + '<div class="shell-grid">'
  + board('People (3)', ul([mrow('CH','Christian','chr.zepter@gmail.com','owner',True), mrow('DE','dev','dev@example.test','editor'), mrow('GU','guest','guest@example.test','commenter')]))
  + board('Invitations (1)', ul([f'<div class="row"><div class="row-main row-title" style="font-weight:400">new@example.test</div>{badge("Editor",cls="cap")}<time class="row-time">2 h ago</time>{btn("Revoke","ghost","sm")}</div>'])) + '</div>')
boards['admin-members'] = ('Members shell', shell('Admin', mem, admin='Members', actions=btn('Invite','default','sm','plus')))

# 7 clients
def crow(c, m, scopes, a, l, e):
    return f'<tr><td style="padding-left:16px;font-weight:500">{c}</td><td style="color:var(--muted-foreground)">{m}</td><td><div style="display:flex;gap:4px;flex-wrap:wrap">{"".join(badge(s) for s in scopes)}</div></td><td style="color:var(--muted-foreground)">{a}</td><td style="color:var(--muted-foreground)">{l}</td><td style="color:var(--muted-foreground)">{e}</td><td style="padding-right:16px;text-align:right">{btn("Revoke","outline","sm")}</td></tr>'
cl = (head('Clients') + board('Connected clients (3)', '<table class="ui-table"><thead><tr><th style="padding-left:16px">Client</th><th>Member</th><th>Access</th><th>Authorised</th><th>Last used</th><th>Expires</th><th></th></tr></thead><tbody>'
  + crow('Claude Desktop','Christian',['Read','Comment','Publish and edit'],'3 weeks ago','3 min ago','in 27 days') + crow('Claude Code','Christian',['Read','Publish and edit','Share'],'last week','1 h ago','in 23 days') + crow('Cursor','dev',['Read','Comment'],'2 days ago','never','in 28 days') + '</tbody></table>'))
boards['admin-clients'] = ('Clients shell', shell('Admin', cl, admin='Clients'))

# 8 share links
def srow(t, role, c): return f'<tr><td style="padding-left:16px"><a href="#" style="font-weight:500;color:inherit">{t}</a></td><td>{badge(role)}</td><td style="color:var(--muted-foreground)">{c}</td><td style="padding-right:16px;text-align:right;white-space:nowrap">{btn("Copy link","outline","sm","copy")} {btn("Revoke","ghost","sm")}</td></tr>'
sl = (head('Share links') + board('Active links (2)', '<table class="ui-table"><thead><tr><th style="padding-left:16px">Artifact</th><th>Access</th><th>Created</th><th></th></tr></thead><tbody>' + srow('Pricing page','Can comment','2 days ago') + srow('Clients','View only','last week') + '</tbody></table>'))
boards['admin-share-links'] = ('Share links shell', shell('Admin', sl, admin='Share links'))

# 9 activity
ac = (head('Activity') + board('Latest 200 events', events(6) + ''.join(f'<div class="row row-tight" style="border-top:1px solid var(--border)"><span class="row-main row-title" style="font-weight:400"><b style="font-weight:500">{a}</b> {k} <b style="font-weight:500">{s}</b></span><time class="row-time">{t}</time></div>' for a,k,s,t in [('Claude','published','Release notes','3 days ago'),('dev','commented on','Clients','3 days ago'),('chr.zepter','invited','new@example.test','4 days ago')])))
boards['admin-activity'] = ('Activity shell', shell('Admin', ac, admin='Activity'))

# 10 sign-in
si = ('<div class="ui-card gate"><div class="ui-card-header"><h1 class="ui-card-title" style="font-size:18px">Sign in</h1></div><div class="ui-card-content stackf-lg">'
  f'<div class="stackf" style="gap:8px">{btn(I("github")+"Continue with GitHub","outline",extra=" style=&quot;width:100%&quot;".replace("&quot;",chr(34)))}{btn("Sign in with a passkey","outline",icon="key",extra=" style=&quot;width:100%&quot;".replace("&quot;",chr(34)))}<div class="or">or</div></div>'
  f'<form class="stackf">{field("e","E-mail",inp("e",type="email",value="chr.zepter@gmail.com"))}{field("p","Password",inp("p",type="password",value="correct horse"))}{btn("Sign in","default",extra=" style=&quot;width:100%&quot;".replace("&quot;",chr(34)))}</form></div></div>')
boards['sign-in'] = ('Sign-in', f'<div class="shell-page" data-center>{si}</div>')

# 11 owner setup + sign-in error
su = ('<div class="ui-card gate"><div class="ui-card-header"><h1 class="ui-card-title" style="font-size:18px">Create the owner account</h1></div><div class="ui-card-content"><form class="stackf">'
  + field('n','Name',inp('n',value='Christian')) + field('e2','E-mail',inp('e2',type='email',value='chr.zepter@gmail.com')) + field('p2','Password',inp('p2',type='password',value='short',aria_invalid='true'))
  + '<div class="ui-alert" data-variant="destructive" role="alert"><div class="ui-alert-desc">Use at least 10 characters.</div></div>' + btn('Create account','default',extra=' style="width:100%"') + '</form></div></div>')
boards['setup'] = ('Owner setup', f'<div class="shell-page" data-center>{su}</div>')

# 12 join
jn = ('<div class="ui-card gate"><div class="ui-card-header"><h1 class="ui-card-title" style="font-size:18px">Join Artifact Hub</h1><p class="ui-card-desc">You were invited as editor. Create your account for new@example.test.</p></div><div class="ui-card-content"><form class="stackf">'
  + field('jn','Name',inp('jn')) + field('jp','Password',inp('jp',type='password',minlength='10')) + btn('Create account','default',extra=' style="width:100%" disabled') + '</form></div></div>')
boards['join'] = ('Join via invite', f'<div class="shell-page" data-center>{jn}</div>')

# 13 oauth consent
SC = [('Read','Artifacts, files, comments and shared data',True,True),('Comment','Reply to and resolve comment threads',True,False),('Publish and edit','Create artifacts, publish versions, edit files, write shared data',True,False),('Share','Create share links (not available for your role)',False,False)]
sc = ''.join(f'<div class="scope"><input class="ui-checkbox" type="checkbox" id="s{i}"{" checked" if chk else ""}{" disabled" if (i==0 or not al) else ""} style="margin-top:2px"><label class="ui-label" for="s{i}"><span style="font-weight:500">{n}</span><small>{h}</small></label></div>' for i,(n,h,al,chk) in enumerate([(a,b,c,d) for a,b,c,d in SC]))
sc = sc.replace('id="s1" ','id="s1" checked ').replace('id="s2" ','id="s2" checked ')
oc = (f'<div class="ui-card gate" data-wide style="max-width:448px"><div class="ui-card-header" style="display:block"><div style="display:flex;align-items:center;gap:12px"><span class="tile">{I("plug")}</span><div style="min-width:0"><h1 class="ui-card-title" style="font-size:18px;line-height:1.3">Claude Desktop wants to connect</h1><p class="ui-card-desc mono" style="overflow:hidden;text-overflow:ellipsis">http://localhost:33418/callback</p></div></div></div>'
  f'<div class="ui-card-content stackf-lg"><div class="who"><div><div style="font-weight:500">Christian</div><div class="row-meta cap">owner</div></div>{btn("Not you?","link","sm")}</div><fieldset style="border:0;padding:0;margin:0"><legend style="margin-bottom:4px;font-size:14px;font-weight:500">Allow it to</legend>{sc}</fieldset>'
  f'<div style="display:flex;justify-content:flex-end;gap:8px">{btn("Deny","outline")}{btn("Approve")}</div></div></div>')
boards['consent'] = ('Approve access', f'<div class="shell-page" data-center>{oc}</div>')

# 14 viewer
def vb(x, y, w, h, t): return f'<div class="viewer-board-label" style="left:{x}px;top:{y-20}px">{t}</div><div class="viewer-board" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px"><div class="thumb"><i></i><i></i><i></i></div></div>'
left = (btn(I('back'),'ghost','icon-sm',extra=' aria-label="Back to the workspace"') + btn('<span class="row-title">UI library</span>' + I('down'),'ghost','sm',extra=' style="font-weight:600"') +
        f'<button class="ui-select" style="height:32px;width:auto;gap:8px" aria-label="Version"><span>Live (v3)</span>{I("down")}</button>')
right = (btn('Edit','ghost','sm','pencil') + btn(I('play'),'ghost','icon-sm',extra=' aria-label="Present"') + btn(I('msg'),'ghost','icon-sm',extra=' aria-label="Comment mode"') + btn('Share','outline','sm','share') + btn(I('panel'),'ghost','icon-sm',extra=' aria-label="Comments"'))
tools = '<div class="shell-pill viewer-tools">' + ''.join(btn(I(i),'default' if i=='cursor' else 'ghost','icon-sm',extra=f' aria-label="{i}"') for i in ['cursor','msg','plus']) + '</div>'
panel = ('<aside class="viewer-panel"><header>Comments <span class="ui-badge" data-variant="secondary">2 open</span></header>'
  f'<div class="thread"><div style="display:flex;gap:8px;align-items:center"><span class="hub-thread-badge">1</span><b>Chris</b><span class="ui-help">2 min ago</span></div>Make the headline one line on mobile.<div class="hub-reply"><b>Claude</b><span>Done in v4, the title wraps at 360px now.</span></div></div>'
  f'<div class="thread"><div style="display:flex;gap:8px;align-items:center"><span class="hub-thread-badge">2</span><b>Reviewer</b><span class="ui-help">1 h ago</span></div>Can the focus ring be calmer?</div>'
  f'<div style="margin-top:auto;padding:12px;display:grid;gap:8px"><textarea class="ui-textarea" placeholder="Reply…" aria-label="Reply"></textarea><div style="display:flex;justify-content:flex-end;gap:8px">{btn("Resolve","ghost","sm")}{btn("Reply","default","sm")}</div></div></aside>')
vw = (f'<div class="shell-page viewer"><header class="shell-bar"><div class="shell-pill">{left}</div><div class="shell-pill">{right}</div></header><div class="viewer-stage"><div class="viewer-canvas hub-ground">'
      + vb(40,56,360,260,'Foundations') + vb(440,56,360,200,'Buttons') + vb(40,356,360,220,'Forms') + vb(440,296,360,280,'Overlays') + '<span class="viewer-pin" style="left:380px;top:48px">1</span><span class="viewer-pin" style="left:780px;top:48px;background:var(--primary)">2</span>' + tools + f'</div>{panel}</div></div>')
boards['viewer'] = ('Viewer shell', vw)

# 15 menus + dialogs of the shell
um = ('<div class="ui-menu" role="menu" style="width:240px"><div class="ui-menu-label">Christian<small class="cap">owner</small></div><hr class="ui-separator">'
  f'<button class="ui-menu-item" role="menuitem">{I("user")}Account</button><hr class="ui-separator"><div class="ui-menu-label" style="font-weight:400;font-size:12px;color:var(--muted-foreground)">Theme</div>'
  f'<button class="ui-menu-item" role="menuitemradio" aria-checked="false">{I("sun")}Light</button><button class="ui-menu-item" role="menuitemradio" aria-checked="true">{I("monitor")}System</button><button class="ui-menu-item" role="menuitemradio" aria-checked="false">{I("moon")}Dark</button><hr class="ui-separator"><button class="ui-menu-item" role="menuitem">{I("logout")}Sign out</button></div>')
wm = ('<div class="ui-menu" role="menu" style="width:240px"><div class="ui-menu-label" style="font-weight:400;font-size:12px;color:var(--muted-foreground)">Workspaces</div>'
  f'<button class="ui-menu-item">{I("layers")}All workspaces<span class="ui-menu-shortcut" style="letter-spacing:0">5</span></button><button class="ui-menu-item" data-highlighted><span class="shell-dot"></span>artifact-hub<span class="ui-menu-shortcut" style="letter-spacing:0">1</span></button><button class="ui-menu-item"><span class="shell-dot"></span>Auri CRM<span class="ui-menu-shortcut" style="letter-spacing:0">14</span></button><hr class="ui-separator"><button class="ui-menu-item">{I("plus")}New workspace…</button></div>')
am = ('<div class="ui-menu" role="menu" style="width:256px"><div class="ui-menu-label" style="font-weight:400;font-size:12px;color:var(--muted-foreground)">Owned by you<br>Updated 5 min ago · v3</div><hr class="ui-separator">'
  + ''.join(f'<button class="ui-menu-item"{" data-variant=&quot;destructive&quot;".replace("&quot;",chr(34)) if t=="Delete artifact" else ""}>{I(i)}{t}</button>' + ('<hr class="ui-separator">' if t in ('Export as .zip','Share files with workspace…','Refresh') else '') for i,t in [('image','Export as image…'),('download','Export as .zip'),('copy','Duplicate'),('pencil','Rename'),('pin','Pin to top'),('archive','Archive'),('arrows','Move to workspace'),('library','Share files with workspace…'),('refresh','Refresh'),('trash','Delete artifact')]) + '</div>')
inv = ('<div class="ui-dialog" role="dialog"><div><h3 class="ui-dialog-title">Invite a member</h3><p class="ui-dialog-desc">They sign up with the link, using this e-mail address.</p></div>'
  f'<div class="stackf">{field("ie","E-mail",inp("ie",type="email",value="new@example.test"))}<div class="ui-field"><span class="ui-label">Role</span><div class="toggle-group"><button class="toggle-item" aria-pressed="false">Commenter</button><button class="toggle-item" aria-pressed="true">Editor</button></div></div></div>'
  f'<div class="ui-dialog-footer">{btn("Cancel","outline")}{btn("Create invite link")}</div></div>')
rv = ('<div class="ui-dialog" role="alertdialog"><div><h3 class="ui-dialog-title">Revoke “Cursor”?</h3><p class="ui-dialog-desc">It loses access right away. To use it again, its member has to approve it again.</p></div>'
  f'<div class="ui-dialog-footer">{btn("Keep","outline")}{btn("Revoke access","destructive")}</div></div>')
mn = (f'<div class="shell-page"><div class="menu-rail">{um}{wm}{am}</div><div class="menu-rail" style="align-items:flex-start;flex-wrap:wrap"><div class="scrim">{inv}</div><div class="scrim">{rv}</div></div></div>')
boards['menus-dialogs'] = ('Shell menus and dialogs', mn)

# ---------- write ----------
open('icons.svg','w').write(sprite())
sizes = {'dashboard':(1280,1180),'artifacts':(1280,760),'comments':(1280,560),'account':(1280,1180),'admin-overview':(1280,750),'admin-members':(1280,640),'admin-clients':(1280,560),'admin-share-links':(1280,520),'admin-activity':(1280,720),'sign-in':(720,640),'setup':(720,640),'join':(720,560),'consent':(720,780),'viewer':(1280,820),'menus-dialogs':(1280,1170)}
cj = json.load(open('canvas.json'))
for k in [k for k in cj['boards'] if k.startswith('boards/shell-')]: cj['boards'].pop(k); cj['order'].remove(k)
x = y = 0; col = 0; rowh = 0; y0 = 2300
for name, (title, html) in boards.items():
    path = f'boards/shell-{name}.html'
    open(path, 'w').write(page(title, html))
    w, h = sizes[name]
    if x + w > 2800 and x > 0: x = 0; y += rowh + 120; rowh = 0
    cj['boards'][path] = {'x': x, 'y': y0 + y, 'w': w, 'h': h, 'title': title}
    cj['order'].append(path); x += w + 120; rowh = max(rowh, h)
json.dump(cj, open('canvas.json', 'w'), indent=1)
print(len(boards), 'shell boards')
