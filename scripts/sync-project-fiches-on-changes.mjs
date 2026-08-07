import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  defaultProjectsRoot,
  defaultSiteRoot,
  execFileText,
  listProjectDirs,
  markdownTable,
  nowIso,
  parseArgs,
  scanProject,
  scriptsDir,
  toPosixPath,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const apply = Boolean(args.apply);
const includeArchive = Boolean(args.includeArchive);
const root = resolve(String(args.root || defaultProjectsRoot));
const siteRoot = resolve(String(args.site || defaultSiteRoot));
const projects = await listProjectDirs(root);
const results = [];

for (const ref of projects) {
  const isArchive = ref.name === "99_Archive";
  if (isArchive && !includeArchive) {
    results.push({
      id: "99-archive",
      name: ref.name,
      path: toPosixPath(ref.path),
      gitDirty: false,
      projectFiche: false,
      siteFiche: false,
      needsSync: false,
      status: "SKIPPED_ARCHIVE",
      action: "skip",
      error: null
    });
    continue;
  }

  const project = await scanProject(ref);
  const projectFichePath = join(project.path, "FICHE_PROJET.md");
  const siteFichePath = join(siteRoot, "public", "orchestrator", "fiches", `${project.id}.md`);
  const gitDirty = Boolean(project.git?.hasGit && project.git?.dirty);
  const hasProjectFiche = existsSync(projectFichePath);
  const hasSiteFiche = existsSync(siteFichePath);
  const needsSync = gitDirty || !hasProjectFiche || !hasSiteFiche;
  results.push({
    id: project.id,
    name: project.name,
    path: toPosixPath(project.path),
    gitDirty,
    projectFiche: hasProjectFiche,
    siteFiche: hasSiteFiche,
    needsSync,
    status: needsSync ? "NEEDS_SYNC" : "UP_TO_DATE",
    action: needsSync ? (apply ? "update-fiche-and-site" : "would-update-fiche-and-site") : "none",
    error: null
  });
}

if (apply) {
  for (const item of results.filter((entry) => entry.needsSync)) {
    try {
      await execFileText(process.execPath, [join(scriptsDir, "update-project-fiches.mjs"), "--project", item.path], 120000);
      item.status = "FICHE_UPDATED";
    } catch (error) {
      item.status = "FICHE_ERROR";
      item.error = error.message;
    }
  }

  const hasUpdatedFiches = results.some((item) => item.status === "FICHE_UPDATED");
  if (hasUpdatedFiches) {
    try {
      await execFileText(process.execPath, [join(scriptsDir, "update-site-ma-methode-projects.mjs"), "--site", siteRoot], 120000);
      for (const item of results.filter((entry) => entry.status === "FICHE_UPDATED")) {
        item.status = "SITE_SYNCED";
      }
    } catch (error) {
      for (const item of results.filter((entry) => entry.status === "FICHE_UPDATED")) {
        item.status = "SITE_SYNC_ERROR";
        item.error = error.message;
      }
    }
  }
}

const summary = {
  total: results.length,
  dirty: results.filter((item) => item.gitDirty).length,
  missingProjectFiche: results.filter((item) => !item.projectFiche && item.status !== "SKIPPED_ARCHIVE").length,
  missingSiteFiche: results.filter((item) => !item.siteFiche && item.status !== "SKIPPED_ARCHIVE").length,
  needsSync: results.filter((item) => item.needsSync).length,
  applied: results.filter((item) => item.status === "SITE_SYNCED").length,
  errors: results.filter((item) => /ERROR/.test(item.status)).length
};

const report = await writeReport(
  "site",
  "sync-project-fiches-on-changes",
  `# Synchronisation conditionnelle des fiches

- Date: ${nowIso()}
- Mode: **${apply ? "apply" : "dry-run"}**
- Racine projets: \`${toPosixPath(root)}\`
- Site Ma Methode: \`${toPosixPath(siteRoot)}\`
- Projets scannes: ${summary.total}
- Projets Git dirty: ${summary.dirty}
- Fiches projet manquantes: ${summary.missingProjectFiche}
- Fiches site manquantes: ${summary.missingSiteFiche}
- Projets a synchroniser: ${summary.needsSync}
- Projets appliques: ${summary.applied}
- Erreurs: ${summary.errors}

${markdownTable(["Projet", "Git dirty", "Fiche projet", "Fiche site", "Statut", "Action", "Erreur"], results.map((item) => [
  item.name,
  item.gitDirty ? "oui" : "non",
  item.projectFiche ? "oui" : "non",
  item.siteFiche ? "oui" : "non",
  item.status,
  item.action,
  item.error || ""
]))}
`,
  {
    generatedAt: nowIso(),
    mode: apply ? "apply" : "dry-run",
    root: toPosixPath(root),
    siteRoot: toPosixPath(siteRoot),
    summary,
    results
  }
);

console.log(`Synchronisation fiches conditionnelle: ${summary.total} projet(s).`);
console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
console.log(`Git dirty: ${summary.dirty}`);
console.log(`Fiches projet manquantes: ${summary.missingProjectFiche}`);
console.log(`Fiches site manquantes: ${summary.missingSiteFiche}`);
console.log(`Projets a synchroniser: ${summary.needsSync}`);
console.log(`Projets appliques: ${summary.applied}`);
console.log(`Erreurs: ${summary.errors}`);
console.log(`Rapport: ${report.mdPath}`);

if (summary.errors) process.exitCode = 1;
