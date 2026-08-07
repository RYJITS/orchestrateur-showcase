import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultProjectsRoot,
  defaultSiteRoot,
  listProjectDirs,
  loadRegistry,
  markdownTable,
  nowIso,
  orchestratorRoot,
  readJson,
  slugify,
  toPosixPath,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const architectureFiles = [
  "config/projects.registry.json",
  "schemas/project.schema.json",
  "schemas/site-project-card.schema.json",
  "scripts/scan-projects.mjs",
  "scripts/audit-project-security.mjs",
  "scripts/audit-project-cleanup.mjs",
  "scripts/verify-project-functionality.mjs",
  "scripts/update-project-fiches.mjs",
  "scripts/update-site-ma-methode-projects.mjs",
  "scripts/capture-project-screenshots.mjs",
  "scripts/git-backup-guard.mjs"
];

const commandScripts = [
  "scan",
  "security",
  "cleanup:audit",
  "verify:functionality",
  "fiches",
  "screenshots",
  "site-ma-methode",
  "skills:install",
  "agents:sync"
];

const statusEnums = {
  status: ["PUBLIC_READY", "PUBLIC_CANDIDATE", "PRIVATE_INTERNAL", "SENSITIVE_BLOCKED", "ARCHIVE_ONLY", "NEEDS_REPAIR", "NEEDS_DOCUMENTATION"],
  securityStatus: ["OK_PUBLIC", "OK_PRIVATE", "FAIL_SECRETS", "FAIL_SESSIONS", "UNKNOWN", "KNOWN_REPORT"],
  functionalityStatus: ["FONCTIONNEL", "FONCTIONNEL_AVEC_ALERTES", "NON_TESTABLE_MANQUE_INFO", "NON_FONCTIONNEL_REPARABLE", "NON_FONCTIONNEL_BLOQUE", "ARCHIVE_READ_ONLY", "UNKNOWN", "KNOWN_REPORT"],
  publicationStatus: ["PUBLIC_READY", "PUBLIC_CANDIDATE", "PRIVATE_INTERNAL", "SENSITIVE_BLOCKED", "ARCHIVE_ONLY", "NEEDS_DOCUMENTATION"]
};

const registry = await loadRegistry();
const expectedConfig = await readJson(join(orchestratorRoot, "config", "projects.expected.json"), { projects: [] });
const planProjectNames = (expectedConfig.projects || []).map((project) => project.name).filter(Boolean);
const diskProjects = await listProjectDirs(defaultProjectsRoot);
const packageJson = await readJson(join(orchestratorRoot, "package.json"), {});
const conpetancesPackage = await readJson(join(orchestratorRoot, "..", "..", "Conpetances", "package.json"), {});
const hostingerRules = await readJson(join(orchestratorRoot, "config", "hostinger.rules.json"), {});
const sitePublic = await readJson(join(defaultSiteRoot, "public", "orchestrator", "projects.registry.json"), { projects: [] });
const siteMain = await safeRead(join(defaultSiteRoot, "src", "main.js"));
const siteGeneratedModule = await safeRead(join(defaultSiteRoot, "src", "project-registry.js"));
const checks = [];

const diskNames = diskProjects.map((project) => project.name).sort((a, b) => a.localeCompare(b, "fr"));
const registryProjects = registry.projects || [];
const registryNames = registryProjects.map((project) => project.name).sort((a, b) => a.localeCompare(b, "fr"));
const diskSet = new Set(diskNames);
const registrySet = new Set(registryNames);
const missingFromRegistry = diskNames.filter((name) => !registrySet.has(name));
const extraInRegistry = registryNames.filter((name) => !diskSet.has(name));
const aliasCoveredProjects = await aliasCoveredExpectedProjects();
const aliasCoveredNames = new Set(aliasCoveredProjects.map((project) => project.name));
const planMissingOnDisk = planProjectNames.filter((name) => !diskSet.has(name) && !aliasCoveredNames.has(name));
const missingExpectedDetails = missingExpectedProjects(planMissingOnDisk);
const planPresentNotRegistry = planProjectNames.filter((name) => diskSet.has(name) && !registrySet.has(name));
const diskExtrasComparedToPlan = diskNames.filter((name) => !planProjectNames.includes(name));

