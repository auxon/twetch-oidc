import type { Express, Request, Response } from "express";
import express from "express";
import type { Provider } from "oidc-provider";
import type { AppConfig } from "../config.ts";import type { Db } from "../db.ts";
import { getUserByEmail, getUserByHandle, getUserById, getUserBySigningAddress } from "../db.ts";
import { createChallenge, storeChallenge, takeChallenge } from "../auth/challenge.ts";
import { verifyMessage } from "../auth/bitcoin.ts";
import { verifyPassword } from "../auth/password.ts";
import { demoWallet } from "../seed.ts";
import { signMessage } from "../auth/bitcoin.ts";
import { readSessionUser, setUserSession } from "../auth/session.ts";
import { completeTwetchSeedLogin, completeTwetchWalletLogin } from "../twetch/login.ts";
import { TwetchAuthError, type TwetchClient } from "../twetch/types.ts";
import type { TwetchUser } from "../types.ts";

const parseForm = express.urlencoded({ extended: false });
const parseJson = express.json();

function requestedScopes(params: Record<string, unknown>): string[] {
  return String(params.scope ?? "openid")
    .split(/\s+/)
    .filter(Boolean);
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "openid":
      return "Verify your Twetch account";
    case "profile":
      return "See your name, handle, and avatar";
    case "email":
      return "See your email address, if you have one";
    case "offline_access":
      return "Stay signed in when you’re away";
    default:
      return scope;
  }
}

async function finishLogin(provider: Provider, req: Request, res: Response, user: TwetchUser, sessionSecret: string) {
  await setUserSession(res, user, sessionSecret);
  await provider.interactionFinished(
    req,
    res,
    { login: { accountId: user.id, remember: true } },
    { mergeWithLastSubmission: false },
  );
}

/**
 * JSON variant of finishLogin for fetch-based logins (seed flow).
 *
 * interactionFinished answers 303 + Location, whose header is not reliably
 * readable from fetch (manual-redirect responses surface as opaque in some
 * browsers), leaving the tab stuck on the login form after a successful
 * login. interactionResult returns the same resume URL as a string so the
 * client can navigate to it explicitly.
 */
async function finishLoginJson(provider: Provider, req: Request, res: Response, user: TwetchUser, sessionSecret: string) {
  await setUserSession(res, user, sessionSecret);
  const resume = await provider.interactionResult(
    req,
    res,
    { login: { accountId: user.id, remember: true } },
    { mergeWithLastSubmission: false },
  );
  res.json({ ok: true, redirect: resume, sub: user.id });
}

function loginLocals(config: AppConfig, extra: Record<string, unknown> = {}) {
  const demo = config.demoMode && !config.live;
  return {
    live: config.live,
    demoMode: demo,
    authFrontendUrl: config.twetch.authFrontendUrl,
    demoWallet: demo ? demoWallet() : null,
    ...extra,
  };
}

async function renderLogin(
  provider: Provider,
  req: Request,
  res: Response,
  config: AppConfig,
  extra: { error?: string | null; status?: number } = {},
) {
  const details = await provider.interactionDetails(req, res);
  const client = await provider.Client.find(String(details.params.client_id));
  res.status(extra.status ?? 200).render(
    "login",
    loginLocals(config, {
      uid: details.uid,
      client,
      params: details.params,
      error: extra.error ?? null,
    }),
  );
}

function wantsJson(req: Request): boolean {
  return (req.headers["content-type"] ?? "").includes("application/json");
}

function hasSeedPhraseField(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  return ["mnemonic", "seed", "seedPhrase", "phrase"].some((key) => typeof record[key] === "string" && record[key]);
}

function sendLoginError(req: Request, res: Response, err: unknown) {
  const status = err instanceof TwetchAuthError ? (err.status ?? 401) : 401;
  const message = err instanceof Error ? err.message : "Login failed";
  if (wantsJson(req)) {
    res.status(status).json({ error: message });
    return true;
  }
  return { status, message };
}

