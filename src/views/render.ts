function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function header(data: { title?: string; user?: { handle: string } | null }) {
  const user = data.user;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(data.title ?? "Twetch")}</title>
  <link rel="stylesheet" href="/public/twetch.css" />
  <link rel="stylesheet" href="/public/sign-in-with-twetch.css" />
</head>
<body class="page">
  <header class="top">
    <a class="brand" href="/">
      <span class="mark" aria-hidden="true"></span>
      Twetch
    </a>
    <nav>
      <a href="/docs">Docs</a>
      <a href="/console">Console</a>
      ${
        user
          ? `<form method="post" action="/logout" class="inline">
          <button class="linkish" type="submit">Sign out</button>
        </form>`
          : `<a href="/login">Sign in</a>`
      }
    </nav>
  </header>
  <main>`;
}

const footer = `  </main>
</body>
</html>`;

export function renderView(name: string, data: Record<string, unknown>): string {
  const key = name.replace(/\.ejs$/, "");
  switch (key) {
    case "home":
      return renderHome(data);
    case "docs":
      return renderDocs(data);
    case "console":
      return renderConsole(data);
    case "standalone-login":
      return renderStandaloneLogin(data);
    case "login":
      return renderLogin(data);
    case "consent":
      return renderConsent(data);
    default:
      throw new Error(`Unknown view: ${name}`);
  }
}

function renderHome(data: Record<string, unknown>) {
  const issuer = esc(data.issuer);
  const live = Boolean(data.live);
  const demoMode = Boolean(data.demoMode);
  return `${header({ title: "Sign in with Twetch", user: data.user as { handle: string } | null })}
<section class="hero">
  <p class="muted">OpenID Connect identity provider</p>
  <h1>Sign in with Twetch</h1>
  <p class="lede">
    Third-party apps can add a button and a few environment variables.
    Users keep a stable Twetch account id even if they rotate signing keys.
  </p>
  <div class="row" style="margin-top: 22px;">
    <a class="siwt" href="/console">
      <span class="siwt-mark"></span>
      Open developer console
    </a>
    <a class="btn secondary" href="/docs">Setup guide</a>
  </div>
</section>
<section class="card">
  <h2>Issuer</h2>
  <p class="mono">${issuer}</p>
  <p class="muted">Discovery is at <span class="mono">${issuer}/.well-known/openid-configuration</span></p>
  ${
    live
      ? `<p>Connected to production Twetch at <span class="mono">${esc(data.authUrl)}</span>. <span class="mono">sub</span> is the live Twetch user id.</p>`
      : demoMode
        ? `<p>Demo password login: <span class="mono">josh@twetch.example / twetch-demo</span></p>`
        : ""
  }
</section>
<section class="grid-2">
  <article class="card">
    <h3>What apps get</h3>
    <p class="muted">Authorization code + PKCE, ID tokens signed with published JWKS, and <span class="mono">sub</span> locked to the Twetch user id.</p>
  </article>
  <article class="card">
    <h3>What users see</h3>
    <p class="muted">Hosted login on this origin, then a consent screen naming the app, logo, and requested profile scopes.</p>
  </article>
</section>
${footer}`;
}

function renderDocs(data: Record<string, unknown>) {
  const issuer = esc(data.issuer);
  return `${header({
    title: "Sign in with Twetch docs",
    user: (data.user as { handle: string } | null | undefined) ?? null,
  })}
<h1>Add Sign in with Twetch</h1>
<p class="lede">This issuer speaks OpenID Connect. Auth.js, Passport, and other OIDC libraries work with three values: issuer, client id, and client secret.</p>
<section class="card">
  <h2>1. Register an app</h2>
  <p>Open the <a href="/console">developer console</a>, create a client, and set the callback to:</p>
  <pre class="code">https://your-app.example/api/auth/callback/twetch</pre>
  <p class="muted">Redirect URIs are exact-match. Localhost HTTP is allowed for development.</p>
</section>
<section class="card">
  <h2>2. Auth.js / NextAuth provider</h2>
  <pre class="code">import Twetch from "@twetch/authjs-provider";

export const { handlers, auth } = NextAuth({
  providers: [
    Twetch({
      issuer: "${issuer}",
      clientId: process.env.TWETCH_CLIENT_ID,
      clientSecret: process.env.TWETCH_CLIENT_SECRET,
    }),
  ],
});</pre>
</section>
<section class="card">
  <h2>3. Button</h2>
  <pre class="code">&lt;link rel="stylesheet" href="${issuer}/public/sign-in-with-twetch.css" /&gt;
