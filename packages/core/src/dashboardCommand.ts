import { Sinc } from "@tenonhq/sincronia-types";
import { setLogLevel } from "./commands";
import { logger } from "./Logger";
import { spawn } from "child_process";

export async function dashboardCommand(args: Sinc.SharedCmdArgs): Promise<void> {
  setLogLevel(args);

  let serverPath: string;
  try {
    serverPath = require.resolve("@tenonhq/sincronia-dashboard/server.js");
  } catch (e) {
    throw new Error(
      "Dashboard package not installed. Run: npm install @tenonhq/sincronia-dashboard",
    );
  }

  logger.info("Starting Update Set Dashboard...");

  const server = spawn("node", [serverPath], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env },
  });

  // Open browser after a short delay
  setTimeout(() => {
    const port = process.env.DASHBOARD_PORT || "3456";
    const url = `http://localhost:${port}`;
    spawn("open", [url]);
  }, 1000);

  server.on("close", (code) => {
    process.exit(code || 0);
  });

  // Forward signals
  process.on("SIGINT", () => {
    server.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    server.kill("SIGTERM");
  });
}
