import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  defaultProjectsRoot,
  listProjectDirs,
  loadRegistry,
  markdownTable,
  nowIso,
  orchestratorRoot,
  readJson,
  toPosixPath,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const registry = await loadRegistry();
const projectSchema = await readJson(join(orchestratorRoot, "schemas", "project.schema.json"), {});
const diskProjects = await listProjectDirs(defaultProjectsRoot);
const registryProjects = registry.projects || [];

const diskNames = diskProjects.map((project) => project.name).sort((a, b) => a.localeCompare(b, "fr"));
const registryNames = registryProjects.map((project) => project.name).sort((a, b) => a.localeCompare(b, "fr"));
const missingFromRegistry = diskNames.filter((name) => !registryNames.includes(name));
const extraInRegistry = registryNames.filter((name) => !diskNames.includes(name));
const duplicateIds = duplicates(registryProjects.map((project) => project.id).filter(Boolean));
const duplicateNames = duplicates(registryProjects.map((project) => project.name).filter(Boolean));
const duplicatePaths = duplicates(registryProjects.map((project) => normalizePath(project.path)).filter(Boolean));
const missingStatuses = registryProjects
  .filter((project) => !project.status || !project.securityStatus || !project.functionalityStatus || !project.publicationStatus)
  .map((project) => project.name);
const missingPaths = registryProjects
  .filter((project) => !project.path || !existsSync(project.path))
  .map((project) => project.name);
const schemaIssues = registryProjects.flatMap((project) => projectSchemaIssues(project, projectSchema));
const archive = registryProjects.find((project) => project.name === "99_Archive");
const rootMatches = normalizePath(registry.root) === normalizePath(defaultProjectsRoot);

const checks = [
  check("Racine registre", rootMatches, registry.root || "absente"),
  check("Tous les dossiers disque sont dans le registre", missingFromRegistry.length === 0, missingFromRegistry.join(", ") || "OK"),
  check("Aucun projet fantome dans le registre", extraInRegistry.length === 0, extraInRegistry.join(", ") || "OK"),
  check("IDs uniques", duplicateIds.length === 0, duplicateIds.join(", ") || "OK"),
  check("Noms uniques", duplicateNames.length === 0, duplicateNames.join(", ") || "OK"),
  check("Chemins uniques", duplicatePaths.length === 0, duplicatePaths.join(", ") || "OK"),
  check("Chemins existants", missingPaths.length === 0, missingPaths.join(", ") || "OK"),
  check("Statuts essentiels presents", missingStatuses.length === 0, missingStatuses.join(", ") || "OK"),
  check("Schema projet commun respecte", schemaIssues.length === 0, schemaIssues.slice(0, 12).join(", ") || "OK"),
  check("99_Archive reste ARCHIVE_ONLY", archive?.status === "ARCHIVE_ONLY" && archive?.publicationStatus === "ARCHIVE_ONLY", archive ? `${archive.status}/${archive.publicationStatus}` : "absent")
];

const globalStatus = checks.every((item) => item.status === "OK") ? "OK" : "FAIL";
const projectRows = registryProjects
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name, "fr"))
  .map((project) => [
    project.name,
    project.status || "MISSING",
    project.securityStatus || "MISSING",
    project.functionalityStatus || "MISSING",
    project.publicationStatus || "MISSING"
  ]);

const report = await writeReport(
  "global",
  "validate-project-registry",
  `# Validation registre projets

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Racine disque: \`${toPosixPath(defaultProjectsRoot)}\`
- Projets disque: ${diskNames.length}
- Projets registre: ${registryNames.length}

## Controles
${markdownTable(["Controle", "Statut", "Preuve"], checks.map((item) => [item.label, item.status, item.evidence]))}

## Projets
${markdownTable(["Projet", "Global", "Securite", "Fonctionnement", "Publication"], projectRows)}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    root: toPosixPath(defaultProjectsRoot),
    diskNames,
    registryNames,
    missingFromRegistry,
    extraInRegistry,
    duplicateIds,
    duplicateNames,
    duplicatePaths,
    missingStatuses,
    missingPaths,
    schemaIssues,
    checks
  }
);

console.log(`Validation registre: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (globalStatus !== "OK") process.exitCode = 1;

function check(label, condition, evidence) {
  return {
    label,
    status: condition ? "OK" : "FAIL",
    evidence: String(evidence || "")
  };
}

function duplicates(values) {
  const seen = new Set();
  const duplicateValues = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    else seen.add(value);
  }
  return [...duplicateValues];
}

function normalizePath(value) {
  return value ? toPosixPath(resolve(String(value))).toLowerCase() : "";
}

function projectSchemaIssues(project, schema) {
  const issues = [];
  for (const key of schema.required || []) {
    if (project[key] === undefined || project[key] === null || project[key] === "") issues.push(`${project.name}:${key}:missing`);
  }
  for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
    if (!propertySchema?.enum || project[key] === undefined) continue;
    if (!propertySchema.enum.includes(project[key])) issues.push(`${project.name}:${key}:${project[key]}`);
  }
  return issues;
}
