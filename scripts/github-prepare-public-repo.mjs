import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  copyExistingFilesToBackup,
  gitStatus,
  inferProjectStatus,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  saveRegistry,
  scanProject,
  toPosixPath,
  writeJson,
  writeReport,
  writeText
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const apply = Boolean(args.apply);
const refs = args.project ? await projectsFromArgs(args) : (await loadRegistry()).projects.map((project) => ({ name: project.name, path: project.path }));
const results = [];

for (const ref of refs) {
  const project = await scanProject(ref);
  if (project.name === "99_Archive" && !args.includeArchive) {
    results.push({
      project,
      generatedAt: nowIso(),
      mode: apply ? "apply" : "dry-run",
      status: "ARCHIVE_READ_ONLY",
      blockers: ["archive-only"],
      actions: [],
      git: await gitStatus(project.path),
      reportPath: null,
      skipped: "ARCHIVE_READ_ONLY"
    });
    continue;
  }
  const previous = (await loadRegistry()).projects.find((item) => item.id === project.id) || {};
  const merged = {
    ...previous,
    ...project,
    securityStatus: preserveStatus(previous.securityStatus, project.securityStatus),
    functionalityStatus: preserveStatus(previous.functionalityStatus, project.functionalityStatus),
    publicationStatus: preserveStatus(previous.publicationStatus, project.publicationStatus),
    reports: previous.reports || {},
    links: previous.links || {}
  };
  const result = await prepareProject(merged, apply);
  results.push(result);
}

const registry = await loadRegistry();
for (const result of results) {
  const index = registry.projects.findIndex((project) => project.id === result.project.id);
  const base = index >= 0 ? registry.projects[index] : result.project;
  const reports = { ...(base.reports || {}) };
  if (result.reportPath) reports.githubPrepare = toPosixPath(result.reportPath);
  else delete reports.githubPrepare;
  const next = {
    ...base,
    githubPreparationStatus: result.status,
    reports,
    updatedAt: nowIso()
  };
  next.status = inferProjectStatus(next);
  if (index >= 0) registry.projects[index] = next;
  else registry.projects.push(next);
}
registry.generatedAt = nowIso();
await saveRegistry(registry);

const rows = results.map((result) => [
  result.project.name,
  result.status,
  result.mode,
  result.blockers.join("; ") || "aucun",
  result.actions.join("; ") || "aucune"
]);
const report = await writeReport(
  "github",
  "github-prepare-global",
  `# Preparation GitHub globale

- Date: ${nowIso()}
- Mode: ${apply ? "apply" : "dry-run"}
- Publication: aucune publication ni push

${markdownTable(["Projet", "Statut", "Mode", "Blocages", "Actions"], rows)}
`,
  { generatedAt: nowIso(), mode: apply ? "apply" : "dry-run", results }
);

console.log(`Preparation GitHub terminee: ${results.length} projet(s).`);
console.log(`Rapport global: ${report.mdPath}`);

async function prepareProject(project, shouldApply) {
  const blockers = [];
  const actions = [];
  const git = await gitStatus(project.path);
  const reportPath = join(project.path, "PREPARATION_GITHUB.md");

  if (project.publicationStatus === "ARCHIVE_ONLY") blockers.push("archive-only");
  if (project.publicationStatus === "PRIVATE_INTERNAL") blockers.push("private-internal");
  if (project.securityStatus !== "OK_PUBLIC") blockers.push(`security-${project.securityStatus || "UNKNOWN"}`);
  if (!project.docs?.fiche && !existsSync(join(project.path, "FICHE_PROJET.md"))) actions.push("creer FICHE_PROJET.md");
  if (!project.docs?.installation && !existsSync(join(project.path, "INSTALLATION_FR.md"))) actions.push("creer INSTALLATION_FR.md");
  if (!existsSync(join(project.path, ".env.example"))) actions.push("creer .env.example");
  if (!existsSync(join(project.path, ".gitignore"))) actions.push("creer .gitignore");
  if (!git.hasGit) actions.push("proposer git init local");
  if (git.hasGit && git.dirty) actions.push("revoir changements Git existants avant branche publication");

  const status = blockers.length ? "BLOCKED" : actions.length ? "READY_WITH_ACTIONS" : "READY";
  const result = {
    project,
    generatedAt: nowIso(),
    mode: shouldApply ? "apply" : "dry-run",
    status,
    blockers,
    actions,
    git,
    reportPath
  };

  if (shouldApply && status !== "BLOCKED") {
    await copyExistingFilesToBackup(project, [
      join(project.path, "README_GITHUB_FR.md"),
      join(project.path, ".env.example"),
      join(project.path, ".gitignore"),
      reportPath
    ], "github-prepare");
    await writeText(join(project.path, "README_GITHUB_FR.md"), renderPublicReadme(project));
    await ensureEnvExample(project);
    await ensureGitignore(project);
    result.actions.push("README_GITHUB_FR.md genere");
    result.actions.push(".env.example/.gitignore verifies");
  }

  await writeProjectGithubReport(result);
  return result;
}

