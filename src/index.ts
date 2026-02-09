import { otlpShutdown } from "./telemetry";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import gracefulShutdown from "http-graceful-shutdown";
import { initApp } from "./app";
import { Env, initConfig } from "./config";
import { initLogging } from "./logging";

const main = async () => {
  const config = await initConfig();
  const logger = await initLogging(config);
  const app = await initApp(config, logger);

  // ✅ Wrapper над requestListener: додаємо прості ендпоїнти без Express
  const requestListener = (req: IncomingMessage, res: ServerResponse) => {
    // Врахуй, що url може містити query (?a=b)
    const url = req.url?.split("?")[0] ?? "";

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
    },
    finally: () => {
      logger.info("Shutdown complete");
    },
  });
};

main();
