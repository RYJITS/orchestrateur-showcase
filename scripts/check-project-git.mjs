import { join, resolve } from "node:path";
import {
  defaultProjectsRoot,
  gitStatus,
  listProjectDirs,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  slugify,
  toPosixPath,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const root = resolve(String(args.root || defaultProjectsRoot));
const diskProjects = await listProjectDirs(root);
const registry = await loadRegistry();
const registryById = new Map((registry.projects || []).map((project) => [project.id, project]));
const results = [];

for (const project of diskProjects) {
  const git = await gitStatus(project.path);
  const id = slugify(project.name);
  const registryProject = registryById.get(id);
  results.push({
    id,
    name: project.name,
    path: toPosixPath(project.path),
    registryStatus: registryProject?.status || "NON_INSCRIT",
    git: {
      hasGit: Boolean(git.hasGit),
      dirty: Boolean(git.dirty),
      status: git.status || "NO_GIT",
      lines: git.lines || []
    }
  });
}

const withGit = results.filter((project) => project.git.hasGit);
const withoutGit = results.filter((project) => !project.git.hasGit);
const dirty = results.filter((project) => project.git.hasGit && project.git.dirty);
const clean = results.filter((project) => project.git.hasGit && !project.git.dirty);
const unregistered = results.filter((project) => project.registryStatus === "NON_INSCRIT");
const summary = {
  total: results.length,
  withGit: withGit.length,
  withoutGit: withoutGit.length,
  dirty: dirty.length,
  clean: clean.length,
  unregistered: unregistered.length
};

const rows = results.map((project) => [
  project.name,
  project.git.hasGit ? "oui" : "non",
  project.git.hasGit ? (project.git.dirty ? "dirty" : "clean") : "no git",
  project.registryStatus,
  project.path
]);

const report = await writeReport(
  "global",
  "project-git-check",
  `# Verification Git des projets

- Date: ${nowIso()}
- Racine: \`${toPosixPath(root)}\`
- Projets scannes: ${summary.total}
- Avec Git: ${summary.withGit}
- Sans Git: ${summary.withoutGit}
- Git dirty: ${summary.dirty}
- Git clean: ${summary.clean}
- Non inscrits au registre: ${summary.unregistered}

## Projets sans Git

${projectList(withoutGit)}

## Projets Git avec changements

${projectList(dirty)}

## Liste complete

${markdownTable(["Projet", "Git", "Etat", "Registre", "Chemin"], rows)}
`,
  {
    generatedAt: nowIso(),
    root: toPosixPath(root),
    summary,
    results
  }
);

console.log(`Verification Git projets: ${summary.total} projet(s).`);
console.log(`Avec Git: ${summary.withGit}`);
console.log(`Sans Git: ${summary.withoutGit}`);
console.log(`Projets sans Git: ${namesForLog(withoutGit)}`);
console.log(`Git dirty: ${summary.dirty}`);
console.log(`Projets dirty: ${namesForLog(dirty)}`);
console.log(`Git clean: ${summary.clean}`);
console.log(`Non inscrits au registre: ${summary.unregistered}`);
console.log(`Non inscrits: ${namesForLog(unregistered)}`);
console.log(`Rapport: ${report.mdPath}`);

function projectList(projects) {
  if (!projects.length) return "Aucun.";
  return markdownTable(
    ["Projet", "Etat", "Chemin"],
    projects.map((project) => [
      project.name,
      project.git.hasGit ? (project.git.dirty ? "dirty" : "clean") : "no git",
      project.path
    ])
  );
}

function namesForLog(projects) {
  if (!projects.length) return "aucun";
  return projects.map((project) => project.name).join(", ");
}
