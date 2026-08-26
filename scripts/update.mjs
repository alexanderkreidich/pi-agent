#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const update = spawnSync("pi", ["update", "--extensions"], { stdio: "inherit" });
if (update.status !== 0) process.exit(update.status ?? 1);

const bootstrap = spawnSync(process.execPath, [path.join(root, "scripts", "bootstrap.mjs")], {
  stdio: "inherit",
});
process.exit(bootstrap.status ?? 0);
