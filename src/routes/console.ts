import type { Express, Request, Response } from "express";
import express from "express";
import { nanoid } from "nanoid";
import crypto from "node:crypto";
import type { AppConfig } from "../config.ts";
import type { Db } from "../db.ts";
import { getClient, listClientsByOwner, upsertClient } from "../db.ts";
import { getUserByEmail, getUserByHandle } from "../db.ts";
import { verifyPassword } from "../auth/password.ts";
import { clearUserSession, readSessionUser, setUserSession } from "../auth/session.ts";
import { createChallenge, storeChallenge } from "../auth/challenge.ts";
import { completeTwetchTokenLogin, completeTwetchWalletLogin, readSubmittedToken } from "../twetch/login.ts";
import { TwetchAuthError, type TwetchClient } from "../twetch/types.ts";
import type { OAuthClientRecord, TwetchUser } from "../types.ts";

const parseForm = express.urlencoded({ extended: false });
const parseJson = express.json();

function publicClientView(client: OAuthClientRecord, secret?: string) {
  return {    clientId: client.clientId,
    clientSecret: secret,
    hasSecret: Boolean(client.clientSecret) && client.tokenEndpointAuthMethod !== "none",
    ownerId: client.ownerId,
    clientName: client.clientName,
    clientUri: client.clientUri,
    logoUri: client.logoUri,
    redirectUris: client.redirectUris,
    postLogoutRedirectUris: client.postLogoutRedirectUris,
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    grantTypes: client.grantTypes,
    responseTypes: client.responseTypes,
    scope: client.scope,
    disabled: client.disabled,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

function parseUriList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return raw
    .split(/[\n,]+/)
    .map((uri) => uri.trim())
    .filter(Boolean);
}

function validateUris(uris: string[]): string | undefined {
  if (uris.length === 0) return "Add at least one redirect URI.";
  for (const uri of uris) {
    try {
      const parsed = new URL(uri);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return `Redirect URIs must be http or https (${uri}).`;
      }
    } catch {
      return `Invalid redirect URI: ${uri}`;
    }
  }
  return undefined;
}

async function requireConsoleUser(
  req: Request,
  res: Response,
  db: Db,
  config: AppConfig,
): Promise<TwetchUser | undefined> {
  const user = await readSessionUser(req, db, config.sessionSecret);
  if (!user) {
    res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return undefined;
  }
  return user;
}

function standaloneLocals(config: AppConfig, extra: Record<string, unknown> = {}) {
  return {
    live: config.live,
    demoMode: config.demoMode && !config.live,
    authFrontendUrl: config.twetch.authFrontendUrl,
    ...extra,
  };
}

function safeNext(value: unknown): string {
  const next = String(value ?? "/console");
  return next.startsWith("/") ? next : "/console";
}

