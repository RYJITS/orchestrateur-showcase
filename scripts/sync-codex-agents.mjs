import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  defaultProjectsRoot,
  markdownTable,
  nowIso,
  orchestratorRoot,
  upsertGeneratedSection,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const marker = "ORCHESTRATEUR_CERVEAU_IA";
const section = `## Orchestrateur de projets Cerveau IA

Quand une demande concerne audit, documentation, GitHub, Hostinger, fiche projet, nettoyage, verification de fonctionnement ou synchronisation memoire, utiliser les skills:

- project-orchestrator
- project-audit-security
- project-cleanup-archive
- project-functionality-repair
- project-github-publication
- project-hostinger-publication

Regles:
- Toujours faire un scan/dry-run avant modification.
- Ne jamais publier sans audit securite OK.
- Toute publication Hostinger reelle passe par le MCP Hostinger apres hostinger:check.
- Ne jamais supprimer: archiver d'abord.
- Toujours documenter en francais.
- Site Ma Methode est le hub qui relie tous les projets de ${defaultProjectsRoot}.`;

const targets = [
  join(orchestratorRoot, "AGENTS.md"),
  join(defaultProjectsRoot, "..", "AGENTS.md"),
  join(homedir(), ".codex", "AGENTS.md")
];
const results = [];

for (const target of targets) {
  if (!existsSync(target)) {
    results.push({ target, status: "SKIPPED_MISSING" });
    continue;
  }
  await upsertGeneratedSection(target, marker, section);
  results.push({ target, status: "SYNCED" });
}

const report = await writeReport(
  "global",
  "agents-sync",
  `# Synchronisation AGENTS.md

- Date: ${nowIso()}

${markdownTable(["Fichier", "Statut"], results.map((item) => [item.target, item.status]))}
`,
  { generatedAt: nowIso(), results }
);

console.log(`AGENTS synchronises: ${results.length}`);
console.log(`Rapport: ${report.mdPath}`);
