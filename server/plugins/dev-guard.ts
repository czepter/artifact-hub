// A production build must never carry a development login. Fail loudly instead of starting.
export default defineNitroPlugin(() => {
  const set = ['NUXT_DEV_LOGIN_EMAIL', 'NUXT_DEV_TOKEN'].filter(k => process.env[k])
  if (!import.meta.dev && set.length) {
    throw new Error(`${set.join(' and ')} must not be set outside "nuxt dev". Refusing to start.`)
  }
  if (import.meta.dev && set.length) console.warn(`[dev-login] ${set.join(' and ')} active: every request is signed in without a password. Development only.`)
})
