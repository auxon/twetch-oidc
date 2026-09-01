# Live connection to production Twetch

This issuer is an OpenID Connect wrapper around **production Twetch auth**. It does not copy passwords or invent user ids.

## Flow

```
Relying party  --OIDC code+PKCE-->  this issuer  --challenge/sign/token/me-->  Twetch
                                         |
                                         +- ID token sub = GraphQL me.id
```

From `@twetch/sdk`:

1. `GET {TWETCH_AUTH_URL}/api/v1/challenge` → `{ message }`
2. User signs that message with the Bitcoin address on their Twetch account
3. `POST {TWETCH_AUTH_URL}/api/v1/authenticate` `{ message, signature, address, v2 }` → `{ token }`
4. `POST {TWETCH_GRAPHQL_URL}` with `Authorization: Bearer <token>`

```graphql
query {
  me {
    id
    name
    icon
    profilePhoto
    publicKey
  }
}
```

Hosted password/wallet UI still lives at `TWETCH_AUTH_FRONTEND_URL` (default `https://auth-frontend.twetch.app`) and may post `tokenTwetchAuth` to a parent frame. If the iframe is blocked, paste the Twetch session token into this issuer.

`sub` in our ID tokens is `me.id`. Apps never receive the Twetch bearer token.

## Runtime

Set `TWETCH_LIVE=true` (the default in `.env.example`). Then:

- `/interaction/:uid/challenge` fetches the challenge from Twetch
- Wallet login forwards the signature to Twetch `authenticate`, then loads `me`
- You can paste a Twetch bearer token obtained from the hosted auth frontend
- The profile is cached locally so `/token` and `/userinfo` do not need Twetch on every request
- Demo password users are not seeded

Twetch’s API is often behind Cloudflare. If `GET /api/v1/challenge` returns HTML instead of JSON, run this issuer from a network Twetch allows, or point `TWETCH_AUTH_URL` / `TWETCH_GRAPHQL_URL` at a proxy they give you.

## App integration

Unchanged. Register a client on this issuer’s `/console` after signing in with a **real** Twetch account. Point Auth.js at this issuer. No `@twetch/sdk` in the relying party.

## What you still need from Twetch

- The live auth API (`auth.twetch.app`) and GraphQL API must accept this server’s requests
- Users must have a signing address on their Twetch account (same as the historical SDK)
- Optional: allow-list this issuer’s IP / User-Agent on Cloudflare
- Optional: a first-party deploy at `https://id.twetch.app` so apps trust the issuer name

You do **not** need Twetch to implement OIDC themselves. This process is the OIDC provider; Twetch remains the account store and authenticator.