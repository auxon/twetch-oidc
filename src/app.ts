import "./express-cookies.d.ts";
import { parseCookie } from "cookie";
import express from "express";
import helmet from "helmet";
import type { AppConfig } from "./config.ts";
import type { Db } from "./db.ts";
import { createProvider } from "./oidc/provider.ts";
import { mountConsole } from "./routes/console.ts";
import { mountInteraction } from "./routes/interaction.ts";
import { mountPages } from "./routes/pages.ts";
import { loadOrCreateJwks } from "./seed.ts";
import { HttpTwetchClient } from "./twetch/client.ts";
import type { TwetchClient } from "./twetch/types.ts";
import { renderView } from "./views/render.ts";

export async function createApp(
  db: Db,
  config: AppConfig,
  options: { twetch?: TwetchClient } = {},
) {
  const jwks = await loadOrCreateJwks(db);
  const twetch =
    options.twetch ??
    (config.live
      ? new HttpTwetchClient({
          authUrl: config.twetch.authUrl,
          apiUrl: config.twetch.apiUrl,
          graphqlUrl: config.twetch.graphqlUrl,
        })
      : undefined);
  const provider = createProvider(db, config, jwks, twetch);
  const app = express();

  app.render = ((name: string, options: Record<string, unknown>, callback: (err: Error | null, html?: string) => void) => {
    try {
      callback(null, renderView(String(name), options ?? {}));
    } catch (err) {
      callback(err as Error);
    }
  }) as typeof app.render;

  // Views render through renderView (see views/render.ts); no template engine.
  app.set("trust proxy", config.isProduction);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "script-src": ["'self'"],
          "form-action": ["'self'", "http:", "https:"],
          "img-src": ["'self'", "data:", "https:"],
          "frame-src": ["'self'", config.twetch.authFrontendUrl],
        },
      },
    }),
  );

  app.use((req, res, next) => {
    req.cookies = parseCookie(req.headers.cookie ?? "") as Record<string, string>;
    const originalRender = res.render.bind(res);
    res.render = ((view: string, options?: object, callback?: (err: Error, html: string) => void) => {
      try {
        const html = renderView(view, (options ?? {}) as Record<string, unknown>);
        if (typeof options === "function") {
          (options as (err: Error | null, html?: string) => void)(null, html);
          return res;
        }
        if (callback) {
          callback(null as unknown as Error, html);
          return res;
        }
        res.type("html").send(html);
        return res;
      } catch (err) {
        if (typeof options === "function") {
          (options as (err: Error) => void)(err as Error);
          return res;
        }
        if (callback) {
          callback(err as Error, "");
          return res;
        }
        next(err);
        return res;
      }
    }) as typeof res.render;
    void originalRender;
    next();
  });

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

  return { app, provider };
}
