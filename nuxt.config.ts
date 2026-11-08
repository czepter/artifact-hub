import tailwindcss from '@tailwindcss/vite'
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // Several dev servers can run side by side from one checkout (parallel work, tests): HUB_BUILD_DIR gives each its own build dir.
  buildDir: process.env.HUB_BUILD_DIR || '.nuxt',
  modules: ['shadcn-nuxt'],
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  vite: { plugins: [tailwindcss()] },
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    // NUXT_SESSION_SECRET (optional: generated and stored next to the database if unset)
    sessionSecret: '',
    // GitHub sign-in appears only when both are set: NUXT_GITHUB_CLIENT_ID / NUXT_GITHUB_CLIENT_SECRET
    github: { clientId: '', clientSecret: '' },
    // Public origin, e.g. https://hub.example.com (NUXT_BASE_URL). Needed behind proxies for OAuth metadata.
    baseUrl: '',
  },
  nitro: {
    // node:sqlite is a Node built-in; nothing to bundle.
    experimental: { openAPI: false, asyncContext: true },
  },
  // Signed-in areas are a client-side SPA: they need no SEO, they would only render "Loading…" on the server, and the
  // middleware decides access from the cached member. `/`, `/invite/*` and `/s/*` (public, token-gated) stay server-rendered.
  routeRules: {
    '/dashboard': { ssr: false },
    '/artifacts': { ssr: false },
    '/comments': { ssr: false },
    '/account': { ssr: false },
    '/admin/**': { ssr: false },
    '/a/**': { ssr: false },
    '/oauth/**': { ssr: false },
  },
  // Shown (on the canvas ground) in the SPA shell until the client app boots and the route's middleware settles.
  spaLoadingTemplate: true,
  app: {
    head: {
      title: 'Artifact Hub',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
      // Apply a saved theme choice before first paint (no flash).
      script: [{ innerHTML: "try{var t=localStorage.getItem('hub-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}", tagPosition: 'head' }],
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }, { name: 'theme-color', content: '#1e1e1e' }],
    },
  },
})