async function ensureEnvExample(project) {
  const file = join(project.path, ".env.example");
  if (existsSync(file)) return;
  await writeText(file, `# Variables d'environnement publiques a documenter
# Ne jamais mettre de vraie cle API ici.
`);
}

async function ensureGitignore(project) {
  const file = join(project.path, ".gitignore");
  const required = [".env", ".env.*", "node_modules/", "dist/", "build/", ".next/", ".cache/", "*.log"];
  let current = "";
  if (existsSync(file)) current = await readFile(file, "utf8");
  const missing = required.filter((line) => !current.split(/\r?\n/).includes(line));
  if (!missing.length) return;
  const next = `${current.trim()}\n${current.trim() ? "\n" : ""}# Orchestrateur securite\n${missing.join("\n")}\n`;
  await writeText(file, next);
}

function renderPublicReadme(project) {
  return `# ${displayName(project.name)}

## Presentation
${project.name} est un projet du Cerveau IA prepare pour une diffusion publique controlee.

## Fonctions principales
- Projet reference dans le registre orchestrateur.
- Documentation et audits generes avant publication.
- Publication autorisee uniquement si audit securite OK.

## Technologies utilisees
${(project.stack || ["Projet web"]).map((item) => `- ${item}`).join("\n")}

## Installation
${project.hasPackageJson ? "```powershell\nnpm install\n```" : "Installation manuelle a documenter."}

## Lancement local
${project.scripts?.includes?.("dev") ? "```powershell\nnpm run dev\n```" : "Commande locale a documenter."}

## Securite / variables d'environnement
Les vraies variables doivent rester hors du depot. Utiliser `.env.example` pour documenter les noms attendus.

## Auteur / contexte
Projet maintenu dans le Cerveau IA de Yann.
`;
}

async function writeProjectGithubReport(result) {
  const body = `# Preparation GitHub - ${result.project.name}

- Date: ${result.generatedAt}
- Projet: \`${result.project.path}\`
- Mode: **${result.mode}**
- Statut: **${result.status}**
- Audit securite: ${result.project.securityStatus || "UNKNOWN"}
- Git: ${result.git.hasGit ? result.git.status : "NO_GIT"}

## Blocages
${result.blockers.length ? result.blockers.map((item) => `- ${item}`).join("\n") : "- Aucun blocage publication detecte par la V1."}

## Actions proposees
${result.actions.length ? result.actions.map((item) => `- ${item}`).join("\n") : "- Aucune action requise."}

## Interdictions
- Aucun push automatique.
- Aucun \`git add .\`.
- Aucune publication si audit securite different de \`OK_PUBLIC\`.
`;
  await writeText(result.reportPath, body);
  await writeJson(join(result.project.path, "PREPARATION_GITHUB.json"), {
    generatedAt: result.generatedAt,
    mode: result.mode,
    status: result.status,
    blockers: result.blockers,
    actions: result.actions,
    git: result.git
  });
}

function displayName(name) {
  return String(name).replace(/^\d+_/, "").replace(/_/g, " ").trim();
}

function preserveStatus(previousStatus, nextStatus) {
  if (!previousStatus) return nextStatus;
  if (["UNKNOWN", "KNOWN_REPORT", "NEEDS_DOCUMENTATION"].includes(nextStatus)) return previousStatus;
  return nextStatus;
}
