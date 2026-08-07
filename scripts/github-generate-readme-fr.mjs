import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  copyExistingFilesToBackup,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  scanProject,
  writeReport,
  writeText
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const apply = Boolean(args.apply);
const registry = await loadRegistry();
const refs = args.project
  ? await projectsFromArgs(args)
  : registry.projects.map((project) => ({ name: project.name, path: project.path }));
const results = [];

for (const ref of refs) {
  const scanned = await scanProject(ref);
  const previous = registry.projects.find((project) => project.id === scanned.id) || {};
  const project = { ...scanned, ...previous };
  const target = join(project.path, "README_GITHUB_FR.md");
  const blockers = [];
  if (project.name === "99_Archive") blockers.push("archive-only");
  if (project.securityStatus !== "OK_PUBLIC") blockers.push(`security-${project.securityStatus || "UNKNOWN"}`);
  const status = blockers.length ? "BLOCKED" : apply ? "WRITTEN" : "DRY_RUN_READY";
  if (apply && !blockers.length) {
    await copyExistingFilesToBackup(project, [target], "github-readme-fr");
    await writeText(target, renderReadme(project));
  }
  results.push({ project: project.name, target, exists: existsSync(target), status, blockers });
}

const report = await writeReport(
  "github",
  "github-generate-readme-fr",
  `# Generation README GitHub FR

- Date: ${nowIso()}
- Mode: ${apply ? "apply" : "dry-run"}
- Push GitHub: non

${markdownTable(["Projet", "Statut", "Blocages", "Fichier"], results.map((item) => [item.project, item.status, item.blockers.join("; ") || "aucun", item.target]))}
`,
  { generatedAt: nowIso(), mode: apply ? "apply" : "dry-run", results }
);

console.log(`README GitHub FR traites: ${results.length} projet(s).`);
console.log(`Rapport: ${report.mdPath}`);

function renderReadme(project) {
  return `# ${displayName(project.name)}

## Presentation
Projet du Cerveau IA prepare pour une diffusion publique controlee.

## Statut orchestrateur
- Statut global: ${project.status || "UNKNOWN"}
- Securite: ${project.securityStatus || "UNKNOWN"}
- Fonctionnement: ${project.functionalityStatus || "UNKNOWN"}
- Publication: ${project.publicationStatus || "UNKNOWN"}

## Stack
${(project.stack || []).map((item) => `- ${item}`).join("\n") || "- A documenter"}

## Installation
\`\`\`powershell
npm install
\`\`\`

## Securite
Ne jamais publier de fichier \`.env\`, token, session, log sensible ou donnee privee.
`;
}

function displayName(name) {
  return String(name).replace(/^\d+_/, "").replace(/_/g, " ").trim();
}
