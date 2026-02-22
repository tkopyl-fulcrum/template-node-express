import { otlpShutdown } from "./telemetry";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import gracefulShutdown from "http-graceful-shutdown";
import { initApp } from "./app";
import { Env, initConfig } from "./config";
import { initLogging } from "./logging";
import { Client as PgClient } from "pg";
import { createClient as createRedisClient } from "redis";

const main = async () => {
  const config = await initConfig();
  const logger = await initLogging(config);
  const app = await initApp(config, logger);

  // ✅ Wrapper над requestListener: додаємо прості ендпоїнти без Express
  const requestListener = (req: IncomingMessage, res: ServerResponse) => {
    // Врахуй, що url може містити query (?a=b)
    const url = req.url?.split("?")[0] ?? "";

  const pg = new PgClient({ connectionString: process.env.DATABASE_URL });
    await pg.connect();

  const redis = createRedisClient({ url: process.env.REDIS_URL });
    redis.on("error", (err) => logger.error({ err }, "Redis client error"));
    await redis.connect();  

    if (req.method === "GET" && url === "/") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("OK");
      return;
    }

    if (req.method === "GET" && url === "/health") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "GET" && url === "/db") {
  try {
    await pg.query("SELECT 1 AS ok");
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ db: "ok" }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ db: "fail" }));
  }
  return;
}

if (req.method === "GET" && url === "/redis") {
  try {
    const pong = await redis.ping();
    res.statusCode = pong === "PONG" ? 200 : 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ redis: pong }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ redis: "fail" }));
  }
  return;
}
    // все інше віддаємо основному app
    return app.requestListener(req, res);
  };

  const server = createServer(requestListener).listen(config.port, () =>
    logger.info(`HTTP server listening on port ${config.port}`)
  );

  gracefulShutdown(server, {
    timeout: config.shutdownTimeoutMs,
    development: config.env !== Env.Prod,
    preShutdown: async (signal) => {
      logger.info({ signal }, "Shutdown signal received");
    },
    onShutdown: async () => {
      await app.shutdown();
      await otlpShutdown();
      await redis.quit().catch(() => {});
      await pg.end().catch(() => {});
    },
    
    finally: () => {
      logger.info("Shutdown complete");
    },
  });
};

main();
