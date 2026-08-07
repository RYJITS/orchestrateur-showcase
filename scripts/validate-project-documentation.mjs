import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  defaultProjectsRoot,
  listProjectDirs,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  readJson,
  toPosixPath,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const requiredActiveFiles = [
  "FICHE_PROJET.md",
  "INSTALLATION_FR.md",
  "CHANGELOG_FR.md",
  ".project-orchestrator.json",
  "AUDIT_SECURITE.md",
  "AUDIT_NETTOYAGE.md",
  "AUDIT_OPTIMISATION.md",
  "RAPPORT_FONCTIONNALITE.md"
];
const requiredFicheSections = [
  "Liens vers l'application",
  "A quoi sert le projet",
  "Fonctionnement de l'application ou du projet",
  "Comment le projet a ete construit",
  "Installation et utilisation",
  "Fonctions disponibles dans l'application",
  "Outils, IA et moteurs en arriere-plan",
  "Automatisations integrees",
  "Captures d'ecran",
  "Mises a jour"
];
const forbiddenPublicFicheSections = [
  "Resume court",
  "Pour qui",
  "Statut actuel",
  "Suivi orchestrateur"
];
const args = parseArgs();
const publicationMode = Boolean(args.publication || args.sitePublication);
const activeRequiredFiles = publicationMode
  ? ["FICHE_PROJET.md", ".project-orchestrator.json"]
  : requiredActiveFiles;
const registry = await loadRegistry();
const registryByPath = new Map((registry.projects || []).map((project) => [normalizePath(project.path), project]));
const diskProjects = await listProjectDirs(defaultProjectsRoot);
const results = [];

for (const diskProject of diskProjects) {
  const registryProject = registryByPath.get(normalizePath(diskProject.path));
  if (!registryProject) {
    results.push({
      project: diskProject.name,
      path: diskProject.path,
      status: "FAIL",
      missingFiles: [],
      warnings: [],
      blockers: ["absent-du-registre"]
    });
    continue;
  }
  results.push(await validateProject(diskProject, registryProject));
}

const failures = results.filter((result) => result.status === "FAIL");
const warnings = results.filter((result) => result.status === "WARN");
const globalStatus = failures.length ? "FAIL" : warnings.length ? "WARN" : "OK";
const rows = results.map((result) => [
  result.project,
  result.status,
  result.registryStatus,
  result.missingFiles.join("; ") || "aucun",
  result.blockers.join("; ") || "aucun",
  result.warnings.join("; ") || "aucune"
]);

