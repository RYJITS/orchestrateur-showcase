import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  defaultProjectsRoot,
  execFileText,
  listProjectDirs,
  markdownTable,
  nowIso,
  parseArgs,
  slugify,
  toPosixPath,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const apply = Boolean(args.apply);
const includeArchive = Boolean(args.includeArchive);
const root = resolve(String(args.root || defaultProjectsRoot));
const projects = await listProjectDirs(root);
const results = [];

for (const project of projects) {
  const id = slugify(project.name);
  const isArchive = project.name === "99_Archive";
  const hasGit = existsSync(join(project.path, ".git"));
  const item = {
    id,
    name: project.name,
    path: toPosixPath(project.path),
    hasGit,
    status: "HAS_GIT",
    action: "none",
    error: null
  };

  if (isArchive && !includeArchive) {
    item.status = "SKIPPED_ARCHIVE";
    item.action = "skip";
    results.push(item);
    continue;
  }

  if (!hasGit && !apply) {
    item.status = "WOULD_INIT";
    item.action = "git init";
    results.push(item);
    continue;
  }

  if (!hasGit && apply) {
    item.action = "git init";
    try {
      await execFileText("git", ["-C", project.path, "init"], 15000);
      item.status = "INIT_DONE";
      item.hasGit = true;
    } catch (error) {
      item.status = "INIT_ERROR";
      item.error = error.message;
    }
  }

  results.push(item);
}

const summary = {
  total: results.length,
  alreadyWithGit: results.filter((item) => item.status === "HAS_GIT").length,
  wouldInit: results.filter((item) => item.status === "WOULD_INIT").length,
  initialized: results.filter((item) => item.status === "INIT_DONE").length,
  errors: results.filter((item) => item.status === "INIT_ERROR").length,
  skipped: results.filter((item) => item.status === "SKIPPED_ARCHIVE").length
};

const report = await writeReport(
  "global",
  "ensure-project-git",
  `# Initialisation Git des projets

- Date: ${nowIso()}
- Mode: **${apply ? "apply" : "dry-run"}**
- Racine: \`${toPosixPath(root)}\`
- Projets scannes: ${summary.total}
- Deja avec Git: ${summary.alreadyWithGit}
- Git a creer: ${summary.wouldInit}
- Git initialises: ${summary.initialized}
- Erreurs: ${summary.errors}
- Archives ignorees: ${summary.skipped}

${markdownTable(["Projet", "Git", "Statut", "Action", "Erreur", "Chemin"], results.map((item) => [
  item.name,
  item.hasGit ? "oui" : "non",
  item.status,
  item.action,
  item.error || "",
  item.path
]))}
`,
  {
    generatedAt: nowIso(),
    mode: apply ? "apply" : "dry-run",
    root: toPosixPath(root),
    summary,
    results
  }
);

console.log(`Verification/creation Git: ${summary.total} projet(s).`);
console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
console.log(`Deja avec Git: ${summary.alreadyWithGit}`);
console.log(`Git a creer: ${summary.wouldInit}`);
console.log(`Git initialises: ${summary.initialized}`);
console.log(`Erreurs: ${summary.errors}`);
console.log(`Rapport: ${report.mdPath}`);

if (summary.errors) process.exitCode = 1;
