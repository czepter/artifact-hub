import { chromium } from 'playwright-core'
const exe = '/home/christian/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'
const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'], env: { ...process.env, LD_LIBRARY_PATH: '/tmp/claude-1000/-home-christian--t3-scratch-2026-11-06-is-there-an-opensource-alternative-39b4b457/00602bf4-a546-4128-a40b-6523462d718e/scratchpad/libs/root/usr/lib/x86_64-linux-gnu', FONTCONFIG_FILE: '/tmp/claude-1000/-home-christian--t3-scratch-2026-11-06-is-there-an-opensource-alternative-39b4b457/00602bf4-a546-4128-a40b-6523462d718e/scratchpad/libs/fc/fonts.conf' } })
const p = await b.newPage({ viewport: { width: 1200, height: 800 } })
await p.goto('http://192.168.42.16:3100/')
console.log('title:', await p.title(), '| h1/inputs:', await p.locator('input').count())
await p.screenshot({ path: 'smoke.png' }); await b.close(); console.log('BROWSER WORKS')
