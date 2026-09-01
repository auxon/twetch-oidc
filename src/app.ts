import "./express-cookies.d.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "cookie";
import express from "express";import type { AppConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { createProvider } from "./oidc/provider.ts";
import { mountConsole } from "./routes/console.ts";
import { mountInteraction } from "./routes/interaction.ts";
import { mountPages } from "./routes/pages.ts";
import { loadOrCreateJwks } from "./seed.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp(db: Db, config: AppConfig) {
  const jwks = await loadOrCreateJwks(db);
  const provider = createProvider(db, config, jwks);
  const app = express();

  app.set("views", path.join(__dirname, "views"));
  app.set("view engine", "ejs");
  app.set("trust proxy", config.isProduction);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "script-src": ["'self'"],
          "form-action": ["'self'", "http:", "https:"],
          "img-src": ["'self'", "data:", "https:"],
          "frame-src": frameSrc,
        },
      },
    }),
  );

  app.use((req, res, next) => {
    req.cookies = parseCookie(req.headers.cookie ?? "");
    const originalCookie = res.cookie.bind(res);
    res.cookie = ((name: string, value: string, options?: express.CookieOptions) => {
      return originalCookie(name, value, options);    }) as typeof res.cookie;
    next();
  });

  app.use("/public", express.static(path.join(__dirname, "public")));

  mountPages(app, db, config);
  mountConsole(app, db, config, twetch);
  mountInteraction(app, provider, db, config, twetch);

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).send(message);
  });

  app.use(provider.callback());

  return { app, provider };}

declare module "http" {
  interface IncomingMessage {
    cookies?: Record<string, string>;
  }
}