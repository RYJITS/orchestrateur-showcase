import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  defaultProjectsRoot,
  ensureDir,
  listProjectDirs,
  loadRegistry,
  markdownTable,
  nowIso,
  orchestratorRoot,
  parseArgs,
  readJson,
  scanProject,
  stamp,
  toPosixPath,
  writeJson,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const apply = Boolean(args.apply);
const root = resolve(String(args.root || defaultProjectsRoot));
const inventoryRoot = join(orchestratorRoot, "archives", "project-inventory");
const latestPath = join(orchestratorRoot, "config", "projects.inventory.latest.json");
const generatedAt = nowIso();
const currentProjects = [];

const projectDirs = await listProjectDirs(root);
for (const projectDir of projectDirs) {
  const scanned = await scanProject(projectDir);
  const info = await stat(projectDir.path).catch(() => null);
  currentProjects.push({
    id: scanned.id,
    name: scanned.name,
    path: toPosixPath(scanned.path),
    relativePath: toPosixPath(scanned.relativePath),
    category: scanned.category,
    status: scanned.status,
    securityStatus: scanned.securityStatus,
    functionalityStatus: scanned.functionalityStatus,
    publicationStatus: scanned.publicationStatus,
    packageName: scanned.packageName,
    stack: scanned.stack,
    scripts: scanned.scripts,
    git: {
      hasGit: Boolean(scanned.git?.hasGit),
      dirty: Boolean(scanned.git?.dirty),
      status: scanned.git?.status || "NO_GIT"
    },
    fileSummary: scanned.fileSummary,
    directoryMtime: info?.mtime?.toISOString?.() || null,
    scannedAt: generatedAt
  });
}

const previous = await loadPreviousInventory();
const registry = await loadRegistry();
const diff = compareInventories(previous?.projects || [], currentProjects, registry.projects || []);
const inventory = {
  version: "1.0.0",
  generatedAt,
  mode: apply ? "apply" : "dry-run",
  root: toPosixPath(root),
  previousSource: previous?.source || null,
  summary: {
    total: currentProjects.length,
    previousTotal: previous?.projects?.length || 0,
    newProjects: diff.newProjects.length,
    removedProjects: diff.removedProjects.length,
    movedProjects: diff.movedProjects.length,
    unregisteredProjects: diff.unregisteredProjects.length,
    archiveOnlyProjects: currentProjects.filter((project) => project.category === "archive" || /ARCHIVE/.test(project.status)).length
  },
  projects: currentProjects,
  diff
};

let archivePath = null;
if (apply) {
  await ensureDir(inventoryRoot);
  archivePath = join(inventoryRoot, `${stamp()}-projects.json`);
  await writeJson(archivePath, inventory);
  await writeJson(latestPath, {
    ...inventory,
    latestArchivePath: toPosixPath(archivePath)
  });
}

const markdown = renderMarkdown(inventory, archivePath);
const report = await writeReport("global", "project-inventory", markdown, inventory);

console.log(`Inventaire projets: ${inventory.summary.total} projet(s).`);
console.log(`Mode: ${inventory.mode}`);
console.log(`Base de reference mise a jour: ${apply ? "oui" : "non (dry-run)"}`);
console.log(`Nouveaux: ${inventory.summary.newProjects}`);
console.log(`Nouveaux projets: ${namesForLog(diff.newProjects)}`);
console.log(`Disparus: ${inventory.summary.removedProjects}`);
console.log(`Projets absents: ${namesForLog(diff.removedProjects)}`);
console.log(`Deplaces: ${inventory.summary.movedProjects}`);
console.log(`Projets deplaces: ${namesForLog(diff.movedProjects)}`);
console.log(`Non inscrits au registre: ${inventory.summary.unregisteredProjects}`);
console.log(`Non inscrits: ${namesForLog(diff.unregisteredProjects)}`);
if (archivePath) console.log(`Archive: ${archivePath}`);
else console.log("Archive: non ecrite (relancer avec --apply)");
console.log(`Rapport: ${report.mdPath}`);

async function loadPreviousInventory() {
  const latest = await readJson(latestPath, null);
  if (latest?.projects) return { ...latest, source: toPosixPath(latestPath) };
  const latestArchive = await findLatestArchive();
  if (latestArchive) {
    const payload = await readJson(latestArchive, null);
    if (payload?.projects) return { ...payload, source: toPosixPath(latestArchive) };
  }
  return null;
}