&lt;a class="siwt" href="/api/auth/signin/twetch"&gt;
  &lt;span class="siwt-mark"&gt;&lt;/span&gt;
  Sign in with Twetch
&lt;/a&gt;</pre>
  <a class="siwt" href="/login"><span class="siwt-mark"></span> Sign in with Twetch</a>
</section>
<section class="card">
  <h2>Claims</h2>
  <p><span class="mono">sub</span> is the Twetch user id. It does not change when a user rotates signing keys.</p>
</section>
${footer}`;
}

function renderConsole(data: Record<string, unknown>) {
  const user = data.user as { handle: string };
  const clients = (data.clients as Array<Record<string, unknown>>) ?? [];
  const created = data.created as { clientId: string; clientSecret?: string } | null;
  const error = data.error as string | null;
  const apps = clients
    .map((app) => {
      const id = esc(app.clientId);
      return `<section class="app">
    <h3>${esc(app.clientName)}${app.disabled ? ` <span class="muted">(disabled)</span>` : ""}</h3>
    <p>Client ID: <span class="mono">${id}</span></p>
    <p>Auth method: <span class="mono">${esc(app.tokenEndpointAuthMethod)}</span></p>
    <form class="stack" method="post" action="/console/apps/${id}/update">
      <label>App name <input name="client_name" value="${esc(app.clientName)}" /></label>
      <label>Homepage <input name="client_uri" value="${esc(app.clientUri || "")}" /></label>
      <label>Logo URL <input name="logo_uri" value="${esc(app.logoUri || "")}" /></label>
      <label>Redirect URIs
        <textarea name="redirect_uris">${esc((app.redirectUris as string[]).join("\n"))}</textarea>
      </label>
      <label>Post-logout redirect URIs
        <textarea name="post_logout_redirect_uris">${esc((app.postLogoutRedirectUris as string[]).join("\n"))}</textarea>
      </label>
      <div class="row"><button class="btn" type="submit">Save</button></div>
    </form>
    <div class="row" style="margin-top: 12px;">
      ${
        app.tokenEndpointAuthMethod !== "none"
          ? `<form method="post" action="/console/apps/${id}/rotate-secret"><button class="btn secondary" type="submit">Rotate secret</button></form>`
          : ""
      }
      ${
        !app.disabled
          ? `<form method="post" action="/console/apps/${id}/disable"><button class="btn danger" type="submit">Disable</button></form>`
          : ""
      }
    </div>
  </section>`;
    })
    .join("\n");

  return `${header({ title: "Developer console", user })}
<h1>Developer console</h1>
<p class="lede">Register OAuth clients the way Google Cloud Console does.</p>
<p class="muted">Issuer <span class="mono">${esc(data.issuer)}</span> · signed in as @${esc(user.handle)}</p>
${error ? `<div class="flash error">${esc(error)}</div>` : ""}
${
  created
    ? `<div class="flash ok">
    <p>App created. Copy the secret now — it is not shown again.</p>
    <p>Client ID: <span class="mono">${esc(created.clientId)}</span></p>
    ${
      created.clientSecret
        ? `<p>Client secret: <span class="mono">${esc(created.clientSecret)}</span></p>`
        : `<p>Public client (PKCE only, no secret).</p>`
    }
  </div>`
    : ""
}
<section class="card">
  <h2>New app</h2>
  <form class="stack" method="post" action="/console/apps">
    <label>App name <input name="client_name" required placeholder="Acme Board" /></label>
    <label>Homepage <input name="client_uri" placeholder="https://example.com" /></label>
    <label>Logo URL <input name="logo_uri" placeholder="https://example.com/logo.png" /></label>
    <label>Redirect URIs (one per line)
      <textarea name="redirect_uris" required placeholder="http://localhost:3001/callback"></textarea>
    </label>
    <label>Post-logout redirect URIs
      <textarea name="post_logout_redirect_uris" placeholder="http://localhost:3001"></textarea>
    </label>
    <label class="row" style="color: var(--ink);">
      <input type="checkbox" name="public_client" />
      Public client (SPA, PKCE, no secret)
    </label>
    <button class="btn" type="submit">Create client</button>
  </form>
