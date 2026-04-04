import chokidar from "chokidar";
import { logFilePush } from "./logMessages";
import { logger } from "./Logger";
import { debounce } from "lodash";
import { getFileContextFromPath } from "./FileUtils";
import { Sinc } from "@tenonhq/sincronia-types";
import { groupAppFiles, pushFiles } from "./appUtils";
import { writeRecentEdit } from "./recentEdits";
const DEBOUNCE_MS = 300;
let pushQueue: string[] = [];
let watcher: chokidar.FSWatcher | undefined = undefined;

const processQueue = debounce(async () => {
  if (pushQueue.length > 0) {
    //dedupe pushes
    const toProcess = Array.from(new Set([...pushQueue]));
    pushQueue = [];
    const fileContexts = toProcess
      .map(getFileContextFromPath)
      .filter((ctx): ctx is Sinc.FileContext => !!ctx);
    const buildables = groupAppFiles(fileContexts);
    const updateResults = await pushFiles(buildables);
    updateResults.forEach((res, index) => {
      logFilePush(fileContexts[index], res);
      if (res.success) {
        writeRecentEdit(fileContexts[index]);
      }
    });
  }
}, DEBOUNCE_MS);

export function startWatching(directory: string) {
  watcher = chokidar.watch(directory);
  watcher.on("change", fileChanged);
  watcher.on("error", (error: Error) => {
    logger.error(`Watcher error: ${error.message}`);
  });
}

async function fileChanged(path: string) {
  pushQueue.push(path);
  processQueue();
}

export function stopWatching() {
  if (watcher) {
    watcher.close();
  }
}