async function findLatestArchive() {
  if (!existsSync(inventoryRoot)) return null;
  const entries = await readdir(inventoryRoot, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("-projects.json"))
    .map((entry) => join(inventoryRoot, entry.name))
    .sort((a, b) => b.localeCompare(a));
  return files[0] || null;
}

function compareInventories(previousProjects, currentProjectsList, registryProjects) {
  if (!previousProjects.length) {
    const registryById = new Map(registryProjects.map((project) => [project.id, project]));
    return {
      baseline: true,
      newProjects: [],
      removedProjects: [],
      movedProjects: [],
      unregisteredProjects: currentProjectsList
        .filter((project) => !registryById.has(project.id))
        .map(summaryProject)
    };
  }

  const previousById = new Map(previousProjects.map((project) => [project.id, project]));
  const currentById = new Map(currentProjectsList.map((project) => [project.id, project]));
  const registryById = new Map(registryProjects.map((project) => [project.id, project]));
  const newProjects = currentProjectsList
    .filter((project) => !previousById.has(project.id))
    .map(summaryProject);
  const removedProjects = previousProjects
    .filter((project) => !currentById.has(project.id))
    .map(summaryProject);
  const movedProjects = currentProjectsList
    .filter((project) => previousById.has(project.id) && normalizePath(previousById.get(project.id).path) !== normalizePath(project.path))
    .map((project) => ({
      ...summaryProject(project),
      previousPath: previousById.get(project.id).path
    }));
  const unregisteredProjects = currentProjectsList
    .filter((project) => !registryById.has(project.id))
    .map(summaryProject);

  return {
    baseline: false,
    newProjects,
    removedProjects,
    movedProjects,
    unregisteredProjects
  };
}

function summaryProject(project) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    status: project.status || "UNKNOWN",
    securityStatus: project.securityStatus || "UNKNOWN"
  };
}

function normalizePath(value) {
  return toPosixPath(value || "").toLowerCase();
}

function renderMarkdown(inventoryData, archivePathValue) {
  const summary = inventoryData.summary;
  const rows = inventoryData.projects.map((project) => [
    project.name,
    project.status,
    project.securityStatus,
    project.git.hasGit ? (project.git.dirty ? "git dirty" : "git ok") : "no git",
    project.stack.join(", "),
    project.path
  ]);
  return `# Inventaire projets

- Date: ${inventoryData.generatedAt}
- Mode: **${inventoryData.mode}**
- Racine: \`${inventoryData.root}\`
- Projets detectes: ${summary.total}
- Source precedente: ${inventoryData.previousSource ? `\`${inventoryData.previousSource}\`` : "aucune, base initiale"}
- Archive ecrite: ${archivePathValue ? `\`${toPosixPath(archivePathValue)}\`` : "non, dry-run"}

## Changements detectes

- Nouveaux projets: ${summary.newProjects}
- Projets absents depuis le dernier inventaire: ${summary.removedProjects}
- Projets deplaces: ${summary.movedProjects}
- Projets non inscrits au registre: ${summary.unregisteredProjects}
- Projets archive-only: ${summary.archiveOnlyProjects}

${sectionList("Nouveaux projets", inventoryData.diff.newProjects)}

${sectionList("Projets absents", inventoryData.diff.removedProjects)}

${sectionList("Projets deplaces", inventoryData.diff.movedProjects, true)}

${sectionList("Non inscrits au registre", inventoryData.diff.unregisteredProjects)}

## Liste actuelle

${markdownTable(["Projet", "Statut", "Securite", "Git", "Stack", "Chemin"], rows)}
`;
}

function sectionList(title, items, includePreviousPath = false) {
  if (!items.length) return `## ${title}\n\nAucun.`;
  const rows = items.map((item) => [
    item.name,
    item.status,
    item.securityStatus,
    item.path,
    includePreviousPath ? item.previousPath || "-" : "-"
  ]);
  return `## ${title}

${markdownTable(["Projet", "Statut", "Securite", "Chemin actuel", "Chemin precedent"], rows)}`;
}

function namesForLog(items) {
  if (!items.length) return "aucun";
  return items.map((item) => item.name).join(", ");
}
