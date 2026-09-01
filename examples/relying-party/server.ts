import express from "express";
import * as client from "openid-client";

const ISSUER = process.env.TWETCH_ISSUER ?? "http://localhost:3000";
const CLIENT_ID = process.env.TWETCH_CLIENT_ID ?? "twetch-example-rp";const PORT = Number(process.env.RP_PORT ?? 3001);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const sessions = new Map<string, { verifier: string; state: string; nonce: string }>();

function sid(req: express.Request): string {
  return req.cookies.twetch_rp || "";
}

const app = express();
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries(
    (req.headers.cookie ?? "").split(";").flatMap((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return [];
      return [[part.slice(0, eq).trim(), part.slice(eq + 1).trim()]];
    }),
  );
  next();
});

app.get("/", async (req, res) => {
  const user = req.cookies.twetch_user ? JSON.parse(decodeURIComponent(req.cookies.twetch_user)) : null;
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Example app</title>
  <link rel="stylesheet" href="${ISSUER}/public/sign-in-with-twetch.css" />
  <style>
    body { font-family: Avenir Next, Segoe UI, sans-serif; background: #0c0c0d; color: #f4f1ea; margin: 40px; }
    pre { background: #161618; padding: 16px; border-radius: 12px; overflow: auto; }
  </style>
</head>
<body>
  <h1>Example relying party</h1>
  ${
    user
      ? `<p>Signed in as <strong>@${user.preferred_username || user.sub}</strong></p>
         <pre>${JSON.stringify(user, null, 2)}</pre>
         <p><a href="/logout">Sign out</a></p>`
      : `<p>This app uses standard OIDC. No Twetch SDK.</p>
         <a class="siwt" href="/login"><span class="siwt-mark"></span> Sign in with Twetch</a>`
  }
</body>
</html>`);
});

app.get("/login", async (req, res) => {
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const id = client.randomState();
  sessions.set(id, { verifier, state, nonce });
  res.cookie("twetch_rp", id, { httpOnly: true, sameSite: "lax" });
  const url = client.buildAuthorizationUrl(oidc, {
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  res.redirect(url.href);
});

app.get("/callback", async (req, res) => {
  const session = sessions.get(sid(req));
  if (!session) {
    res.status(400).send("Missing login session");
    return;
  }
  const currentUrl = new URL(req.originalUrl, `http://localhost:${PORT}`);
  const tokens = await client.authorizationCodeGrant(oidc, currentUrl, {
    pkceCodeVerifier: session.verifier,
    expectedState: session.state,
    expectedNonce: session.nonce,
  });
  const claims = tokens.claims();
  res.cookie("twetch_user", encodeURIComponent(JSON.stringify(claims)), { httpOnly: false, sameSite: "lax" });
  res.redirect("/");
});

app.get("/logout", (_req, res) => {
  res.clearCookie("twetch_rp");
  res.clearCookie("twetch_user");
  res.redirect("/");
});

oidc = await client.discovery(
  new URL(ISSUER),
  CLIENT_ID,
  CLIENT_SECRET,
  undefined,
  ISSUER.startsWith("https:") ? undefined : { execute: [client.allowInsecureRequests] },
);
app.listen(PORT, () => {
  console.log(`Example RP on http://localhost:${PORT}`);
});