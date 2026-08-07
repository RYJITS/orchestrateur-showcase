import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  defaultProjectsRoot,
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

const expectedConfig = await readJson(join(orchestratorRoot, "config", "projects.expected.json"), { projects: [] });
const registry = await loadRegistry();
const diskProjects = await listProjectDirs(defaultProjectsRoot);
const diskByName = new Map(diskProjects.map((project) => [project.name, project]));
const registryByName = new Map((registry.projects || []).map((project) => [project.name, project]));
const searchRoots = [
  { label: "projets", path: defaultProjectsRoot, maxDepth: 0 },
  { label: "archive", path: join(defaultProjectsRoot, "99_Archive"), maxDepth: 4 },
  { label: "orchestrator-archives", path: join(orchestratorRoot, "archives"), maxDepth: 4 },
  { label: "orchestrator-backups", path: join(orchestratorRoot, "backups"), maxDepth: 4 },
  { label: "tmp", path: resolve(orchestratorRoot, "..", "..", "_tmp"), maxDepth: 3 }
].filter((root) => existsSync(root.path));
const directoryIndex = await buildDirectoryIndex(searchRoots);
const results = [];
for (const expected of expectedConfig.projects || []) {
  results.push(await validateExpectedProject(expected));
}
const failures = results.filter((result) => result.status === "FAIL");
const warnings = results.filter((result) => result.status === "WARN");
const globalStatus = failures.length ? "FAIL" : warnings.length ? "WARN" : "OK";

const rows = results.map((result) => [
  result.name,
  result.status,
  result.diskPath || "-",
  result.registryStatus || "-",
  result.candidates.map((candidate) => `${candidate.root}:${candidate.name} (${candidate.score})`).join("; ") || "-",
  result.action
]);

const report = await writeReport(
  "global",
  "validate-expected-projects",
  `# Validation projets attendus

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Source: ${expectedConfig.source || "config/projects.expected.json"}
- Politique absence: ${expectedConfig.missingProjectPolicy || "WARN"}
- Regle: aucun dossier vide n'est cree, aucune restauration n'est appliquee automatiquement.

${markdownTable(["Projet attendu", "Statut", "Chemin disque", "Registre", "Candidats", "Action"], rows)}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    failures: failures.length,
    warnings: warnings.length,
    searchRoots,
    results
  }
);

console.log(`Validation projets attendus: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (failures.length) process.exitCode = 1;

async function validateExpectedProject(expected) {
  const disk = diskByName.get(expected.name);
  const registryProject = registryByName.get(expected.name);
  if (disk && registryProject) {
    return {
      name: expected.name,
      role: expected.role || "project",
      status: "OK",
      diskPath: disk.path,
      registryStatus: registryProject.status || "UNKNOWN",
      candidates: [],
      action: "Projet present sur disque et registre"
    };
  }

  const aliasCoverage = await validateAliasCoverage(expected);
  if (aliasCoverage) return aliasCoverage;

  if (disk && !registryProject) {
    return {
      name: expected.name,
      role: expected.role || "project",
      status: "FAIL",
      diskPath: disk.path,
      registryStatus: "MISSING",
      candidates: [],
      action: "Relancer scan et registry:check"
    };
  }

  const candidates = findCandidates(expected.name);
  const status = expected.missingPolicy === "FAIL" ? "FAIL" : "WARN";
  return {
    name: expected.name,
    role: expected.role || "project",
    status,
    diskPath: null,
    registryStatus: registryProject?.status || "ABSENT",
    candidates,
    action: candidates.length
      ? "Revue humaine: restaurer/renommer si un candidat correspond"
      : "Revue humaine: retrouver source externe ou confirmer retrait du plan"
  };
}

async function validateAliasCoverage(expected) {
  if (!Array.isArray(expected.coveredBy) || !expected.coveredBy.length) return null;
  const covered = expected.coveredBy.map((name) => ({
    name,
    disk: diskByName.get(name),
    registry: registryByName.get(name)
  }));
  const missingCovered = covered.filter((item) => !item.disk || !item.registry).map((item) => item.name);
  const evidence = await validateIdentityEvidence(expected.identityEvidence || []);
  const failedEvidence = evidence.filter((item) => item.status !== "OK");
  const ok = missingCovered.length === 0 && failedEvidence.length === 0;
  return {
    name: expected.name,
    role: expected.role || "alias-covered",
    status: ok ? "OK" : "WARN",
    diskPath: ok ? covered.map((item) => toPosixPath(item.disk.path)).join(" + ") : null,
    registryStatus: ok ? "ALIAS_COVERED" : "ALIAS_INCOMPLETE",
    candidates: ok ? [] : findCandidates(expected.name),
    coveredBy: covered.map((item) => ({
      name: item.name,
      diskPath: item.disk?.path || null,
      registryStatus: item.registry?.status || null
    })),
    identityEvidence: evidence,
    action: ok
      ? `Alias couvert par ${expected.coveredBy.join(", ")}`
      : `Alias incomplet: couverts manquants=${missingCovered.join(", ") || "aucun"}, preuves invalides=${failedEvidence.map((item) => item.label).join(", ") || "aucune"}`
  };
}

async function validateIdentityEvidence(items) {
  const results = [];
  for (const item of items) {
    const project = diskByName.get(item.project);
    const file = project ? join(project.path, item.file || "") : null;
    const label = `${item.project}/${item.file}`;
    if (!project || !file || !existsSync(file)) {
      results.push({ label, status: "MISSING", contains: item.contains || "" });
      continue;
    }
    const content = await readFile(file, "utf8").catch(() => "");
    results.push({
      label,
      status: content.includes(item.contains || "") ? "OK" : "NO_MATCH",
      contains: item.contains || ""
    });
  }
  return results;
}

async function buildDirectoryIndex(roots) {
  const found = [];
  for (const root of roots) {
    await visit(root.path, root, 0);
  }
  return found;

  async function visit(path, root, depth) {
    if (depth > root.maxDepth) return;
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (shouldSkipDirectory(entry.name)) continue;
      const fullPath = join(path, entry.name);
      found.push({
        name: entry.name,
        path: fullPath,
        root: root.label,
        depth,
        slug: slugify(entry.name),
        mtime: await directoryMtime(fullPath)
      });
      await visit(fullPath, root, depth + 1);
    }
  }
}

