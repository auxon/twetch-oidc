# Sign in with Twetch

Twetch as a login provider, in the same shape as Google OAuth: **OpenID Connect** on top of **production Twetch accounts**.

Apps configure `issuer`, `client_id`, and `client_secret`. Users keep a stable Twetch user id (`sub` = GraphQL `me.id`) even if they rotate Bitcoin signing keys.

This repo is a standalone identity provider. Relying parties do not embed `@twetch/sdk`. Wallet signatures and the hosted Twetch auth UI are used only inside this issuer, the same way Google uses a password internally.

## Quick start (live Twetch)

```bash
cp .env.example .env
# set COOKIE_KEYS and SESSION_SECRET
npm install
npm test
npm run dev
```

`.env.example` sets `TWETCH_LIVE=true`. The issuer then:

1. Loads the Bitcoin challenge from `https://auth.twetch.app/api/v1/challenge`
2. Sends the signature to `/api/v1/authenticate`
3. Reads `me { id name … }` from `https://api.twetch.app/v1/graphql`
4. Issues its own OIDC tokens with `sub = me.id`

- IdP: http://localhost:3000
- Discovery: http://localhost:3000/.well-known/openid-configuration
- Console: http://localhost:3000/console (sign in with a real Twetch account)
- Docs: http://localhost:3000/docs
- Live Twetch notes: [`docs/live-twetch.md`](docs/live-twetch.md)

Offline demo users (`josh@twetch.example`) exist only when `TWETCH_LIVE=false`.

In another terminal:

```bash
npm run dev:rp
```

Open http://localhost:3001 and use **Sign in with Twetch**. The seeded local client is `twetch-example-rp`.

## What was built

| Piece | Where |
| --- | --- |
| OIDC authorization server (`oidc-provider`) | [`src/oidc`](src/oidc) |
| Authorize / token / userinfo / JWKS / revoke / logout | routes on the issuer |
| Production Twetch challenge / authenticate / me | [`src/twetch`](src/twetch) |
| Hosted login + consent | [`src/routes/interaction.ts`](src/routes/interaction.ts) |
| Developer console | [`src/routes/console.ts`](src/routes/console.ts) |
| Claims (`sub` = Twetch user id) | [`src/oidc/account.ts`](src/oidc/account.ts) |
| Auth.js provider | [`packages/authjs-twetch`](packages/authjs-twetch) |
| Button + setup guide | [`docs/sign-in-with-twetch.md`](docs/sign-in-with-twetch.md), `/docs` |

```
Relying party  --OIDC code+PKCE-->  id.twetch.app  --live session-->  Twetch
                                         |                              |
                                         |                              +- hosted auth UI
                                         +- ID token (sub=me.id)        +- Bitcoin signature
```

## Scopes

- `openid` — `sub` (Twetch user id)
- `profile` — name, handle, avatar, profile URL, optional `twetch_pubkey`
- `email` — only if the account actually has an email
- `offline_access` — refresh token, confidential clients only

## Production notes

Set `ISSUER=https://id.twetch.app`, `TWETCH_LIVE=true`, strong `COOKIE_KEYS` / `SESSION_SECRET`, and terminate TLS in front of Node. If Cloudflare blocks `auth.twetch.app` from your host, point `TWETCH_AUTH_URL` and `TWETCH_GRAPHQL_URL` at an allow-listed proxy.

Rotate the RSA signing keys stored in SQLite (`signing_keys`) using the oidc-provider JWKS order described in its docs.

Login tokens are identity only. Do not stuff pay/post grants into the ID token.