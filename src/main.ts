// Entry point. ROLE=all runs the API and the worker in one process; api or worker runs one of them.
import { serve } from "@hono/node-server";
import { createApp } from "./api/app";
import { config } from "./config";
import { migrate } from "./db/migrate";
import { pool } from "./db/pool";
import { errorMessage, log } from "./log";
import { startWorker, stopBoss } from "./research/run";

await migrate();

const server =
  config.ROLE === "worker"
    ? null
    : serve({ fetch: createApp().fetch, port: config.PORT }, (info) => log.info("api listening", { port: info.port }));

if (config.ROLE !== "api") {
  await startWorker();
  log.info("worker started", { queue: "research-run" });
}

let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  log.info("shutting down", { signal });
  try {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await stopBoss();
    await pool.end();
    process.exit(0);
  } catch (err) {
    log.error("shutdown failed", { error: errorMessage(err) });
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
