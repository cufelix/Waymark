// Local Postgres for development and tests, from npm binaries (no Docker needed).
// Same port and credentials as docker-compose.yml. Stops on Ctrl+C.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { log } from "../log";

const dataDir = "./data/pg";
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "research", password: "research", port: 5433, persistent: true });

const fresh = !existsSync(`${dataDir}/PG_VERSION`);
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("research");
log.info("local postgres running", { port: 5433, dataDir });

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
