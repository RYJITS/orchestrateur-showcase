import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
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
const refs = await projectsFromArgs(args);
const registryBefore = await loadRegistry();
const results = [];

for (const ref of refs) {
  const scanned = await scanProject(ref);
  const previous = registryBefore.projects?.find?.((item) => item.id === scanned.id) || {};
  const project = {
    ...previous,
    ...scanned,
    securityStatus: preserveStatus(previous.securityStatus, scanned.securityStatus),
    functionalityStatus: preserveStatus(previous.functionalityStatus, scanned.functionalityStatus),
    publicationStatus: preserveStatus(previous.publicationStatus, scanned.publicationStatus),
    reports: previous.reports || scanned.reports || {},
    links: previous.links || scanned.links || {}
  };
  if (project.name === "99_Archive" && !args.includeArchive) {
    results.push({
      project,
      generatedAt: nowIso(),
      mode: "dry-run",
      status: "ARCHIVE_READ_ONLY",
      diagnosis: [],
      proposedActions: []
    });
    continue;
  }
  const result = await diagnoseRepair(project);
  results.push(result);
  await writeProjectRepairReport(result);
}

const registry = await loadRegistry();
for (const result of results) {
  const index = registry.projects.findIndex((project) => project.id === result.project.id);
  const base = index >= 0 ? registry.projects[index] : result.project;
  const next = {
    ...base,
    repairStatus: result.status,
    reports: {
      ...(base.reports || {}),
      ...(result.reportPath ? { repair: toPosixPath(result.reportPath) } : {})
    },
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
  result.diagnosis.length,
  result.proposedActions.length,
  result.proposedActions.slice(0, 2).map((item) => item.title).join("; ") || "-"
]);
const report = await writeReport(
  "functionality",
  "repair-functionality-global",
  `# Reparation fonctionnalite globale

- Date: ${nowIso()}
- Mode: dry-run diagnostic

${markdownTable(["Projet", "Statut", "Diagnostics", "Actions", "Exemples"], rows)}
`,
  { generatedAt: nowIso(), mode: "dry-run", results }
);

console.log(`Diagnostic reparation termine: ${results.length} projet(s).`);
console.log(`Rapport global: ${report.mdPath}`);

async function diagnoseRepair(project) {
  const reportPath = join(project.path, "RAPPORT_REPARATION_FONCTIONNALITE.md");
  const diagnosis = [];
  const proposedActions = [];
  const verification = await readVerification(project);

  if (!project.hasPackageJson) {
    diagnosis.push({ severity: "info", title: "Projet sans package.json", details: "Verification automatique limitee." });
    proposedActions.push({ title: "Documenter la verification manuelle", command: null });
  }

  if (project.hasPackageJson && !project.scripts.includes("build") && !project.scripts.includes("test") && !project.scripts.includes("lint")) {
    diagnosis.push({ severity: "warning", title: "Aucun script de controle", details: "build/test/lint absents." });
    proposedActions.push({ title: "Ajouter un script de controle non intrusif", command: "Definir une commande check adaptee au projet." });
  }

  if (project.functionalityStatus === "DRY_RUN" || verification?.commands?.some?.((command) => command.status === "DRY_RUN")) {
    proposedActions.push({ title: "Executer la verification reelle", command: `npm run verify:functionality -- --project "${project.path}" --run` });
  }

  if (verification?.status === "FAIL" || verification?.status?.startsWith?.("NON_FONCTIONNEL")) {
    diagnosis.push({ severity: "blocker", title: "Verification echouee", details: "Consulter RAPPORT_FONCTIONNALITE.json pour stdout/stderr." });
    proposedActions.push({ title: "Analyser la premiere commande en echec", command: "Lire stdoutTail/stderrTail dans RAPPORT_FONCTIONNALITE.json." });
  }

  if (verification?.status === "NON_TESTABLE_MANQUE_INFO") {
    diagnosis.push({ severity: "warning", title: "Verification non automatisable", details: "Le projet manque d'informations ou de scripts pour une verification automatique." });
    proposedActions.push({ title: "Documenter une procedure de verification manuelle", command: "Completer INSTALLATION_FR.md et RAPPORT_FONCTIONNALITE.md." });
  }

  if (verification?.status === "FONCTIONNEL_AVEC_ALERTES") {
    diagnosis.push({ severity: "info", title: "Fonctionnel avec alertes", details: verification.recommendation || "Controle automatique incomplet." });
  }

  if (project.securityStatus?.startsWith?.("FAIL")) {
    diagnosis.push({ severity: "warning", title: "Projet bloque securite", details: "La reparation ne doit pas publier ni exposer ce projet." });
    proposedActions.push({ title: "Corriger les blocages securite avant diffusion", command: `npm run security -- --project "${project.path}"` });
  }

  if (!project.docs?.installation) {
    proposedActions.push({ title: "Completer INSTALLATION_FR.md", command: `npm run fiches -- --project "${project.path}"` });
  }

  const status = diagnosis.some((item) => item.severity === "blocker")
    ? "NON_FONCTIONNEL_REPARABLE"
    : proposedActions.length
      ? "FONCTIONNEL_AVEC_ALERTES"
      : "FONCTIONNEL";

  return {
    project,
    generatedAt: nowIso(),
    mode: "dry-run",
    status,
    diagnosis,
    proposedActions,
    verification,
    reportPath
  };
}

async function readVerification(project) {
  const file = join(project.path, "RAPPORT_FONCTIONNALITE.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeProjectRepairReport(result) {
  const diagnosisRows = result.diagnosis.map((item) => [item.severity, item.title, item.details || ""]);
  const actionRows = result.proposedActions.map((item) => [item.title, item.command || "manuel"]);
  const body = `# Rapport reparation fonctionnalite - ${result.project.name}

- Date: ${result.generatedAt}
- Projet: \`${result.project.path}\`
- Mode: **dry-run**
- Statut: **${result.status}**

## Diagnostic
${diagnosisRows.length ? markdownTable(["Severite", "Point", "Detail"], diagnosisRows) : "Aucun probleme fonctionnel detecte par le diagnostic V1."}

## Actions proposees
${actionRows.length ? markdownTable(["Action", "Commande"], actionRows) : "Aucune action proposee."}

## Regle

Ce script ne modifie pas le code. Toute correction doit etre petite, sauvegardee et verifiee.
`;
  await writeText(result.reportPath, body);
  await writeJson(join(result.project.path, "RAPPORT_REPARATION_FONCTIONNALITE.json"), {
    generatedAt: result.generatedAt,
    mode: result.mode,
    status: result.status,
    diagnosis: result.diagnosis,
    proposedActions: result.proposedActions,
    verification: result.verification
  });
}

function preserveStatus(previousStatus, nextStatus) {
  if (!previousStatus) return nextStatus;
  if (["UNKNOWN", "KNOWN_REPORT", "NEEDS_DOCUMENTATION"].includes(nextStatus)) return previousStatus;
  return nextStatus;
}
