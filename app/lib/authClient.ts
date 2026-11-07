import { createAuthClient } from 'better-auth/vue'
import { passkeyClient } from '@better-auth/passkey/client'

export const authClient = createAuthClient({ plugins: [passkeyClient()] })
