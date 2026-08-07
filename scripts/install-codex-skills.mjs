import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  ensureDir,
  markdownTable,
  nowIso,
  orchestratorRoot,
  parseArgs,
  readJson,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const config = await readJson(join(orchestratorRoot, "config", "codex-runtime-targets.json"), {});
const sourceRoot = join(orchestratorRoot, "skills-src");
const targets = [...(config.globalTargets || []), ...(config.projectTargets || [])];
const skills = (await readdir(sourceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const results = [];

for (const targetRaw of targets) {
  const target = resolve(targetRaw);
  if (!existsSync(target)) {
    results.push({ target, skill: "*", status: "SKIPPED_TARGET_MISSING" });
    continue;
  }
  for (const skill of skills) {
    const source = join(sourceRoot, skill);
    const destination = join(target, skill);
    const skillFile = join(source, "SKILL.md");
    if (!existsSync(skillFile)) {
      results.push({ target, skill, status: "SKIPPED_NO_SKILL_MD" });
      continue;
    }
    const sourceManifest = await skillManifest(source);
    if (args.checkOnly) {
      const destinationManifest = existsSync(join(destination, "SKILL.md"))
        ? await skillManifest(destination)
        : null;
      const status = compareManifests(sourceManifest, destinationManifest);
      results.push({
        target,
        skill,
        status,
        sourceFiles: sourceManifest.length,
        destinationFiles: destinationManifest?.length || 0
      });
      continue;
    }
    await ensureDir(destination);
    await cp(source, destination, { recursive: true });
    const destinationManifest = existsSync(join(destination, "SKILL.md"))
      ? await skillManifest(destination)
      : null;
    results.push({
      target,
      skill,
      status: compareManifests(sourceManifest, destinationManifest) === "PRESENT" ? "INSTALLED" : "FAILED",
      sourceFiles: sourceManifest.length,
      destinationFiles: destinationManifest?.length || 0
    });
  }
}

const report = await writeReport(
  "global",
  "codex-skills-install",
  `# Installation skills Codex

- Date: ${nowIso()}
- Mode: ${args.checkOnly ? "check-only" : "copy-from-source-master"}

${markdownTable(["Target", "Skill", "Statut", "Source", "Runtime"], results.map((item) => [item.target, item.skill, item.status, item.sourceFiles ?? "-", item.destinationFiles ?? "-"]))}
`,
  { generatedAt: nowIso(), mode: args.checkOnly ? "check-only" : "install", results }
);

console.log(`Skills traites: ${results.length}`);
console.log(`Rapport: ${report.mdPath}`);
if (args.checkOnly && results.some((item) => ["MISSING", "STALE", "FAILED"].includes(item.status))) process.exitCode = 1;
if (!args.checkOnly && results.some((item) => item.status === "FAILED")) process.exitCode = 1;

async function skillManifest(root) {
  const files = [];

  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const data = await readFile(fullPath);
      files.push({
        path: relative(root, fullPath).replace(/\\/g, "/"),
        hash: createHash("sha256").update(data).digest("hex")
      });
    }
  }

  await visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function compareManifests(sourceManifest, destinationManifest) {
  if (!destinationManifest) return "MISSING";
  const sourceMap = new Map(sourceManifest.map((item) => [item.path, item.hash]));
  const destinationMap = new Map(destinationManifest.map((item) => [item.path, item.hash]));
  for (const [path, hash] of sourceMap) {
    if (!destinationMap.has(path)) return "MISSING";
    if (destinationMap.get(path) !== hash) return "STALE";
  }
  return "PRESENT";
}
