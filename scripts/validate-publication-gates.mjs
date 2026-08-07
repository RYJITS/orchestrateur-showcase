import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadRegistry,
  markdownTable,
  nowIso,
  orchestratorRoot,
  readJson,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const registry = await loadRegistry();
const githubRules = await readJson(join(orchestratorRoot, "config", "github.rules.json"), {});
const allowedSecurity = new Set(githubRules.allowedSecurityStatus || ["OK_PUBLIC"]);
const allowedPrivateSharingSecurity = new Set(githubRules.allowedPrivateSharingSecurityStatus || ["OK_PUBLIC", "OK_PRIVATE"]);
const blockedPublication = new Set(githubRules.blockedPublicationStatus || ["PRIVATE_INTERNAL", "ARCHIVE_ONLY"]);
const requiredPublicFiles = githubRules.requiredFiles || [];

const results = (registry.projects || []).map(validateProject);
const failures = results.filter((result) => result.status === "FAIL");
const warnings = results.filter((result) => result.status === "WARN");
const globalStatus = failures.length ? "FAIL" : warnings.length ? "WARN" : "OK";

const rows = results.map((result) => [
  result.project,
  result.status,
  result.securityStatus,
  result.publicationStatus,
  result.githubPreparationStatus,
  result.blockers.join("; ") || "aucun",
  result.warnings.join("; ") || "aucune"
]);

const report = await writeReport(
  "github",
  "validate-publication-gates",
  `# Validation portes publication

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Effet externe: aucun
- GitHub/Hostinger: aucun push, aucune publication

${markdownTable(["Projet", "Statut", "Securite", "Publication", "GitHub prep", "Blocages", "Alertes"], rows)}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    failures: failures.length,
    warnings: warnings.length,
    results
  }
);

console.log(`Validation portes publication: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (globalStatus === "FAIL") process.exitCode = 1;

function validateProject(project) {
  const blockers = [];
  const warnings = [];
  const publicLinks = publicLinkKeys(project).filter((key) => !isAllowedPrivateGithubLink(project, key));
  const wantsPublic = isPublicCandidate(project);
  const blocked = isBlocked(project);

  if (project.name === "99_Archive") {
    if (project.publicationStatus !== "ARCHIVE_ONLY" || project.status !== "ARCHIVE_ONLY") blockers.push("archive-not-locked");
    if (publicLinks.length) blockers.push(`archive-has-public-links:${publicLinks.join(",")}`);
  }

  if (blocked && publicLinks.length) blockers.push(`blocked-project-has-public-links:${publicLinks.join(",")}`);
  if (blocked && ["READY", "READY_WITH_ACTIONS", "READY_FOR_MANUAL_SYNC"].includes(project.githubPreparationStatus)) {
    blockers.push(`blocked-project-github-ready:${project.githubPreparationStatus}`);
  }

  if (project.githubPreparationStatus === "READY" && !allowedSecurity.has(project.securityStatus)) {
    blockers.push(`github-ready-without-allowed-security:${project.securityStatus || "UNKNOWN"}`);
  }

  if (wantsPublic) {
    if (!allowedSecurity.has(project.securityStatus)) blockers.push(`public-candidate-security-${project.securityStatus || "UNKNOWN"}`);
    if (blockedPublication.has(project.publicationStatus)) blockers.push(`public-candidate-blocked-publication-${project.publicationStatus}`);
    if (!["FONCTIONNEL", "FONCTIONNEL_AVEC_ALERTES"].includes(project.functionalityStatus)) warnings.push(`functionality-${project.functionalityStatus || "UNKNOWN"}`);
    const missingFiles = requiredPublicFiles.filter((file) => !existsSync(join(project.path, file)));
    if (missingFiles.length) warnings.push(`public-files-missing:${missingFiles.join(",")}`);
  }

  const hasHostinger = Boolean(project.links?.hostinger);
  if (hasHostinger && !allowedSecurity.has(project.securityStatus)) blockers.push(`hostinger-link-without-ok-public:${project.securityStatus || "UNKNOWN"}`);

  const status = blockers.length ? "FAIL" : warnings.length ? "WARN" : "OK";
  return {
    project: project.name,
    id: project.id,
    path: project.path,
    status,
    securityStatus: project.securityStatus || "UNKNOWN",
    functionalityStatus: project.functionalityStatus || "UNKNOWN",
    publicationStatus: project.publicationStatus || "UNKNOWN",
    projectStatus: project.status || "UNKNOWN",
    githubPreparationStatus: project.githubPreparationStatus || "UNKNOWN",
    links: project.links || {},
    blockers,
    warnings
  };
}

function isPublicCandidate(project) {
  return ["PUBLIC_READY", "PUBLIC_CANDIDATE"].includes(project.status)
    || ["PUBLIC_READY", "PUBLIC_CANDIDATE"].includes(project.publicationStatus);
}

function isBlocked(project) {
  const value = `${project.status || ""} ${project.securityStatus || ""} ${project.publicationStatus || ""}`;
  return /SENSITIVE|BLOCKED|FAIL|ARCHIVE|PRIVATE_INTERNAL/.test(value);
}

function isAllowedPrivateGithubLink(project, key) {
  const privateInternal = project.status === "PRIVATE_INTERNAL" || project.publicationStatus === "PRIVATE_INTERNAL";
  if (!privateInternal || !allowedPrivateSharingSecurity.has(project.securityStatus)) return false;
  return ["github", "githubShowcase", "githubPrivate"].includes(key);
}

function publicLinkKeys(project) {
  return Object.entries(project.links || {})
    .filter(([, value]) => Boolean(value))
    .filter(([key]) => /github|hostinger|public|url|demo/i.test(key))
    .map(([key]) => key);
}