addCheck("perimetre", "Racine projet scannee", normalize(registry.root) === normalize(defaultProjectsRoot), registry.root || "absente");
addCheck("perimetre", "Configuration projets attendus presente", existsSync(join(orchestratorRoot, "config", "projects.expected.json")) && expectedConfig.missingProjectPolicy === "WARN_AND_DO_NOT_CREATE_PLACEHOLDER", expectedConfig.missingProjectPolicy || "absente");
addCheck("perimetre", "Registre couvre exactement les dossiers disque", missingFromRegistry.length === 0 && extraInRegistry.length === 0, diffEvidence(missingFromRegistry, extraInRegistry));
addCheck("perimetre", "Dossiers nommes dans le plan couverts quand ils existent", planPresentNotRegistry.length === 0, planPresentNotRegistry.join(", ") || "OK");
addCheck("perimetre", "Aliases du plan couverts par projets existants", aliasCoveredProjects.every((project) => project.status === "OK"), aliasCoveredProjects.map((project) => `${project.name}->${project.coveredBy.join("+")}:${project.status}`).join(", ") || "aucun");
addCheck("perimetre", "Dossiers du plan absents du disque courant", planMissingOnDisk.length === 0 ? true : "WARN", missingExpectedDetails.join("; ") || "aucun");
addCheck("perimetre", "Dossiers disque non listes dans le plan mais indexes", diskExtrasComparedToPlan.every((name) => registrySet.has(name)), diskExtrasComparedToPlan.join(", ") || "aucun");

for (const file of architectureFiles) {
  addCheck("architecture", `Artefact requis present: ${file}`, existsSync(join(orchestratorRoot, file)), file);
}
addCheck("architecture", "Skills orchestrateur presents", ["project-orchestrator", "project-audit-security", "project-cleanup-archive", "project-functionality-repair", "project-github-publication", "project-hostinger-publication"].every((name) => existsSync(join(orchestratorRoot, "skills-src", name, "SKILL.md"))), "skills-src/*");
addCheck("architecture", "Schema projet exploitable", existsSync(join(orchestratorRoot, "schemas", "project.schema.json")) && registryProjects.every(projectMatchesSchema), "schemas/project.schema.json + registre");

addCheck("flux-scan", "Chaque projet a les champs de scan essentiels", registryProjects.every(hasScanFields), "id, nom, chemin, stack, scripts, git, docs, fileSummary");
addCheck("flux-classement", "Chaque projet a un statut clair", registryProjects.every(hasStatuses), "status/security/functionality/publication");
addCheck("flux-classement", "Statuts dans la taxonomie V1", registryProjects.every(projectMatchesSchema), "schemas/project.schema.json enums");
addCheck("flux-classement", "99_Archive bloque comme archive", archiveLocked(), "ARCHIVE_ONLY + ARCHIVE_READ_ONLY + aucun lien public");

addCheck("securite", "Rapports securite presents pour projets actifs", activeProjects().every((project) => project.docs?.securityAudit && existsSync(join(project.path, "AUDIT_SECURITE.md"))), "AUDIT_SECURITE.md");
addCheck("securite", "Aucun projet sensible n'expose lien public dans le site", noSensitivePublicLinks(), "site public generated data");
addCheck("securite", "Aucun projet sensible n'expose media public specifique", noSensitivePublicMedia(), "images/screenshots publics");
addCheck("securite", "Portes publication et Hostinger disponibles", Boolean(packageJson.scripts?.["publication:check"]) && Boolean(packageJson.scripts?.["hostinger:check"]) && String(hostingerRules.requiredPublicationTool || "").toLowerCase().includes("hostinger"), "publication:check + hostinger:check + MCP Hostinger");
addCheck("securite", "Mode non destructif verifiable", Boolean(packageJson.scripts?.["safety:check"]) && Boolean(conpetancesPackage.scripts?.["orchestrator:safety-check"]), "safety:check");