const report = await writeReport(
  "documentation",
  "validate-project-documentation",
  `# Validation documentation projets

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Mode: ${publicationMode ? "PUBLICATION_SITE" : "COMPLET"}
- Racine: \`${defaultProjectsRoot}\`
- Regle archive: \`99_Archive\` est indexe mais non modifie par defaut.

${markdownTable(["Projet", "Statut", "Statut registre", "Fichiers manquants", "Blocages", "Alertes"], rows)}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    requiredActiveFiles: activeRequiredFiles,
    requiredFicheSections,
    failures: failures.length,
    warnings: warnings.length,
    results
  }
);

console.log(`Validation documentation: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (globalStatus === "FAIL") process.exitCode = 1;

async function validateProject(diskProject, registryProject) {
  const blockers = [];
  const warnings = [];
  const missingFiles = [];
  const isArchive = diskProject.name === "99_Archive" || registryProject.status === "ARCHIVE_ONLY";

  if (diskProject.name === "99_Archive") {
    if (registryProject.status !== "ARCHIVE_ONLY" || registryProject.publicationStatus !== "ARCHIVE_ONLY") {
      blockers.push("archive-status-not-locked");
    }
    if (registryProject.docs?.fiche || registryProject.hasFiche) warnings.push("archive-has-generated-doc-flags");
    return buildResult(diskProject, registryProject, blockers, warnings, missingFiles);
  }

  for (const file of activeRequiredFiles) {
    if (!existsSync(join(diskProject.path, file))) missingFiles.push(file);
  }
  if (missingFiles.length) blockers.push("documentation-incomplete");

  const fichePath = join(diskProject.path, "FICHE_PROJET.md");
  if (existsSync(fichePath)) {
    const fiche = await readFile(fichePath, "utf8").catch(() => "");
    const genericHits = [
      "L'orchestrateur detecte ses fichiers, ses scripts, ses statuts et ses liens possibles",
      "est reference dans le Cerveau IA pour etre suivi, documente et relie au hub Site Ma Methode",
      "Fiche metier a completer"
    ].filter((pattern) => fiche.includes(pattern));
    if (genericHits.length) blockers.push(`fiche-metier-generique:${genericHits.length}`);
    const missingSections = missingFicheSections(fiche);
    if (missingSections.length) blockers.push(`fiche-structure-publique-manquante:${missingSections.join(",")}`);
    const forbiddenSections = presentFicheSections(fiche, forbiddenPublicFicheSections);
    if (forbiddenSections.length) blockers.push(`fiche-sections-internes-visibles:${forbiddenSections.join(",")}`);
    if (!/Lien public:/i.test(fiche) || !/GitHub:/i.test(fiche)) {
      blockers.push("fiche-liens-application-incomplets");
    }
    if (hasKnownScreenshots(registryProject) && !/!\[Capture\s+\d+/i.test(fiche)) {
      blockers.push("fiche-captures-connues-non-affichees");
    }
    if (/^-\s*(Application\s*\/\s*site public|Hostinger|Chemin local|Dashboard local|Site public hors Hostinger):/im.test(fiche)) {
      blockers.push("fiche-liens-publics-contient-detail-interne");
    }
  }

  const metadata = await readJson(join(diskProject.path, ".project-orchestrator.json"), null);
  if (!metadata) {
    blockers.push("metadata-invalid-json");
  } else {
    if (metadata.id !== registryProject.id) blockers.push(`metadata-id-mismatch:${metadata.id || "absent"}`);
    if (metadata.name !== registryProject.name) blockers.push(`metadata-name-mismatch:${metadata.name || "absent"}`);
    if (normalizePath(metadata.path) !== normalizePath(registryProject.path)) blockers.push("metadata-path-mismatch");
    if (metadata.source !== "00_ORCHESTRATEUR") warnings.push("metadata-source-not-orchestrator");
  }

  if (!registryProject.hasFiche || !registryProject.hasInstallation) warnings.push("registry-doc-flags-incomplete");
  if (!registryProject.docs?.changelog || !registryProject.docs?.metadata) warnings.push("registry-doc-details-incomplete");
  if (!registryProject.reports?.security && !existsSync(join(diskProject.path, "AUDIT_SECURITE.md"))) warnings.push("security-report-not-linked");
  if (!registryProject.reports?.functionality && !existsSync(join(diskProject.path, "RAPPORT_FONCTIONNALITE.md"))) warnings.push("functionality-report-not-linked");
  if (registryProject.securityStatus === "UNKNOWN") warnings.push("security-status-unknown");
  if (registryProject.functionalityStatus === "UNKNOWN") warnings.push("functionality-status-unknown");

  if (isArchive) warnings.push("archive-like-project-not-99-archive");
  return buildResult(diskProject, registryProject, blockers, warnings, missingFiles);
}

function buildResult(diskProject, registryProject, blockers, warnings, missingFiles) {
  return {
    project: diskProject.name,
    id: registryProject.id,
    path: diskProject.path,
    relativePath: toPosixPath(relative(defaultProjectsRoot, diskProject.path)),
    registryStatus: registryProject.status || "UNKNOWN",
    status: blockers.length ? "FAIL" : warnings.length ? "WARN" : "OK",
    missingFiles,
    blockers,
    warnings
  };
}

function normalizePath(value) {
  return toPosixPath(String(value || "")).replace(/\/+$/g, "").toLowerCase();
}

function missingFicheSections(markdown) {
  return requiredFicheSections.filter((section) => {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`^##\\s+${escaped}\\s*$`, "im").test(markdown);
  });
}

function presentFicheSections(markdown, sections) {
  return sections.filter((section) => {
    const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^##\\s+${escaped}\\s*$`, "im").test(markdown);
  });
}

function hasKnownScreenshots(project) {
  return Boolean(
    (Array.isArray(project.screenshots) && project.screenshots.length) ||
    (Array.isArray(project.siteScreenshots) && project.siteScreenshots.length)
  );
}
