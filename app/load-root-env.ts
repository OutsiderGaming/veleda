// Reads the repo-root .env (shared with the scripts) into process.env, without
// overriding anything already set. Used by next.config.ts and server code;
// Next itself only loads .env files from the app directory.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadRootEnv(): void {
  const file = path.resolve(process.cwd(), "..", ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined || process.env[m[1]] === "") process.env[m[1]] = value;
  }
}
