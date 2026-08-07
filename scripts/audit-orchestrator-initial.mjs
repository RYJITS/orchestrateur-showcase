import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  defaultSiteRoot,
  inferProjectStatus,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  saveRegistry,
  scanProject,
  toPosixPath,
  walkFiles,
  writeJson,
  writeReport,
  writeText
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const refs = args.project ? await projectsFromArgs(args) : [{ name: "01_SITE_MA_METHODE", path: defaultSiteRoot }];
const registry = await loadRegistry();
const results = [];

for (const ref of refs) {
  const scanned = await scanProject(ref);
  const previous = registry.projects.find((project) => project.id === scanned.id) || {};
  const project = {
    ...previous,
    ...scanned,
    securityStatus: previous.securityStatus || scanned.securityStatus,
    functionalityStatus: previous.functionalityStatus || scanned.functionalityStatus,
    publicationStatus: previous.publicationStatus || scanned.publicationStatus,
    reports: previous.reports || scanned.reports || {},
    links: previous.links || scanned.links || {}
  };
  project.status = inferProjectStatus(project);
  const audit = await auditProject(project);
  results.push(audit);

  const reports = { ...(project.reports || {}), initial: toPosixPath(audit.projectReportPath) };
  const next = { ...project, reports, initialAuditStatus: audit.status, updatedAt: nowIso() };
  next.status = inferProjectStatus(next);
  const index = registry.projects.findIndex((item) => item.id === next.id);
  if (index >= 0) registry.projects[index] = next;
  else registry.projects.push(next);
}

registry.generatedAt = nowIso();
await saveRegistry(registry);

const rows = results.map((item) => [
  item.project.name,
  item.status,
  item.framework,
  item.dataSources.length,
  item.captureTargets.length,
  item.projectReportPath
]);

const report = await writeReport(
  "global",
  "audit-orchestrator-initial",
  `# Audit orchestrateur initial

- Date: ${nowIso()}
- Projets: ${results.length}

${markdownTable(["Projet", "Statut", "Framework", "Sources donnees", "Cibles captures", "Rapport projet"], rows)}
`,
  { generatedAt: nowIso(), results }
);

console.log(`Audit initial termine: ${results.length} projet(s).`);
console.log(`Rapport global: ${report.mdPath}`);

async function auditProject(project) {
  const files = await walkFiles(project.path, { maxFiles: 2000 });
  const relativeFiles = files.files
    .filter((item) => item.type === "file")
    .map((item) => toPosixPath(relative(project.path, item.path)));
  const dataSources = findMatches(relativeFiles, [
    /^src\/data\//i,
    /^src\/project-registry\.js$/i,
    /^public\/orchestrator\/projects\.registry\.json$/i,
    /^src\/.*projects?\.(js|jsx|ts|tsx|json)$/i,
    /^public\/.*projects?\.(json|js)$/i
  ]);
  const imageTargets = findMatches(relativeFiles, [
    /^public\/project-shots\//i,
    /^public\/orchestrator\/captures\//i,
    /^public\/generated\/images\//i,
    /^docs\/captures\//i
  ]);
  const componentTargets = findMatches(relativeFiles, [
    /^src\/main\.js$/i,
    /^src\/.*project.*\.(js|jsx|ts|tsx)$/i,
    /^src\/sections\//i,
    /^src\/components\//i
  ]);
  const requiredReports = [
    "FICHE_PROJET.md",
    "INSTALLATION_FR.md",
    "CHANGELOG_FR.md",
    "AUDIT_SECURITE.md",
    "AUDIT_OPTIMISATION.md",
    "AUDIT_NETTOYAGE.md",
    "RAPPORT_FONCTIONNALITE.md",
    ".project-orchestrator.json"
  ];
  const docsStatus = requiredReports.map((file) => ({
    file,
    exists: existsSync(join(project.path, file))
  }));
  const captureTargets = imageTargets.filter((file) => /capture|project-shots|generated\/images/i.test(file));
  const status = docsStatus.every((item) => item.exists) && dataSources.length && componentTargets.length
    ? "INITIAL_AUDIT_OK"
    : "INITIAL_AUDIT_INCOMPLETE";
  const payload = {
    generatedAt: nowIso(),
    status,
    project,
    framework: project.stack?.join(", ") || "non detecte",
    scripts: project.scripts || [],
    dataSources,
    imageTargets,
    captureTargets,
    componentTargets,
    docsStatus,
    fileScan: {
      scannedFiles: relativeFiles.length,
      truncated: files.truncated,
      skippedDirectories: files.skippedDirs.map((dir) => toPosixPath(relative(project.path, dir)))
    },
    recommendations: recommendationsFor(project, docsStatus, dataSources, componentTargets, captureTargets)
  };
  const markdown = renderProjectReport(payload);
  const projectReportPath = join(project.path, "AUDIT_ORCHESTRATEUR_INITIAL.md");
  const projectJsonPath = join(project.path, "AUDIT_ORCHESTRATEUR_INITIAL.json");
  await writeText(projectReportPath, markdown);
  await writeJson(projectJsonPath, payload);
  return { ...payload, projectReportPath, projectJsonPath };
}

function findMatches(files, patterns) {
  return files.filter((file) => patterns.some((pattern) => pattern.test(file))).slice(0, 80);
}

function recommendationsFor(project, docsStatus, dataSources, componentTargets, captureTargets) {
  const out = [];
  if (!docsStatus.every((item) => item.exists)) out.push("Completer les documents manquants avant publication.");
  if (!dataSources.length) out.push("Identifier ou creer une source de donnees projets pour le hub.");
  if (!componentTargets.length) out.push("Identifier le composant ou l'adaptateur qui affiche les projets.");
  if (!captureTargets.length) out.push("Generer captures desktop/mobile et vignette WebP.");
  if (project.securityStatus !== "OK_PUBLIC") out.push("Bloquer toute publication publique tant que la securite n'est pas OK_PUBLIC.");
  if (!out.length) out.push("Maintenir le flux scan -> audits -> fiches -> captures -> synchronisation site.");
  return out;
}

function renderProjectReport(audit) {
  return `# Audit orchestrateur initial - ${audit.project.name}

- Date: ${audit.generatedAt}
- Projet: \`${audit.project.path}\`
- Statut: **${audit.status}**
- Framework/stack: ${audit.framework}
- Scripts npm: ${audit.scripts.join(", ") || "aucun"}

## Diagnostic phase 1

${markdownTable(
  ["Point", "Resultat"],
  [
    ["Framework/scripts", audit.framework],
    ["Sources donnees projets", audit.dataSources.length ? audit.dataSources.join("<br>") : "non detecte"],
    ["Images/vignettes/captures", audit.captureTargets.length ? audit.captureTargets.join("<br>") : "non detecte"],
    ["Composants/adaptateurs", audit.componentTargets.length ? audit.componentTargets.join("<br>") : "non detecte"]
  ]
)}

## Documents requis

${markdownTable(["Fichier", "Etat"], audit.docsStatus.map((item) => [item.file, item.exists ? "OK" : "MANQUANT"]))}

## Securite et publication

- Securite: ${audit.project.securityStatus || "UNKNOWN"}
- Fonctionnement: ${audit.project.functionalityStatus || "UNKNOWN"}
- Publication: ${audit.project.publicationStatus || "UNKNOWN"}
- Statut global: ${audit.project.status || "UNKNOWN"}

## Recommandations

${audit.recommendations.map((item) => `- ${item}`).join("\n")}

> Rapport genere par 00_ORCHESTRATEUR. Aucun fichier sensible n'est copie dans ce rapport.
`;
}
