import { Sinc } from "@tenonhq/sincronia-types";
import { logger } from "./Logger";

export async function initAllScopesCommand(args: Sinc.SharedCmdArgs) {
  logger.setLogLevel(args.logLevel);
  try {
    // await startWizard();
  } catch (e) {
    logger.error("Error initializing all scopes command: " + e);
    throw e;
  }
}