async function directoryMtime(path) {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch {
    return null;
  }
}

function shouldSkipDirectory(name) {
  return [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".cache",
    ".venv",
    "__pycache__",
    ".playwright-cli",
    ".playwright-mcp"
  ].includes(name);
}

function findCandidates(expectedName) {
  const expectedSlug = slugify(expectedName);
  const expectedTokens = tokens(expectedName);
  return directoryIndex
    .map((candidate) => {
      const candidateTokens = tokens(candidate.name);
      const score = scoreCandidate(expectedSlug, expectedTokens, candidate.slug, candidateTokens);
      return {
        name: candidate.name,
        path: toPosixPath(candidate.path),
        root: candidate.root,
        score,
        mtime: candidate.mtime
      };
    })
    .filter((candidate) => candidate.score >= 35)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, "fr"))
    .filter(uniqueCandidate)
    .slice(0, 8);
}

function uniqueCandidate(candidate, index, candidates) {
  const key = `${candidate.root}:${candidate.name}`.toLowerCase();
  return candidates.findIndex((item) => `${item.root}:${item.name}`.toLowerCase() === key) === index;
}

function tokens(value) {
  return slugify(value)
    .split("-")
    .filter((token) => token.length >= 2)
    .filter((token) => !/^\d+$/.test(token));
}

function scoreCandidate(expectedSlug, expectedTokens, candidateSlug, candidateTokens) {
  if (candidateSlug === expectedSlug) return 100;
  if (candidateSlug.length >= 6 && (candidateSlug.includes(expectedSlug) || expectedSlug.includes(candidateSlug))) return 82;
  const common = expectedTokens.filter((token) => candidateTokens.includes(token));
  const tokenScore = expectedTokens.length ? Math.round((common.length / expectedTokens.length) * 70) : 0;
  const skyiaBoost = expectedTokens.includes("skyia") && candidateTokens.includes("skyia") ? 35 : 0;
  const protocolPenalty = expectedTokens.includes("protocol") && !candidateTokens.includes("protocol") ? -5 : 0;
  const judgmentPenalty = expectedTokens.includes("judgment") && !candidateTokens.includes("judgment") ? -5 : 0;
  return Math.max(0, Math.min(99, tokenScore + skyiaBoost + protocolPenalty + judgmentPenalty));
}
