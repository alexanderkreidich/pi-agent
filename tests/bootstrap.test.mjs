import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("bootstrap migrates only allowlisted resources", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-config-bootstrap-"));
  const agentDir = path.join(home, ".pi", "agent");
  const excludedName = ["her", "dr-local.ts"].join("");

  try {
    await mkdir(path.join(agentDir, "prompts"), { recursive: true });
    await mkdir(path.join(agentDir, "extensions"), { recursive: true });
    await writeFile(path.join(agentDir, "AGENTS.md"), "old instructions\n");
    await writeFile(path.join(agentDir, "prompts", "is.md"), "old prompt\n");
    await writeFile(path.join(agentDir, "extensions", excludedName), "preserve me\n");
    await writeFile(
      path.join(agentDir, "settings.json"),
      `${JSON.stringify({ packages: ["npm:local-only"], localPreference: true }, null, 2)}\n`,
    );

    const result = spawnSync(process.execPath, [path.join(root, "scripts", "bootstrap.mjs")], {
      env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agentDir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    assert.equal(await readFile(path.join(agentDir, "extensions", excludedName), "utf8"), "preserve me\n");
    assert.equal((await lstat(path.join(agentDir, "AGENTS.md"))).isSymbolicLink(), true);
    assert.equal(path.resolve(await readlink(path.join(agentDir, "AGENTS.md"))), path.join(root, "AGENTS.md"));
    assert.equal((await lstat(path.join(agentDir, "prompts", "pr.md"))).isSymbolicLink(), true);

    const settings = JSON.parse(await readFile(path.join(agentDir, "settings.json"), "utf8"));
    assert.equal(settings.localPreference, true);
    assert.ok(settings.packages.includes("npm:local-only"));
    assert.ok(settings.packages.includes("npm:pi-simplify"));

    const backups = await import("node:fs/promises").then(({ readdir }) => readdir(path.join(agentDir, "backups")));
    assert.equal(backups.length, 1);
    assert.equal(
      await readFile(path.join(agentDir, "backups", backups[0], "agent", "prompts", "is.md"), "utf8"),
      "old prompt\n",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