export function mountInteraction(
  app: Express,
  provider: Provider,
  db: Db,
  config: AppConfig,
  twetch?: TwetchClient,
) {
  app.get("/interaction/:uid", async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res);
      const { uid, prompt, params } = details;
      const client = await provider.Client.find(String(params.client_id));

      if (prompt.name === "login") {
        const existing = await readSessionUser(req, db, config.sessionSecret);
        if (existing) {
          await finishLogin(provider, req, res, existing, config.sessionSecret);
          return;
        }
        return res.render(
          "login",
          loginLocals(config, {
            uid,
            client,
            params,
            error: null,
          }),
        );
      }

      const accountId = details.session?.accountId;
      const account = accountId ? await getUserById(db, accountId) : undefined;
      return res.render("consent", {
        uid,
        client,        params,
        scopes: requestedScopes(params as Record<string, unknown>).map((scope) => ({
          scope,
          label: scopeLabel(scope),
        })),
        user: account,
        details: prompt.details,
      });
    } catch (err) {      next(err);
    }
  });

  app.post("/interaction/:uid/login", parseForm, async (req, res, next) => {
    try {
      if (config.live) {
        await renderLogin(provider, req, res, config, {
          error: "Password login is disabled. Sign with your Twetch wallet or paste a Twetch session token.",
          status: 400,
        });
        return;
      }
      const identifier = String(req.body.identifier ?? "").trim();
      const password = String(req.body.password ?? "");
      const user =
        (identifier.includes("@") ? await getUserByEmail(db, identifier) : undefined) ??
        (await getUserByHandle(db, identifier.replace(/^@/, "")));

      if (!user || !(await verifyPassword(user, password))) {
        await renderLogin(provider, req, res, config, {
          error: "That account or password did not match.",
          status: 401,
        });
        return;
      }

      await finishLogin(provider, req, res, user, config.sessionSecret);
    } catch (err) {
      next(err);
    }
  });

  app.get("/interaction/:uid/challenge", async (req, res, next) => {
    try {
      await provider.interactionDetails(req, res);
      if (config.live) {
        if (!twetch) {
          res.status(503).json({ error: "Twetch client is not configured." });
          return;
        }
        try {
          const payload = await twetch.getChallenge();
          const stored = await storeChallenge(db, JSON.stringify(payload));
          res.json({ id: stored.id, message: payload.message, source: "twetch" });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Could not reach Twetch auth.";
          res.status(502).json({ error: message });
        }
        return;
      }
      const challenge = await createChallenge(db, config.issuer);
      res.json({ ...challenge, source: "local" });
    } catch (err) {
      next(err);
    }
  });

  app.post("/interaction/:uid/wallet", parseJson, async (req, res, next) => {
    try {
      await provider.interactionDetails(req, res);
      const { challengeId, address, signature, algorithm } = req.body as {
        challengeId?: string;
        address?: string;
        signature?: string;
        algorithm?: string;
      };
      if (!challengeId || !address || !signature) {
        res.status(400).json({ error: "challengeId, address, and signature are required" });
        return;
      }

      if (config.live) {
        if (!twetch) {
          res.status(503).json({ error: "Twetch client is not configured." });
          return;
        }
        try {
          const user = await completeTwetchWalletLogin(db, twetch, { challengeId, address, signature, algorithm });
          await finishLogin(provider, req, res, user, config.sessionSecret);
        } catch (err) {
          sendLoginError(req, res, err);
        }
        return;
      }

      const message = await takeChallenge(db, challengeId);
      if (!message) {
        res.status(400).json({ error: "Challenge expired. Request a new one." });
        return;
      }
      if (!verifyMessage(message, address, signature)) {
        res.status(401).json({ error: "Signature did not match that Bitcoin address." });
        return;
      }
      const user = await getUserBySigningAddress(db, address);
      if (!user) {
        res.status(401).json({ error: "No Twetch account is linked to that signing address." });
        return;
      }
      await finishLogin(provider, req, res, user, config.sessionSecret);
    } catch (err) {
      next(err);
    }
  });

  app.get("/interaction/:uid/seed-challenge", async (req, res, next) => {
    try {
      await provider.interactionDetails(req, res);
      const challenge = await createChallenge(db, config.issuer);
      res.json({ ...challenge, source: "local" });
    } catch (err) {
      next(err);
    }
  });

  app.post("/interaction/:uid/seed", parseJson, async (req, res, next) => {
    try {
      await provider.interactionDetails(req, res);
      if (hasSeedPhraseField(req.body)) {
        res.status(400).json({ error: "Do not send a seed phrase to the server." });
        return;
      }
      const { challengeId, signature, publicKey } = req.body as {
        challengeId?: string;
        signature?: string;
        publicKey?: string;
      };
      if (!challengeId || !signature) {
        res.status(400).json({ error: "challengeId and signature are required" });
        return;
      }
      if (!config.live) {
        res.status(404).json({ error: "Seed login is only available in live Twetch mode." });
        return;
      }
      if (!twetch) {
        res.status(503).json({ error: "Twetch client is not configured." });
        return;
      }
      try {
        const user = await completeTwetchSeedLogin(db, twetch, { challengeId, signature, publicKey });
        await finishLoginJson(provider, req, res, user, config.sessionSecret);
      } catch (err) {
        sendLoginError(req, res, err);
      }
    } catch (err) {
      next(err);
    }
  });

  app.post("/interaction/:uid/token", parseJson, parseForm, async (req, res, next) => {
    try {
      await provider.interactionDetails(req, res);
      if (wantsJson(req)) {
        res.status(410).json({ error: "Twetch no longer issues session tokens. Sign the wallet challenge instead." });
        return;
      }
      await renderLogin(provider, req, res, config, {
        error: "Twetch no longer issues session tokens. Sign the wallet challenge instead.",
        status: 410,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/interaction/:uid/demo-wallet", parseForm, async (req, res, next) => {
    try {
      if (!config.demoMode || config.live) {
        res.status(404).send("Demo wallet signing is disabled");
        return;
      }
      await provider.interactionDetails(req, res);
      const challenge = await createChallenge(db, config.issuer);
      const wallet = demoWallet();
      const signature = signMessage(challenge.message, wallet.secretKey);
      const user = await getUserBySigningAddress(db, wallet.address);
      if (!user) {
        res.status(500).send("Demo wallet user is missing");
        return;
      }
      if (!verifyMessage(challenge.message, wallet.address, signature)) {
        res.status(500).send("Demo wallet signature failed");
        return;
      }
      await finishLogin(provider, req, res, user, config.sessionSecret);
    } catch (err) {
      next(err);    }
  });

  app.post("/interaction/:uid/confirm", parseForm, async (req, res, next) => {
    try {
      const interaction = await provider.interactionDetails(req, res);
      const { prompt, params, session } = interaction;
      const accountId = session?.accountId;
      if (!accountId) {
        res.status(400).send("Not logged in");
        return;
      }

      let { grantId } = interaction;
      const Grant = provider.Grant;
      const grant = grantId
        ? await Grant.find(grantId)
        : new Grant({ accountId, clientId: String(params.client_id) });

      if (!grant) {
        res.status(400).send("Grant missing");
        return;
      }

      const details = prompt.details as {
        missingOIDCScope?: string[];
        missingOIDCClaims?: string[];
        missingResourceScopes?: Record<string, string[]>;
      };
      if (details.missingOIDCScope) {
        grant.addOIDCScope(details.missingOIDCScope.join(" "));
      }
      if (details.missingOIDCClaims) {
        grant.addOIDCClaims(details.missingOIDCClaims);
      }
      if (details.missingResourceScopes) {
        for (const [indicator, scopes] of Object.entries(details.missingResourceScopes)) {
          grant.addResourceScope(indicator, scopes.join(" "));
        }
      }

      grantId = await grant.save();
      await provider.interactionFinished(
        req,
        res,
        { consent: { grantId } },
        { mergeWithLastSubmission: true },
      );
    } catch (err) {
      next(err);
    }
  });

  app.post("/interaction/:uid/abort", parseForm, async (req, res, next) => {
    try {
      await provider.interactionFinished(
        req,
        res,
        {
          error: "access_denied",
          error_description: "End-User aborted interaction",
        },
        { mergeWithLastSubmission: false },
      );
    } catch (err) {
      next(err);
    }
  });
}