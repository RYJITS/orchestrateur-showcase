import {
  loadRegistry,
  markdownTable,
  nowIso,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const registry = await loadRegistry();
const projects = registry.projects || [];
const statusCounts = countBy(projects, "status");
const securityCounts = countBy(projects, "securityStatus");

const rows = projects.map((project) => [
  project.name,
  project.status || "UNKNOWN",
  project.securityStatus || "UNKNOWN",
  project.functionalityStatus || "UNKNOWN",
  project.publicationStatus || "UNKNOWN"
]);

const summary = {
  generatedAt: nowIso(),
  projectCount: projects.length,
  statusCounts,
  securityCounts,
  recommendedMemoryCommand:
    "npm run memoire:record -- --scope projet --project \"00_ORCHESTRATEUR\" --title \"Synthese orchestrateur\" --details \"Registre global synchronise\" --action \"sync-memory-central\" --source \"00_ORCHESTRATEUR\""
};

const report = await writeReport(
  "global",
  "sync-memory-central",
  `# Synchronisation memoire centrale - dry-run

- Date: ${summary.generatedAt}
- Projets suivis: ${summary.projectCount}
- Effet externe: aucun

## Comptage statuts
${markdownTable(["Statut", "Nombre"], Object.entries(statusCounts))}

## Comptage securite
${markdownTable(["Securite", "Nombre"], Object.entries(securityCounts))}

## Projets
${markdownTable(["Projet", "Statut", "Securite", "Fonctionnement", "Publication"], rows)}

## Commande memoire conseillee
\`\`\`powershell
${summary.recommendedMemoryCommand}
\`\`\`
`,
  summary
);

console.log("Synchronisation memoire centrale preparee en dry-run.");
console.log(`Rapport: ${report.mdPath}`);

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "UNKNOWN";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}