export function mountConsole(app: Express, db: Db, config: AppConfig, twetch?: TwetchClient) {
  app.get("/login", async (req, res) => {
    const user = await readSessionUser(req, db, config.sessionSecret);
    if (user) {
      res.redirect(safeNext(req.query.next));
      return;
    }
    res.render(
      "standalone-login",
      standaloneLocals(config, {
        error: null,
        next: safeNext(req.query.next),
      }),
    );
  });

  app.get("/login/challenge", async (_req, res) => {
    if (config.live) {
      if (!twetch) {
        res.status(503).json({ error: "Twetch client is not configured." });
        return;
      }
      try {
        const message = await twetch.getChallenge();
        const challenge = storeChallenge(db, message);
        res.json({ ...challenge, source: "twetch" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not reach Twetch auth.";
        res.status(502).json({ error: message });
      }
      return;
    }
    const challenge = createChallenge(db, config.issuer);
    res.json({ ...challenge, source: "local" });
  });

  app.post("/login/wallet", parseJson, async (req, res) => {
    const { challengeId, address, signature } = req.body as {
      challengeId?: string;
      address?: string;
      signature?: string;
    };
    const next = safeNext(req.body?.next);
    if (!challengeId || !address || !signature) {
      res.status(400).json({ error: "challengeId, address, and signature are required" });
      return;
    }
    if (!config.live) {
      res.status(404).json({ error: "Wallet console login is only available in live Twetch mode." });
      return;
    }
    if (!twetch) {
      res.status(503).json({ error: "Twetch client is not configured." });
      return;
    }
    try {
      const user = await completeTwetchWalletLogin(db, twetch, { challengeId, address, signature });
      await setUserSession(res, user, config.sessionSecret);
      res.json({ ok: true, redirect: next, sub: user.id });
    } catch (err) {
      const status = err instanceof TwetchAuthError ? (err.status ?? 401) : 401;
      const message = err instanceof Error ? err.message : "Login failed";
      res.status(status).json({ error: message });
    }
  });

  app.post("/login/token", parseJson, parseForm, async (req, res) => {
    const next = safeNext(req.body?.next ?? req.query.next);
    const json = (req.headers["content-type"] ?? "").includes("application/json");
    if (!config.live) {
      if (json) {
        res.status(404).json({ error: "Token login is only available in live Twetch mode." });
        return;
      }
      res.status(404).render(
        "standalone-login",
        standaloneLocals(config, {
          error: "Token login is only available in live Twetch mode.",
          next,
        }),
      );
      return;
    }
    if (!twetch) {
      if (json) {
        res.status(503).json({ error: "Twetch client is not configured." });
        return;
      }
      res.status(503).render(
        "standalone-login",
        standaloneLocals(config, { error: "Twetch client is not configured.", next }),
      );
      return;
    }
    try {
      const user = await completeTwetchTokenLogin(db, twetch, readSubmittedToken(req.body));
      await setUserSession(res, user, config.sessionSecret);
      if (json) {
        res.json({ ok: true, redirect: next, sub: user.id });
        return;
      }
      res.redirect(next);
    } catch (err) {
      const status = err instanceof TwetchAuthError ? (err.status ?? 401) : 401;
      const message = err instanceof Error ? err.message : "Login failed";
      if (json) {
        res.status(status).json({ error: message });
        return;
      }
      res.status(status).render(
        "standalone-login",
        standaloneLocals(config, { error: message, next }),
      );
    }
  });

  app.post("/login", parseForm, async (req, res) => {
    const next = safeNext(req.body.next);
    if (config.live) {
      const token = readSubmittedToken(req.body);
      if (token && twetch) {
        try {
          const user = await completeTwetchTokenLogin(db, twetch, token);
          await setUserSession(res, user, config.sessionSecret);
          res.redirect(next);
          return;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Twetch token was rejected.";
          res.status(401).render(
            "standalone-login",
            standaloneLocals(config, { error: message, next }),
          );
          return;
        }
      }
      res.status(400).render(
        "standalone-login",
        standaloneLocals(config, {
          error: "Sign in with your Twetch wallet or paste a Twetch session token.",
          next,
        }),
      );
      return;
    }

    const identifier = String(req.body.identifier ?? "").trim();
    const password = String(req.body.password ?? "");
    const user =
      (identifier.includes("@") ? getUserByEmail(db, identifier) : undefined) ??
      getUserByHandle(db, identifier.replace(/^@/, ""));

    if (!user || !(await verifyPassword(user, password))) {
      res.status(401).render(
        "standalone-login",
        standaloneLocals(config, {
          error: "That account or password did not match.",
          next,
        }),
      );
      return;
    }

    await setUserSession(res, user, config.sessionSecret);
    res.redirect(next);
  });

  app.post("/logout", parseForm, async (_req, res) => {    clearUserSession(res);
    res.redirect("/");
  });

  app.get("/console", async (req, res) => {
    const user = await requireConsoleUser(req, res, db, config);
    if (!user) return;
    const clients = listClientsByOwner(db, user.id).map((client) => publicClientView(client));
    res.render("console", {
      user,
      clients,
      issuer: config.issuer,
      created: req.query.created
        ? {
            clientId: String(req.query.created),
            clientSecret: req.query.secret ? String(req.query.secret) : undefined,
          }
        : null,
      error: req.query.error ? String(req.query.error) : null,
    });
  });

  app.post("/console/apps", parseForm, async (req, res) => {
    const user = await requireConsoleUser(req, res, db, config);
    if (!user) return;

    const clientName = String(req.body.client_name ?? "").trim();
    const redirectUris = parseUriList(req.body.redirect_uris);
    const postLogoutRedirectUris = parseUriList(req.body.post_logout_redirect_uris);
    const publicClient = String(req.body.public_client ?? "") === "on";
    const uriError = validateUris(redirectUris);
    if (!clientName) {
      res.redirect("/console?error=" + encodeURIComponent("App name is required."));
      return;
    }
    if (uriError) {
      res.redirect("/console?error=" + encodeURIComponent(uriError));
      return;
    }

    const now = Date.now();
    const clientId = `twetch_${nanoid(20)}`;
    const clientSecret = publicClient ? null : crypto.randomBytes(32).toString("hex");
    const record: OAuthClientRecord = {
      clientId,
      clientSecret,
      ownerId: user.id,
      clientName,
      clientUri: String(req.body.client_uri ?? "").trim() || null,
      logoUri: String(req.body.logo_uri ?? "").trim() || null,
      redirectUris,
      postLogoutRedirectUris,
      tokenEndpointAuthMethod: publicClient ? "none" : "client_secret_post",
      grantTypes: publicClient ? ["authorization_code"] : ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      scope: "openid profile email offline_access",
      disabled: false,
      createdAt: now,
      updatedAt: now,
    };
    upsertClient(db, record);

    const q = new URLSearchParams({ created: clientId });
    if (clientSecret) q.set("secret", clientSecret);
    res.redirect(`/console?${q.toString()}`);
  });

  app.post("/console/apps/:clientId/update", parseForm, async (req, res) => {
    const user = await requireConsoleUser(req, res, db, config);
    if (!user) return;
    const existing = getClient(db, req.params.clientId);
    if (!existing || existing.ownerId !== user.id) {
      res.status(404).send("App not found");
      return;
    }
    const redirectUris = parseUriList(req.body.redirect_uris);
    const uriError = validateUris(redirectUris);
    if (uriError) {
      res.redirect("/console?error=" + encodeURIComponent(uriError));
      return;
    }
    upsertClient(db, {
      ...existing,
      clientName: String(req.body.client_name ?? existing.clientName).trim() || existing.clientName,
      clientUri: String(req.body.client_uri ?? "").trim() || null,
      logoUri: String(req.body.logo_uri ?? "").trim() || null,
      redirectUris,
      postLogoutRedirectUris: parseUriList(req.body.post_logout_redirect_uris),
      updatedAt: Date.now(),
    });
    res.redirect("/console");
  });

  app.post("/console/apps/:clientId/rotate-secret", parseForm, async (req, res) => {
    const user = await requireConsoleUser(req, res, db, config);
    if (!user) return;
    const existing = getClient(db, req.params.clientId);
    if (!existing || existing.ownerId !== user.id) {
      res.status(404).send("App not found");
      return;
    }
    if (existing.tokenEndpointAuthMethod === "none") {
      res.redirect("/console?error=" + encodeURIComponent("Public clients do not have a secret."));
      return;
    }
    const clientSecret = crypto.randomBytes(32).toString("hex");
    upsertClient(db, { ...existing, clientSecret, updatedAt: Date.now() });
    const q = new URLSearchParams({ created: existing.clientId, secret: clientSecret });
    res.redirect(`/console?${q.toString()}`);
  });

  app.post("/console/apps/:clientId/disable", parseForm, async (req, res) => {
    const user = await requireConsoleUser(req, res, db, config);
    if (!user) return;
    const existing = getClient(db, req.params.clientId);
    if (!existing || existing.ownerId !== user.id) {
      res.status(404).send("App not found");
      return;
    }
    upsertClient(db, { ...existing, disabled: true, updatedAt: Date.now() });
    res.redirect("/console");
  });
}