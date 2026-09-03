import { httpServerHandler } from "cloudflare:node";
import { loadConfig } from "./config.ts";
import { fromD1 } from "./db.ts";
import { seed } from "./seed.ts";
import { createApp } from "./app.ts";

const PORT = 3000;

let handlerPromise: Promise<ReturnType<typeof httpServerHandler>> | undefined;

function applyEnv(workerEnv: Env) {
  const keys = [
    "ISSUER",
    "COOKIE_KEYS",
    "SESSION_SECRET",
    "NODE_ENV",
    "TWETCH_LIVE",
    "TWETCH_DEMO_MODE",
    "TWETCH_AUTH_URL",
    "TWETCH_API_URL",
    "TWETCH_GRAPHQL_URL",
    "TWETCH_AUTH_FRONTEND_URL",
  ] as const;
  for (const key of keys) {
    const value = workerEnv[key as keyof Env];
    if (typeof value === "string" && value.length > 0) {
      (process.env as Record<string, string | undefined>)[key] = value;
    }
  }
}

function start(workerEnv: Env) {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      applyEnv(workerEnv);
      const config = loadConfig({
        issuer: workerEnv.ISSUER || process.env.ISSUER,
        isProduction: true,
      });
      const db = fromD1(workerEnv.DB);
      await seed(db, { live: config.live, seedExampleClient: false });
      const { app } = await createApp(db, config);
      app.listen(PORT);
      return httpServerHandler({ port: PORT });
    })();
  }
  return handlerPromise;
}

export default {
  async fetch(request, workerEnv, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/public/")) {
        const assetPath = url.pathname.slice("/public".length) || "/";
        const assetUrl = new URL(assetPath, url.origin);
        return workerEnv.ASSETS.fetch(new Request(assetUrl, request));
      }
      const handler = await start(workerEnv);
      // ExportedHandler.fetch is optional in the runtime types; the node
      // handler always provides it — fail loudly if that ever changes.
      // (Called with the worker signature; extra args are ignored downstream.)
      const fetchFn = (
        handler as unknown as {
          fetch?: (...args: unknown[]) => Promise<Response>;
        }
      ).fetch;
      if (typeof fetchFn !== "function") {
        throw new Error("node http handler is unavailable");
      }
      return fetchFn.call(handler, request, workerEnv, ctx);
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err);
      console.error(message);
      return new Response(message, { status: 500, headers: { "content-type": "text/plain" } });
    }
  },
} satisfies ExportedHandler<Env>;
