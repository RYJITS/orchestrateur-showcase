import {
  loadRegistry,
  markdownTable,
  nowIso,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const allowed = {
  status: new Set([
    "PUBLIC_READY",
    "PUBLIC_CANDIDATE",
    "PRIVATE_INTERNAL",
    "SENSITIVE_BLOCKED",
    "ARCHIVE_ONLY",
    "NEEDS_REPAIR",
    "NEEDS_DOCUMENTATION"
  ]),
  securityStatus: new Set(["OK_PUBLIC", "OK_PRIVATE", "FAIL_SECRETS", "FAIL_SESSIONS", "UNKNOWN", "KNOWN_REPORT"]),
  functionalityStatus: new Set([
    "FONCTIONNEL",
    "FONCTIONNEL_AVEC_ALERTES",
    "NON_TESTABLE_MANQUE_INFO",
    "NON_FONCTIONNEL_REPARABLE",
    "NON_FONCTIONNEL_BLOQUE",
    "ARCHIVE_READ_ONLY",
    "UNKNOWN",
    "KNOWN_REPORT"
  ]),
  publicationStatus: new Set([
    "PUBLIC_READY",
    "PUBLIC_CANDIDATE",
    "PRIVATE_INTERNAL",
    "SENSITIVE_BLOCKED",
    "ARCHIVE_ONLY",
    "NEEDS_DOCUMENTATION"
  ])
};
const registry = await loadRegistry();
const results = (registry.projects || []).map(validateProject);
const failures = results.filter((result) => result.status === "FAIL");
const warnings = results.filter((result) => result.status === "WARN");
const globalStatus = failures.length ? "FAIL" : warnings.length ? "WARN" : "OK";
const rows = results.map((result) => [
  result.project,
  result.status,
  result.globalStatus,
  result.securityStatus,
  result.functionalityStatus,
  result.publicationStatus,
  result.blockers.join("; ") || "aucun",
  result.warnings.join("; ") || "aucune"
]);

const report = await writeReport(
  "status",
  "validate-project-statuses",
  `# Validation taxonomie statuts projets

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Projets: ${results.length}

${markdownTable(["Projet", "Controle", "Global", "Securite", "Fonctionnement", "Publication", "Blocages", "Alertes"], rows)}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    failures: failures.length,
    warnings: warnings.length,
    allowed: Object.fromEntries(Object.entries(allowed).map(([key, set]) => [key, [...set]])),
    results
  }
);

console.log(`Validation statuts: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (globalStatus === "FAIL") process.exitCode = 1;

function validateProject(project) {
  const blockers = [];
  const warnings = [];
  const values = {
    status: project.status,
    securityStatus: project.securityStatus,
    functionalityStatus: project.functionalityStatus,
    publicationStatus: project.publicationStatus
  };

  for (const [field, value] of Object.entries(values)) {
    if (!value) blockers.push(`${field}-missing`);
    else if (!allowed[field].has(value)) blockers.push(`${field}-invalid:${value}`);
  }

  const isArchive = project.name === "99_Archive" || project.status === "ARCHIVE_ONLY";
  const securityFail = String(project.securityStatus || "").startsWith("FAIL");
  const publicIntent = ["PUBLIC_READY", "PUBLIC_CANDIDATE"].includes(project.status)
    || ["PUBLIC_READY", "PUBLIC_CANDIDATE"].includes(project.publicationStatus);
  const functionalEnough = ["FONCTIONNEL", "FONCTIONNEL_AVEC_ALERTES"].includes(project.functionalityStatus);

  if (isArchive) {
    if (project.name !== "99_Archive") warnings.push("archive-status-on-non-archive");
    if (project.status !== "ARCHIVE_ONLY") blockers.push("archive-global-not-archive-only");
    if (project.publicationStatus !== "ARCHIVE_ONLY") blockers.push("archive-publication-not-archive-only");
    if (project.functionalityStatus !== "ARCHIVE_READ_ONLY") blockers.push("archive-functionality-not-read-only");
  }

  if (securityFail && project.status !== "SENSITIVE_BLOCKED") blockers.push("security-fail-without-sensitive-blocked");
  if (securityFail && !["SENSITIVE_BLOCKED", "PRIVATE_INTERNAL"].includes(project.publicationStatus)) {
    blockers.push("security-fail-publication-not-blocked");
  }
  if (securityFail && publicIntent) blockers.push("security-fail-has-public-intent");

  if (publicIntent && project.securityStatus !== "OK_PUBLIC") blockers.push("public-intent-without-ok-public");
  if (project.status === "PUBLIC_READY" && project.functionalityStatus !== "FONCTIONNEL") blockers.push("public-ready-without-functional");
  if (project.status === "PUBLIC_CANDIDATE" && !functionalEnough) warnings.push("public-candidate-not-fully-verifiable");

  if (project.status === "PRIVATE_INTERNAL" && project.publicationStatus !== "PRIVATE_INTERNAL") warnings.push("private-status-publication-different");
  if (project.status === "NEEDS_REPAIR" && !String(project.functionalityStatus || "").startsWith("NON_FONCTIONNEL")) {
    blockers.push("needs-repair-without-non-functional-status");
  }
  if (project.status === "NEEDS_DOCUMENTATION" && project.docs?.fiche && project.docs?.installation) {
    warnings.push("needs-documentation-but-doc-flags-present");
  }

  return {
    project: project.name,
    id: project.id,
    status: blockers.length ? "FAIL" : warnings.length ? "WARN" : "OK",
    globalStatus: project.status || "MISSING",
    securityStatus: project.securityStatus || "MISSING",
    functionalityStatus: project.functionalityStatus || "MISSING",
    publicationStatus: project.publicationStatus || "MISSING",
    blockers,
    warnings
  };
}
