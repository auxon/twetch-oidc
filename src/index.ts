import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { seed } from "./seed.ts";
import { createApp } from "./app.ts";

const config = loadConfig();
const db = openDb(config.databasePath);
await seed(db, { live: config.live, seedExampleClient: !config.isProduction });
const { app } = await createApp(db, config);

app.listen(config.port, () => {
  console.log(`Sign in with Twetch listening on ${config.issuer}`);
  console.log(`OIDC discovery: ${config.issuer}/.well-known/openid-configuration`);
  console.log(`Developer console: ${config.issuer}/console`);
  if (config.live) {
    console.log(`Live Twetch auth: ${config.twetch.authUrl}`);
    console.log(`Live Twetch GraphQL: ${config.twetch.graphqlUrl}`);
  } else if (config.demoMode) {
    console.log("Demo login: josh@twetch.example / twetch-demo");
  }
});