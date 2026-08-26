#!/usr/bin/env node

import { cp, lstat, mkdir, readFile, readlink, rename, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
const sharedAgentDir = path.join(os.homedir(), ".agents");
const dryRun = process.argv.includes("--dry-run");
const installExternalSkills = process.argv.includes("--install-external-skills");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.join(agentDir, "backups", `pi-agent-${stamp}`);
let createdBackup = false;

const retiredAgentPaths = [
  "prompts/is.md",
  "prompts/wr.md",
  "extensions/bookmark.ts",
  "extensions/brave-web",
  "extensions/confirm-destructive.ts",
  "extensions/github-issue-autocomplete.ts",
  "extensions/handoff.ts",
  "extensions/notify.ts",
  "extensions/pi-diff-viewer",
  "extensions/preset.ts",
  "extensions/prompt-url-widget.ts",
  "extensions/protected-paths.ts",
  "extensions/qna.ts",
  "extensions/redraws.ts",
  "extensions/rtk.ts",
  "extensions/session-name.ts",
  "extensions/subagent",
  "extensions/tools.ts",
  "extensions/tps.ts",
  "extensions/zz-git-branch-editor-label.ts",
  "themes/black-metal-bathory-gray-input.json",
  "themes/ghostty-amber.json",
  "themes/ghostty-codex.json",
];

const managedLinks = [
  ["AGENTS.md", "AGENTS.md"],
  ["agents/codex-worker.md", "agents/codex-worker.md"],
  ["agents/fable-planner.md", "agents/fable-planner.md"],
  ["agents/gpt-sol-independent-review.md", "agents/gpt-sol-independent-review.md"],
  ["prompts/pr.md", "prompts/pr.md"],
  ["extensions/pi-claude-code-use.json", "config/extensions/pi-claude-code-use.json"],
  ["extensions/pi-rtk-optimizer/config.json", "config/extensions/pi-rtk-optimizer/config.json"],
];

async function exists(target) {
  return lstat(target).then(() => true, () => false);
}

function log(message) {
  console.log(`${dryRun ? "[dry-run] " : ""}${message}`);
}

async function ensureBackupRoot() {
  if (createdBackup || dryRun) return;
  await mkdir(backupRoot, { recursive: true });
  createdBackup = true;
}

async function backup(target, relativeBackupPath) {
  if (!(await exists(target))) return false;
  const destination = path.join(backupRoot, relativeBackupPath);
  log(`Back up ${target} -> ${destination}`);
  if (!dryRun) {
    await ensureBackupRoot();
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(target, destination);
  }
  return true;
}

async function sameLink(destination, source) {
  try {
    const current = await readlink(destination);
    return path.resolve(path.dirname(destination), current) === path.resolve(source);
  } catch {
    return false;
  }
}

async function linkManaged(relativeDestination, relativeSource) {
  const destination = path.join(agentDir, relativeDestination);
  const source = path.join(root, relativeSource);
  if (!(await exists(source))) throw new Error(`Missing managed source: ${source}`);
  if (await sameLink(destination, source)) return;

  await backup(destination, path.join("agent", relativeDestination));
  log(`Link ${destination} -> ${source}`);
  if (!dryRun) {
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(source, destination);
  }
}

function packageIdentity(entry) {
  const source = typeof entry === "string" ? entry : entry?.source;
  if (typeof source !== "string") return JSON.stringify(entry);
  if (source.startsWith("npm:")) return source.replace(/@[^/@]+$/, "");
  if (source.startsWith("git:")) return source.replace(/@[^/]+$/, "");
  return source;
}

function mergeObjects(current, desired) {
  const result = { ...current };
  for (const [key, value] of Object.entries(desired)) {
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      current?.[key] && typeof current[key] === "object" && !Array.isArray(current[key])
    ) {
      result[key] = mergeObjects(current[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function mergeSettings() {
  const settingsPath = path.join(agentDir, "settings.json");
  const template = JSON.parse(await readFile(path.join(root, "config", "settings.template.json"), "utf8"));
  const current = await readFile(settingsPath, "utf8").then(JSON.parse, () => ({}));
  const desiredByIdentity = new Map(template.packages.map((entry) => [packageIdentity(entry), entry]));
  const packages = [];
  const seen = new Set();

  for (const entry of current.packages ?? []) {
    const identity = packageIdentity(entry);
    packages.push(desiredByIdentity.get(identity) ?? entry);
    seen.add(identity);
  }
  for (const entry of template.packages) {
    const identity = packageIdentity(entry);
    if (!seen.has(identity)) packages.push(entry);
  }

  const merged = mergeObjects(current, { ...template, packages });
  const next = `${JSON.stringify(merged, null, 2)}\n`;
  const previous = await readFile(settingsPath, "utf8").catch(() => "");
  if (previous === next) return;

  if (await exists(settingsPath)) {
    const backupPath = path.join(backupRoot, "agent", "settings.json");
    log(`Back up ${settingsPath} -> ${backupPath}`);
    if (!dryRun) {
      await ensureBackupRoot();
      await mkdir(path.dirname(backupPath), { recursive: true });
      await cp(settingsPath, backupPath);
    }
  }
  log(`Merge sanitized settings into ${settingsPath}`);
  if (!dryRun) {
    await mkdir(agentDir, { recursive: true });
    await writeFile(settingsPath, next, { mode: 0o600 });
  }
}

async function main() {
  for (const relative of retiredAgentPaths) {
    await backup(path.join(agentDir, relative), path.join("agent", relative));
  }
  await backup(
    path.join(sharedAgentDir, "skills", "request-refactor-plan"),
    path.join("shared-agent", "skills", "request-refactor-plan"),
  );

  for (const [destination, source] of managedLinks) {
    await linkManaged(destination, source);
  }
  await mergeSettings();

  if (installExternalSkills && !dryRun) {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "install-external-skills.mjs")], {
      stdio: "inherit",
    });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }

  if (createdBackup) console.log(`Local backup: ${backupRoot}`);
  console.log("Bootstrap complete. Run /reload in active Pi sessions.");
}

await main();