addCheck("documentation", "Documents requis presents pour projets actifs", activeProjects().every(hasDocumentationFiles), "FICHE_PROJET/INSTALLATION/CHANGELOG/.project-orchestrator");
addCheck("documentation", "Rapports requis presents pour projets actifs", activeProjects().every(hasProjectReports), "AUDIT_SECURITE/AUDIT_NETTOYAGE/RAPPORT_FONCTIONNALITE");
addCheck("documentation", "99_Archive non modifie par defaut", archiveNotDocumented(), "indexe sans fiches forcees");
addCheck("documentation", "Memoire et compatibilite disponibles dans Conpetances", Boolean(conpetancesPackage.scripts?.["memoire:record"]) && Boolean(conpetancesPackage.scripts?.["memoire:update"]) && Boolean(conpetancesPackage.scripts?.["compat:check"]), "memoire:record + memoire:update + compat:check");

addCheck("fonctionnement", "Projets package.json ont rapport fonctionnement", registryProjects.filter((project) => project.hasPackageJson).every((project) => existsSync(join(project.path, "RAPPORT_FONCTIONNALITE.json"))), "RAPPORT_FONCTIONNALITE.json");
addCheck("fonctionnement", "Projets sans package.json ont statut non automatisable ou prive/archive", registryProjects.filter((project) => !project.hasPackageJson).every((project) => ["NON_TESTABLE_MANQUE_INFO", "ARCHIVE_READ_ONLY"].includes(project.functionalityStatus)), "NON_TESTABLE_MANQUE_INFO/ARCHIVE_READ_ONLY");
addCheck("fonctionnement", "Commande verify:functionality disponible", Boolean(packageJson.scripts?.["verify:functionality"]), "npm run verify:functionality -- --all");

addCheck("hub", "Site importe la source orchestrateur generee", siteImportsGeneratedRegistry(), "src/main.js");
addCheck("hub", "Module projet genere par orchestrateur", siteGeneratedModule.startsWith("// Fichier genere par 00_ORCHESTRATEUR"), "src/project-registry.js");
addCheck("hub", "JSON public couvre tous les projets du registre", siteIdsMatchRegistry(), "public/orchestrator/projects.registry.json");
addCheck("hub", "Cartes site contiennent les champs attendus", (sitePublic.projects || []).every(hasSiteCardFields), "resume/category/status/stack/fiche/local/screenshots");
addCheck("hub", "Hub a validation rendu navigateur", Boolean(packageJson.scripts?.["site:render-check"]) && existsSync(join(orchestratorRoot, "scripts", "validate-site-render.mjs")), "site:render-check");

addCheck("captures", "Projets publics lancables ont captures/vignettes", publicLaunchableProjects().every(hasPublicCaptureSet), publicLaunchableProjects().map((project) => project.name).join(", ") || "aucun public lancable");
addCheck("captures", "Projets bloques n'ont pas captures publiques exposees", noSensitivePublicMedia(), "screenshots absents pour projets sensibles");
addCheck("captures", "Commande screenshots reste disponible", Boolean(packageJson.scripts?.screenshots) && Boolean(packageJson.scripts?.["screenshots:check"]), "screenshots + screenshots:check");

addCheck("commandes", "Commandes V1 orchestrateur presentes", commandScripts.every((script) => packageJson.scripts?.[script]), missing(commandScripts, Object.keys(packageJson.scripts || {})).join(", ") || "OK");
addCheck("commandes", "Relais Conpetances principaux presents", ["orchestrator:scan", "orchestrator:security", "orchestrator:cleanup", "orchestrator:functionality", "orchestrator:site-check", "orchestrator:daily"].every((script) => conpetancesPackage.scripts?.[script]), "orchestrator:*");
addCheck("tests-validation", "Validateurs principaux presents", ["registry:check", "status:check", "expected:check", "docs:check", "site:check", "site:render-check", "publication:check", "hostinger:check", "git:guard", "safety:check"].every((script) => packageJson.scripts?.[script]), "validation suite");
addCheck("tests-validation", "Projets sans Git actifs ont backup controle", noGitActiveProjects().every(hasBackupFolder), noGitActiveProjects().map((project) => project.name).join(", ") || "aucun");
addCheck("tests-validation", "Competance_Recherche_emploie traite avec prudence", competancePrudent(), "dirty git + blocked/private + no public links");