</section>
${apps}
${footer}`;
}

function liveSeedFields() {
  return `<div class="stack">
      <p class="lede">Paste the 12-word seed from your production Twetch account. It is derived and signed in this browser. The words are never sent to this issuer.</p>
      <label>Twetch seed phrase
        <textarea id="seed-phrase" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="twelve words from your Twetch backup"></textarea>
      </label>
      <button class="btn" type="button" id="seed-login">Sign in with seed</button>
      <p class="muted" id="seed-status"></p>
    </div>`;
}

function localWalletFields() {
  return `<div class="stack">
      <button class="btn secondary" type="button" id="load-challenge">Get challenge</button>
      <pre class="code" id="challenge-text">Challenge will appear here.</pre>
      <label>Signing address<input id="address" placeholder="1..." autocomplete="off" /></label>
      <label>Signature<textarea id="signature" placeholder="Bitcoin signed message"></textarea></label>
      <button class="btn secondary" type="button" id="wallet-login">Verify signature</button>
      <p class="muted" id="wallet-status"></p>
    </div>`;
}

function renderStandaloneLogin(data: Record<string, unknown>) {
  const live = Boolean(data.live);
  const next = esc(data.next ?? "/console");
  return `${header({ title: "Sign in", user: null })}
<section class="card" style="max-width: 460px;">
  <h1>Sign in</h1>
  ${data.error ? `<div class="flash error">${esc(data.error)}</div>` : ""}
  ${
    live
      ? liveSeedFields()
      : `<form class="stack" method="post" action="/login">
          <input type="hidden" name="next" value="${next}" />
          <label>Handle or email<input name="identifier" required /></label>
          <label>Password<input name="password" type="password" required /></label>
          <button class="btn" type="submit">Continue</button>
        </form>`
  }
</section>
<script src="/public/twetch-seed.js"></script>
${footer}`;
}

function renderLogin(data: Record<string, unknown>) {
  const client = data.client as { clientName?: string; clientId: string };
  const live = Boolean(data.live);
  const demoMode = Boolean(data.demoMode);
  const uid = esc(data.uid);
  const demoWallet = data.demoWallet as { address?: string } | null;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in with Twetch</title>
  <link rel="stylesheet" href="/public/twetch.css" />
</head>
<body class="page">
  <main>
    <section class="card" style="max-width: 460px; margin: 8vh auto;">
      <p class="muted">${esc(client.clientName || client.clientId)}</p>
      <h1>Sign in with Twetch</h1>
      ${data.error ? `<div class="flash error">${esc(data.error)}</div>` : ""}
      ${
        live
          ? liveSeedFields()
          : `<form class="stack" method="post" action="/interaction/${uid}/login">
              <label>Handle or email<input name="identifier" required /></label>
              <label>Password<input name="password" type="password" required /></label>
              <button class="btn" type="submit">Continue</button>
            </form>
            <hr style="border: 0; border-top: 1px solid var(--line); margin: 24px 0;" />
            <h2 style="font-size: 18px;">Bitcoin signature</h2>
            ${localWalletFields()}`
      }
      ${
        demoMode
          ? `<form method="post" action="/interaction/${uid}/demo-wallet" style="margin-top: 16px;">
              <button class="btn secondary" type="submit">Use demo wallet (user #2)</button>
            </form>
            <p class="muted">Demo address: <span class="mono">${esc(demoWallet?.address)}</span></p>`
          : ""
      }
      <form method="post" action="/interaction/${uid}/abort" style="margin-top: 20px;">
        <button class="linkish" type="submit">Cancel</button>
      </form>
    </section>
  </main>
  ${live ? "" : `<script src="/public/twetch-login.js"></script>`}
  ${live ? `<script src="/public/twetch-seed.js"></script>` : ""}
</body>
</html>`;
}

function renderConsent(data: Record<string, unknown>) {
  const client = data.client as { clientName?: string; clientId: string; logoUri?: string };
  const user = data.user as { displayName?: string; handle?: string } | undefined;
  const scopes = (data.scopes as Array<{ scope: string; label: string }>) ?? [];
  const uid = esc(data.uid);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Allow access</title>
  <link rel="stylesheet" href="/public/twetch.css" />
</head>
<body class="page">
  <main>
    <section class="card" style="max-width: 460px; margin: 8vh auto;">
      ${client.logoUri ? `<img src="${esc(client.logoUri)}" alt="" style="width:48px;height:48px;border-radius:12px;" />` : ""}
      <h1>${esc(client.clientName || client.clientId)} wants access</h1>
      <p class="muted">Signed in as ${esc(user?.displayName || user?.handle || "Twetch user")}</p>
      <ul>
        ${scopes.map((s) => `<li><strong>${esc(s.scope)}</strong> — ${esc(s.label)}</li>`).join("")}
      </ul>
      <form method="post" action="/interaction/${uid}/confirm" class="row" style="margin-top: 20px;">
        <button class="btn" type="submit">Allow</button>
      </form>
      <form method="post" action="/interaction/${uid}/abort" style="margin-top: 12px;">
        <button class="linkish" type="submit">Deny</button>
      </form>
    </section>
  </main>
</body>
</html>`;
}
