import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "config", "external-skills.json");
const settingsPath = path.join(root, "config", "settings.template.json");

test("external skills use portable public-repository declarations", async () => {
  const groups = JSON.parse(await readFile(manifestPath, "utf8"));
  const sources = groups.map(({ source }) => source);
  const skills = groups.flatMap((group) => group.skills);

  assert.deepEqual(sources, [...sources].sort());
  assert.equal(new Set(sources).size, sources.length);
  assert.equal(new Set(skills).size, skills.length);
  assert.ok(!sources.includes("backnotprop/plannotator"));
  assert.ok(!sources.includes("railwayapp/railway-skills"));

  for (const group of groups) {
    assert.match(group.source, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.ok(group.skills.length > 0);
    assert.deepEqual(group.skills, [...group.skills].sort());
  }
});

test("Plannotator package keeps its bundled skill disabled", async () => {
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  const plannotator = settings.packages.find((entry) => entry.source === "npm:@plannotator/pi-extension");

  assert.ok(plannotator);
  assert.deepEqual(plannotator.skills, []);
});
