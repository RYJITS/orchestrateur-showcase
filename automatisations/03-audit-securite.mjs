import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  loadRegistry,
  readJson,
  toPosixPath
} from "../scripts/lib/orchestrator-utils.mjs";
import { displayName } from "../scripts/lib/project-content.mjs";
import {
  alignedMarkdownTable,
  automationPaths,
  commandText,
  limitText,
  nowIso,
  parseAutomationArgs,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { orchestratorRoot, resultsRoot } = automationPaths(import.meta.url);
const args = parseAutomationArgs();
const shouldRun = Boolean(args.run);

const steps = [
  {
    id: "security",
    label: "Auditer la securite",
    command: [process.execPath, [join(orchestratorRoot, "scripts", "audit-project-security.mjs")]],
    displayCommand: "node scripts/audit-project-security.mjs",
    purpose: "Scanner les projets, detecter secrets/sessions/fichiers sensibles et mettre a jour les AUDIT_SECURITE."
  }
];

const results = [];

for (const step of steps) {
  if (!shouldRun) {
    results.push({
      ...step,
      status: "DRY_RUN",
      exitCode: null,
      durationMs: 0,
      output: commandText(step)
    });
    continue;
  }
  results.push(await runStep(step));
}

const failures = results.filter((result) => result.exitCode && result.exitCode !== 0);
const securitySummary = await buildSecuritySummary();
const globalStatus = !shouldRun
  ? "DRY_RUN"
  : failures.length
    ? "FAIL"
    : securitySummary.counts.blocked > 0
      ? "BLOCKED_SECURITE"
      : securitySummary.counts.toReview > 0
        ? "WARN"
        : "OK";

const report = await writeAutomationReport(
  resultsRoot,
  "03-audit-securite",
  `# Automatisation 03 - Audit securite

- Date: ${nowIso()}
- Mode: ${shouldRun ? "RUN" : "DRY_RUN"}
- Statut global: **${globalStatus}**
- Racine orchestrateur: \`${orchestratorRoot}\`

## Resultat lisible

${alignedMarkdownTable(
  ["Controle", "Resultat"],
  [
    ["Projets detectes dans le registre", securitySummary.counts.total],
    ["Projets audites hors archive", securitySummary.counts.visible],
    ["Archives ignorees comme projets", securitySummary.counts.archives],
    ["OK public", securitySummary.counts.okPublic],
    ["OK prive/interne", securitySummary.counts.okPrivate],
    ["Bloques securite", securitySummary.counts.blocked],
    ["A verifier", securitySummary.counts.toReview],
    ["Rapports AUDIT_SECURITE presents", `${securitySummary.counts.reports}/${securitySummary.counts.visible}`],
    ["Alertes detectees", securitySummary.counts.findings]
  ]
)}

## Controle par projet

${securityControlTables(securitySummary.projectRows, securitySummary.alertRows)}

## Points a traiter

${securitySummary.actions.length
  ? securitySummary.actions.map((item) => `- ${item}`).join("\n")
  : "- Aucun blocage securite majeur detecte dans les rapports connus."}

## Etapes

${alignedMarkdownTable(
  ["Etape", "Statut", "Commande", "Duree", "Sortie"],
  results.map((result) => [
    result.label,
    result.status,
    commandText(result),
    result.durationMs ? `${result.durationMs} ms` : "-",
    trim(result.output)
  ])
)}

## Suite conseillee

${shouldRun
  ? "- Corriger les projets bloques avant toute publication GitHub, Hostinger ou Ma Methode."
  : "- Relancer avec `--run` ou choisir `R` dans le lanceur pour reecrire les audits securite."}
`,
  {
    generatedAt: nowIso(),
    action: "03-audit-securite",
    mode: shouldRun ? "RUN" : "DRY_RUN",
    globalStatus,
    securitySummary,
    results
  }
);

console.log(`Automatisation 03: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (shouldRun && failures.length) process.exitCode = 1;

function runStep(step) {
  const started = Date.now();
  const [command, commandArgs] = step.command;
  return new Promise((resolvePromise) => {
    execFile(command, commandArgs, {
      cwd: orchestratorRoot,
      windowsHide: true,
      timeout: 20 * 60 * 1000,
      maxBuffer: 40 * 1024 * 1024
    }, (error, stdout = "", stderr = "") => {
      const exitCode = error?.code ?? 0;
      const output = stdout || stderr || "";
      resolvePromise({
        ...step,
        status: exitCode === 0 ? "OK" : "FAIL",
        exitCode,
        durationMs: Date.now() - started,
        output
      });
    });
  });
}

async function buildSecuritySummary() {
  const registry = await loadRegistry();
  const projects = registry.projects || [];
  const archiveProjects = projects.filter(isArchiveProject);
  const projectRows = [];
  const alertRows = [];
  const actions = [];
  const visibleReports = [];

  for (const project of projects) {
    if (isArchiveProject(project)) continue;
    const auditJsonPath = join(project.path, "AUDIT_SECURITE.json");
    const auditMdPath = join(project.path, "AUDIT_SECURITE.md");
    const auditJson = await readJson(auditJsonPath, null);
    const status = auditJson?.status || project.securityStatus || "UNKNOWN";
    const findings = Array.isArray(auditJson?.findings) ? auditJson.findings : [];
    const reportPresent = existsSync(auditMdPath);
    const publication = publicationLabel(status);
    const examples = findingExamples(findings);

    visibleReports.push({ project, status, findings, reportPresent });
    projectRows.push([
      displayName(project.name),
      shortSecurityStatus(status),
      findings.length,
      reportPresent ? "OK" : "MANQUE",
      publication
    ]);

    if (findings.length) {
      alertRows.push([
        displayName(project.name),
        shortSecurityStatus(status),
        findingTypes(findings),
        examples
      ]);
    }

    if (!reportPresent) actions.push(`${project.name}: lancer l'audit securite en RUN pour creer AUDIT_SECURITE.md.`);
    if (String(status).startsWith("FAIL")) actions.push(`${project.name}: corriger les alertes securite avant publication.`);
    if (["UNKNOWN", "KNOWN_REPORT", "NEEDS_DOCUMENTATION"].includes(status)) actions.push(`${project.name}: relancer l'audit securite pour obtenir un statut clair.`);
  }

  return {
    generatedAt: nowIso(),
    registryGeneratedAt: registry.generatedAt || null,
    ignoredArchives: archiveProjects.map((project) => project.name),
    counts: {
      total: projects.length,
      visible: visibleReports.length,
      archives: archiveProjects.length,
      okPublic: visibleReports.filter((item) => item.status === "OK_PUBLIC").length,
      okPrivate: visibleReports.filter((item) => item.status === "OK_PRIVATE").length,
      blocked: visibleReports.filter((item) => String(item.status).startsWith("FAIL")).length,
      toReview: visibleReports.filter((item) => ["UNKNOWN", "KNOWN_REPORT", "NEEDS_DOCUMENTATION"].includes(item.status)).length,
      reports: visibleReports.filter((item) => item.reportPresent).length,
      findings: visibleReports.reduce((total, item) => total + item.findings.length, 0)
    },
    projectRows,
    alertRows,
    actions: [...new Set(actions)]
  };
}

