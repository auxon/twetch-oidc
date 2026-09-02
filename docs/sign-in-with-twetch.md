# Sign in with Twetch

Use Twetch as a login provider the same way you use Google: register a client, point an OIDC library at this issuer, show a button.

## Issuer

Production issuer is `https://id.entangleit.com`. Locally it is `http://localhost:3000`.

Discovery:

```
GET {issuer}/.well-known/openid-configuration
```

Endpoints:

| Endpoint | Path |
| --- | --- |
| Authorization | `/authorize` |
| Token | `/token` |
| UserInfo | `/userinfo` |
| JWKS | `/jwks` |
| Revocation | `/revoke` |
| Logout | `/logout` |

PKCE (`S256`) is required. Refresh tokens are issued only when the client is confidential and requests `offline_access`.

## Register an app

1. Sign in at `{issuer}/console`.
2. Create an app with exact redirect URIs.
3. Copy `client_id` and `client_secret` (the secret is shown once).

Callback for Auth.js:

```
https://your-app.example/api/auth/callback/twetch
```

## Auth.js

```ts
import NextAuth from "next-auth";
import Twetch from "@twetch/authjs-provider";

export const { handlers, auth } = NextAuth({
  providers: [
    Twetch({
      issuer: process.env.TWETCH_ISSUER, // https://id.entangleit.com
      clientId: process.env.TWETCH_CLIENT_ID,
      clientSecret: process.env.TWETCH_CLIENT_SECRET,
    }),
  ],
});
```

Equivalent inline provider:

```ts
{
  id: "twetch",
  name: "Twetch",
  type: "oidc",
  issuer: process.env.TWETCH_ISSUER,
  clientId: process.env.TWETCH_CLIENT_ID,
  clientSecret: process.env.TWETCH_CLIENT_SECRET,
  authorization: { params: { scope: "openid profile" } },
}
```

Ask for email only if you need it: `scope: "openid profile email"`. Email is omitted from tokens when the Twetch account has none.

## Button

```html
<link rel="stylesheet" href="https://id.entangleit.com/public/sign-in-with-twetch.css" />
<a class="siwt" href="/api/auth/signin/twetch">
  <span class="siwt-mark"></span>
  Sign in with Twetch
</a>
```

## Claims

`sub` is the Twetch user id from production GraphQL `me { id }`. Users can rotate Bitcoin signing keys without changing `sub`.

| Scope | Claims |
| --- | --- || `openid` | `sub` |
| `profile` | `name`, `preferred_username`, `picture`, `profile`, `updated_at`, `twetch_pubkey` |
| `email` | `email`, `email_verified` — only if the account has an email |

Do not mint a fake email. Downstream account linking should use `sub`, not address.

## Identity vs payments

Login tokens are identity only. Posting or paying needs a separate Connect-style grant after login.