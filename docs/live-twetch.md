# Live connection to production Twetch

This issuer is an OpenID Connect wrapper around **production Twetch accounts on twetch.com**. It does not copy passwords or invent user ids.

The legacy `*.twetch.app` auth stack (`auth.twetch.app`, `api.twetch.app`, GraphQL) returns nginx 503 and is not used.

## Flow

```
Relying party  --OIDC code+PKCE-->  this issuer  --seed challenge / user-by-pubkey / users/{id}-->  api.twetch.com
                                         |
                                         +- ID token sub = Twetch user id
```

1. This issuer creates a local one-time challenge
2. The browser derives the Twetch identity key from the 12-word seed (`m/0/0`) and signs that challenge
3. Only `{ challengeId, signature, publicKey }` is POSTed
4. The issuer recovers the pubkey, then `GET {TWETCH_API_URL}/v1/auth/user-by-pubkey/{pubkey}` → `{ userId }`
5. `GET {TWETCH_API_URL}/v1/users/{userId}` → `{ id, name, icon, publicKey }`

`sub` in our ID tokens is that `userId`. The seed phrase is never sent to this Worker. Posts that include `mnemonic` / `seed` are rejected.

## Runtime

Set `TWETCH_LIVE=true` (the default in `.env.example` and Worker vars). Then:

- `/login` and `/interaction/:uid` accept the Twetch seed in the browser
- The profile is cached locally so `/token` and `/userinfo` do not need Twetch on every request
- Demo password users are not seeded

If `api.twetch.com` returns HTML instead of JSON (Cloudflare or origin 503), the issuer surfaces a short error instead of dumping the HTML page.

## App integration

Unchanged. Register a client on this issuer’s `/console` after signing in with a **real** Twetch account. Point Auth.js at this issuer.

## What you still need from Twetch

- `https://api.twetch.com` must accept this server’s requests
- Users sign in with the 12-word backup from twetch.com
- Production issuer hostname: `https://id.entangleit.com`

You do **not** need Twetch to implement OIDC themselves. This process is the OIDC provider; Twetch remains the account store and authenticator.
