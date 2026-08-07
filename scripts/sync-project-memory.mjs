import {
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  scanProject,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const registry = await loadRegistry();
const refs = args.project
  ? await projectsFromArgs(args)
  : registry.projects.map((project) => ({ name: project.name, path: project.path }));
const results = [];

for (const ref of refs) {
  const scanned = await scanProject(ref);
  const previous = registry.projects.find((project) => project.id === scanned.id) || {};
  const project = { ...scanned, ...previous };
  results.push({
    name: project.name,
    status: project.status || "UNKNOWN",
    command:
      `npm run memoire:record -- --scope projet --project "${project.name}" --title "Etat projet orchestrateur" --details "Statut ${project.status || "UNKNOWN"}; securite ${project.securityStatus || "UNKNOWN"}; fonctionnement ${project.functionalityStatus || "UNKNOWN"}" --action "sync-project-memory" --source "00_ORCHESTRATEUR"`
  });
}

const report = await writeReport(
  "global",
  "sync-project-memory",
  `# Synchronisation memoire projets - dry-run

- Date: ${nowIso()}
- Projets: ${results.length}
- Effet externe: aucun

${markdownTable(["Projet", "Statut", "Commande memoire conseillee"], results.map((item) => [item.name, item.status, item.command]))}
`,
  { generatedAt: nowIso(), results }
);

console.log(`Synchronisation memoire projet preparee: ${results.length} projet(s).`);
console.log(`Rapport: ${report.mdPath}`);