const statusCounts = checks.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});
const globalStatus = checks.some((item) => item.status === "FAIL")
  ? "FAIL"
  : checks.some((item) => item.status === "WARN")
    ? "WARN"
    : "OK";

const report = await writeReport(
  "global",
  "validate-plan-coverage",
  `# Validation couverture plan corrige

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Racine: \`${toPosixPath(defaultProjectsRoot)}\`
- Projets disque: ${diskNames.length}
- Projets registre: ${registryNames.length}

## Synthese
${markdownTable(["Statut", "Nombre"], Object.entries(statusCounts))}

## Couverture
${markdownTable(["Section", "Controle", "Statut", "Preuve"], checks.map((item) => [item.section, item.label, item.status, item.evidence]))}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    statusCounts,
    diskNames,
    registryNames,
    planProjectNames,
    planMissingOnDisk,
    aliasCoveredProjects,
    diskExtrasComparedToPlan,
    checks
  }
);

console.log(`Validation couverture plan: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (checks.some((item) => item.status === "FAIL")) process.exitCode = 1;

function addCheck(section, label, condition, evidence) {
  checks.push({
    section,
    label,
    status: condition === true ? "OK" : condition === "WARN" ? "WARN" : "FAIL",
    evidence: String(evidence || "")
  });
}

async function safeRead(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function normalize(value) {
  return toPosixPath(String(value || "")).replace(/\/+$/g, "").toLowerCase();
}

function diffEvidence(missingItems, extraItems) {
  return `manquants=${missingItems.join(", ") || "aucun"}, extras=${extraItems.join(", ") || "aucun"}`;
}

function missing(required, actual) {
  const actualSet = new Set(actual);
  return required.filter((item) => !actualSet.has(item));
}

function missingExpectedProjects(names) {
  return names.map((name) => {
    const config = (expectedConfig.projects || []).find((project) => project.name === name) || {};
    const policy = config.missingPolicy || expectedConfig.missingProjectPolicy || "WARN";
    return `${name} (${policy}${config.notes ? `: ${config.notes}` : ""})`;
  });
}

async function aliasCoveredExpectedProjects() {
  const out = [];
  for (const expected of expectedConfig.projects || []) {
    if (!Array.isArray(expected.coveredBy) || !expected.coveredBy.length) continue;
    const coveredPresent = expected.coveredBy.every((name) => diskSet.has(name) && registrySet.has(name));
    const evidence = await validateIdentityEvidence(expected.identityEvidence || []);
    out.push({
      name: expected.name,
      coveredBy: expected.coveredBy,
      status: coveredPresent && evidence.every((item) => item.status === "OK") ? "OK" : "WARN",
      evidence
    });
  }
  return out;
}

async function validateIdentityEvidence(items) {
  const results = [];
  for (const item of items) {
    const diskProject = diskProjects.find((project) => project.name === item.project);
    const file = diskProject ? join(diskProject.path, item.file || "") : null;
    if (!diskProject || !file || !existsSync(file)) {
      results.push({ label: `${item.project}/${item.file}`, status: "MISSING" });
      continue;
    }
    const content = await readFile(file, "utf8").catch(() => "");
    results.push({
      label: `${item.project}/${item.file}`,
      status: content.includes(item.contains || "") ? "OK" : "NO_MATCH"
    });
  }
  return results;
}

function activeProjects() {
  return registryProjects.filter((project) => project.name !== "99_Archive");
}

function noGitActiveProjects() {
  return activeProjects().filter((project) => !project.git?.hasGit);
}

function hasScanFields(project) {
  return Boolean(project.id && project.name && project.path && Array.isArray(project.stack) && Array.isArray(project.scripts) && project.git && project.docs && project.fileSummary);
}

function hasStatuses(project) {
  return Boolean(project.status && project.securityStatus && project.functionalityStatus && project.publicationStatus);
}

function projectMatchesSchema(project) {
  return Object.entries(statusEnums).every(([key, allowed]) => allowed.includes(project[key]));
}

function archiveLocked() {
  const project = registryProjects.find((item) => item.name === "99_Archive");
  return Boolean(project)
    && project.status === "ARCHIVE_ONLY"
    && project.publicationStatus === "ARCHIVE_ONLY"
    && project.functionalityStatus === "ARCHIVE_READ_ONLY"
    && !Object.values(project.links || {}).some(Boolean);
}

function archiveNotDocumented() {
  const project = registryProjects.find((item) => item.name === "99_Archive");
  if (!project) return false;
  return !project.docs?.fiche && !project.docs?.installation && !project.docs?.metadata;
}

function hasDocumentationFiles(project) {
  return [
    "FICHE_PROJET.md",
    "INSTALLATION_FR.md",
    "CHANGELOG_FR.md",
    ".project-orchestrator.json"
  ].every((file) => existsSync(join(project.path, file)));
}

function hasProjectReports(project) {
  return [
    "AUDIT_SECURITE.md",
    "AUDIT_NETTOYAGE.md",
    "RAPPORT_FONCTIONNALITE.md"
  ].every((file) => existsSync(join(project.path, file)));
}

function siteImportsGeneratedRegistry() {
  const normalized = siteMain.replace(/\s+/g, " ");
  const referencesGeneratedModule = normalized.includes('from "./project-registry.js')
    || normalized.includes('"./project-registry.js')
    || normalized.includes("'./project-registry.js");
  return referencesGeneratedModule
    && siteMain.includes("orchestratorProjectCards")
    && (/\bimport\s*\(/.test(siteMain) || /\bfrom\s+["']\.\/project-registry\.js/.test(siteMain));
}

function isSensitive(projectOrCard) {
  const statusText = [
    projectOrCard.status?.global || projectOrCard.status || "",
    projectOrCard.status?.security || projectOrCard.securityStatus || "",
    projectOrCard.status?.publication || projectOrCard.publicationStatus || ""
  ].join(" ");
  return /SENSITIVE|BLOCKED|FAIL|ARCHIVE|PRIVATE_INTERNAL/.test(statusText);
}

function noSensitivePublicLinks() {
  return (sitePublic.projects || []).every((card) => {
    if (!isSensitive(card)) return true;
    return !card.url && !card.hostingerUrl && !card.githubUrl;
  });
}

function noSensitivePublicMedia() {
  return (sitePublic.projects || []).every((card) => {
    if (!isSensitive(card)) return true;
    return !(card.screenshots || []).length && !/public\/(?:project-shots|images)\//i.test(card.image || "");
  });
}

function siteIdsMatchRegistry() {
  const siteIds = (sitePublic.projects || []).map((project) => project.id).sort();
  const registryIds = registryProjects.map((project) => project.id).sort();
  return JSON.stringify(siteIds) === JSON.stringify(registryIds);
}

function hasSiteCardFields(card) {
  return Boolean(card.id && card.name && card.category && card.comment && card.image && card.localPath && card.status?.global && card.status?.security && card.status?.functionality && card.status?.publication && Array.isArray(card.stack) && Array.isArray(card.highlights) && Array.isArray(card.functions) && Array.isArray(card.screenshots));
}

function publicLaunchableProjects() {
  return registryProjects.filter((project) => {
    const launchable = project.scripts?.some?.((script) => ["dev", "preview", "start"].includes(script));
    return project.securityStatus === "OK_PUBLIC" && project.name !== "99_Archive" && launchable;
  });
}

function hasPublicCaptureSet(project) {
  return project.screenshotStatus === "CAPTURED"
    && (project.siteScreenshots || []).length >= 2
    && Boolean(project.siteThumbnail)
    && (project.siteScreenshots || []).every((item) => existsSync(join(defaultSiteRoot, item.replace(/^public[\\/]/, "public/"))))
    && existsSync(join(defaultSiteRoot, project.siteThumbnail.replace(/^public[\\/]/, "public/")));
}

function hasBackupFolder(project) {
  return existsSync(join(orchestratorRoot, "backups", slugify(project.name)));
}

function competancePrudent() {
  const project = registryProjects.find((item) => item.name === "Competance_Recherche_emploie");
  if (!project) return false;
  return Boolean(project.git?.dirty)
    && ["SENSITIVE_BLOCKED", "PRIVATE_INTERNAL"].includes(project.status)
    && !Object.values(project.links || {}).some(Boolean);
}
