import type { Express } from "express";
import type { AppConfig } from "../config.ts";
import type { Db } from "../db.ts";
import { readSessionUser } from "../auth/session.ts";

export function mountPages(app: Express, db: Db, config: AppConfig) {
  app.get("/", async (req, res) => {
    const user = await readSessionUser(req, db, config.sessionSecret);
    res.render("home", {
      issuer: config.issuer,
      user,
      demoMode: config.demoMode && !config.live,
      live: config.live,
      authUrl: config.twetch.authUrl,
    });

  app.get("/docs", async (req, res) => {
    const user = await readSessionUser(req, db, config.sessionSecret);
    res.render("docs", {
      issuer: config.issuer,
      user,
      live: config.live,
      authUrl: config.twetch.authUrl,
    });
  });

  app.get("/.well-known/twetch-configuration", (_req, res) => {    res.json({
      issuer: config.issuer,      provider: "twetch",
      brand: "Sign in with Twetch",
      scopes_supported: ["openid", "profile", "email", "offline_access"],
      claims_supported: [
        "sub",
        "name",
        "preferred_username",
        "picture",
        "profile",
        "updated_at",
        "email",
        "email_verified",
        "twetch_pubkey",
      ],
      subject: "Twetch user id. Stable across signing-key rotation.",
      live: config.live,
      twetch_auth: config.live ? config.twetch.authUrl : null,
    });
  });
}