function securityControlTables(projectRows, alertRows) {
  const sections = [
    "### Statut securite",
    alignedMarkdownTable(
      ["Projet", "Securite", "Alertes", "Rapport", "Publication"],
      projectRows
    )
  ];

  sections.push("");
  sections.push("### Alertes principales");
  sections.push(alertRows.length
    ? alignedMarkdownTable(["Projet", "Securite", "Types", "Exemples"], alertRows)
    : "- Aucune alerte connue dans les rapports AUDIT_SECURITE.json existants.");

  return sections.join("\n");
}

function isArchiveProject(project) {
  return project.id === "99-archive" || project.name === "99_Archive" || project.category === "archive";
}

function shortSecurityStatus(status) {
  if (status === "OK_PUBLIC") return "OK_PUBLIC";
  if (status === "OK_PRIVATE") return "OK_PRIVATE";
  if (status === "FAIL_SECRETS") return "FAIL_SECRETS";
  if (status === "FAIL_SESSIONS") return "FAIL_SESSIONS";
  return status || "UNKNOWN";
}

function publicationLabel(status) {
  if (status === "OK_PUBLIC") return "Possible";
  if (status === "OK_PRIVATE") return "Interne";
  if (String(status).startsWith("FAIL")) return "Bloquee";
  return "A verifier";
}

function findingTypes(findings) {
  const types = [...new Set(findings.map((finding) => finding.type || "alerte"))];
  return limitText(types.slice(0, 3).join(", "), 52) || "-";
}

function findingExamples(findings) {
  const first = findings[0];
  if (!first) return "-";
  return limitText(`${first.type || "alerte"}:${toPosixPath(first.path || "")}`, 78);
}

function trim(value) {
  return trimText(value, 260);
}
