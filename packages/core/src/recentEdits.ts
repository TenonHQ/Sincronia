import * as fs from "fs";
import * as path from "path";
import { Sinc } from "@tenonhq/sincronia-types";

const MAX_ENTRIES = 5;

function getFilePath(): string {
  return path.resolve(process.cwd(), ".sinc-recent-edits.json");
}

export function writeRecentEdit(context: Sinc.FileContext): void {
  var filePath = getFilePath();
  var edits: any[] = [];
  try {
    if (fs.existsSync(filePath)) {
      edits = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (e) {
    edits = [];
  }

  edits.unshift({
    tableName: context.tableName,
    name: context.name,
    targetField: context.targetField,
    sys_id: context.sys_id,
    scope: context.scope,
    timestamp: new Date().toISOString(),
  });

  if (edits.length > MAX_ENTRIES) {
    edits = edits.slice(0, MAX_ENTRIES);
  }

  fs.writeFileSync(filePath, JSON.stringify(edits, null, 2));
}
