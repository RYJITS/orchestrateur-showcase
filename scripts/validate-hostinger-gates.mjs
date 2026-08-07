import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  loadRegistry,
  markdownTable,
  nowIso,
  orchestratorRoot,
  parseArgs,
  readJson,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const rules = await readJson(join(orchestratorRoot, "config", "hostinger.rules.json"), {});
const registry = await loadRegistry();
const allowedSecurity = new Set(rules.allowedSecurityStatus || ["OK_PUBLIC"]);
const blockedProjectStatus = new Set(rules.blockedProjectStatus || ["SENSITIVE_BLOCKED", "PRIVATE_INTERNAL", "ARCHIVE_ONLY", "NEEDS_REPAIR"]);
const blockedPublicationStatus = new Set(rules.blockedPublicationStatus || ["PRIVATE_INTERNAL", "ARCHIVE_ONLY"]);
const requiredTool = rules.requiredPublicationTool || "MCP Hostinger";
const scopedProjects = selectProjects(registry.projects || []);
const projectResults = scopedProjects.map(validateProject);
const automationChecks = await validateNoAutomaticHostingerDeployment();
const failures = [
  ...projectResults.filter((result) => result.status === "FAIL"),
  ...automationChecks.filter((result) => result.status === "FAIL")
];
const warnings = [
  ...projectResults.filter((result) => result.status === "WARN"),
  ...automationChecks.filter((result) => result.status === "WARN")
];
const globalStatus = failures.length ? "FAIL" : warnings.length ? "WARN" : "OK";

const projectRows = projectResults.map((item) => [
  item.project,
  item.status,
  item.securityStatus,
  item.projectStatus,
  item.hostingerLink || "-",
  item.nextAction,
  item.blockers.join("; ") || "aucun"
]);
const automationRows = automationChecks.map((item) => [
  item.control,
  item.status,
  item.evidence
]);

const report = await writeReport(
  "hostinger",
  "validate-hostinger-gates",
  `# Validation portes Hostinger

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Mode: ${rules.defaultMode || "dry-run"}
- Publication reelle: non
- Portee: ${args.project ? `projet ${args.project}` : args.siteOnly ? "Site Ma Methode" : "tous les projets"}
- Outil requis pour action reelle: **${requiredTool}**

## Projets
${markdownTable(["Projet", "Statut", "Securite", "Projet", "Lien Hostinger", "Action suivante", "Blocages"], projectRows)}

## Automatisation
${markdownTable(["Controle", "Statut", "Preuve"], automationRows)}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    requiredTool,
    failures: failures.length,
    warnings: warnings.length,
    projectResults,
    automationChecks
  }
);

console.log(`Validation portes Hostinger: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (globalStatus === "FAIL") process.exitCode = 1;

function validateProject(project) {
  const blockers = [];
  const hostingerLink = project.links?.hostinger || "";
  const wantsHostinger = Boolean(hostingerLink) || isPublicCandidate(project);
  const blocked = isBlocked(project);

  if (project.name === "99_Archive" && hostingerLink) blockers.push("archive-has-hostinger-link");
  if (hostingerLink && !allowedSecurity.has(project.securityStatus)) blockers.push(`hostinger-link-without-ok-public:${project.securityStatus || "UNKNOWN"}`);
  if (wantsHostinger && blockedProjectStatus.has(project.status)) blockers.push(`blocked-project-status:${project.status}`);
  if (wantsHostinger && blockedPublicationStatus.has(project.publicationStatus)) blockers.push(`blocked-publication-status:${project.publicationStatus}`);
  if (wantsHostinger && !allowedSecurity.has(project.securityStatus)) blockers.push(`security-not-allowed:${project.securityStatus || "UNKNOWN"}`);

  const nextAction = blockers.length
    ? "BLOQUE"
    : wantsHostinger
      ? `${requiredTool} requis, validation humaine obligatoire`
      : "Aucune action Hostinger";
  const status = blockers.length ? "FAIL" : "OK";

  return {
    project: project.name,
    id: project.id,
    path: project.path,
    status,
    securityStatus: project.securityStatus || "UNKNOWN",
    publicationStatus: project.publicationStatus || "UNKNOWN",
    projectStatus: project.status || "UNKNOWN",
    hostingerLink,
    wantsHostinger,
    nextAction,
    blockers
  };
}

function selectProjects(projects) {
  if (args.siteOnly) {
    return projects.filter((project) => project.id === "01-site-ma-methode" || project.name === "01_SITE_MA_METHODE");
  }
  const query = String(args.project || "").trim().toLowerCase();
  if (!query) return projects;
  return projects.filter((project) => {
    const values = [project.id, project.name, project.path].filter(Boolean).map((value) => String(value).toLowerCase());
    return values.some((value) => value.includes(query) || query.includes(value));
  });
}

async function validateNoAutomaticHostingerDeployment() {
  const checks = [];
  const packageJson = await safeRead(join(orchestratorRoot, "package.json"));
  const dashboardServer = await safeRead(join(orchestratorRoot, "dashboard", "server.mjs"));
  const scriptTexts = await readScriptTexts();
  const rawCredentialHits = findHits(scriptTexts, rules.forbiddenRawCredentialPatterns || []);
  const autoDeployHits = [
    ...findHits([{ name: "package.json", text: packageJson }, { name: "dashboard/server.mjs", text: dashboardServer }], rules.forbiddenAutoDeployPatterns || []),
    ...findHits(scriptTexts.filter((item) => item.name !== "validate-hostinger-gates.mjs"), ["deployHostinger(", "publishHostinger(", "uploadHostinger("])
  ];

  checks.push({
    control: "Aucune cle Hostinger lue par l'orchestrateur",
    status: rawCredentialHits.length ? "FAIL" : "OK",
    evidence: rawCredentialHits.join("; ") || "aucun pattern credential"
  });
  checks.push({
    control: "Aucun deploiement Hostinger automatique",
    status: autoDeployHits.length ? "FAIL" : "OK",
    evidence: autoDeployHits.join("; ") || "aucun script de deploiement automatique"
  });
  checks.push({
    control: "Rapport handoff MCP requis",
    status: requiredTool.toLowerCase().includes("hostinger") ? "OK" : "FAIL",
    evidence: requiredTool
  });
  return checks;
}

async function readScriptTexts() {
  const folder = join(orchestratorRoot, "scripts");
  if (!existsSync(folder)) return [];
  const entries = await readdir(folder, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name);
  const texts = [];
  for (const file of files) {
    texts.push({ name: file, text: await safeRead(join(folder, file)) });
  }
  return texts;
}

async function safeRead(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function findHits(items, patterns) {
  const hits = [];
  for (const item of items) {
    const lower = item.text.toLowerCase();
    for (const pattern of patterns) {
      if (lower.includes(String(pattern).toLowerCase())) hits.push(`${basename(item.name)}:${pattern}`);
    }
  }
  return hits;
}

function isPublicCandidate(project) {
  return ["PUBLIC_READY", "PUBLIC_CANDIDATE"].includes(project.status)
    || ["PUBLIC_READY", "PUBLIC_CANDIDATE"].includes(project.publicationStatus);
}

function isBlocked(project) {
  const value = `${project.status || ""} ${project.securityStatus || ""} ${project.publicationStatus || ""}`;
  return /SENSITIVE|BLOCKED|FAIL|ARCHIVE|PRIVATE_INTERNAL/.test(value);
}
