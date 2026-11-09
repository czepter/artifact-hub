# Security

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on the repository's Security tab, not in a public issue.

Notes for operators:

- Serve the hub over HTTPS. Session cookies are `secure` outside development.
- Never set `NUXT_DEV_LOGIN_EMAIL` or `NUXT_DEV_TOKEN` on a deployed instance. A production build refuses to start with them set.
- Put a rate limit in front of `/oauth/register` and `/oauth/token`; the app does not limit them itself.
