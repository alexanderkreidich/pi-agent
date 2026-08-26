#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const groups = JSON.parse(await readFile(path.join(root, "config", "external-skills.json"), "utf8"));

for (const group of groups) {
  console.log(`Installing public skills from ${group.source}: ${group.skills.join(", ")}`);
  const result = spawnSync(
    "npx",
    [
      "--yes",
      "skills",
      "add",
      group.source,
      "--global",
      "--agent",
      "codex",
      "--skill",
      ...group.skills,
      "--yes",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(`Failed to install skills from ${group.source}`);
    process.exit(result.status ?? 1);
  }
}
