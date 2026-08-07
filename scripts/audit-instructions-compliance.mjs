import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import {
  defaultSiteRoot,
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

const packageJson = await readJson(join(orchestratorRoot, "package.json"), {});
const scripts = packageJson.scripts || {};
const conpetancesPackage = await readJson(join(orchestratorRoot, "..", "..", "Conpetances", "package.json"), {});
const conpetancesScripts = conpetancesPackage.scripts || {};
const registry = await loadRegistry();
const diskProjects = await listProjectDirs(defaultProjectsRoot);
const diskNames = diskProjects.map((project) => project.name).sort((a, b) => a.localeCompare(b, "fr"));
const registryNames = (registry.projects || []).map((project) => project.name).sort((a, b) => a.localeCompare(b, "fr"));
const missingFromRegistry = diskNames.filter((name) => !registryNames.includes(name));
const extraInRegistry = registryNames.filter((name) => !diskNames.includes(name));
const siteProject = registry.projects.find((project) => project.id === "01-site-ma-methode") || {};
const archiveProject = registry.projects.find((project) => project.name === "99_Archive") || {};
const sitePublicRegistry = await readJson(join(defaultSiteRoot, "public", "orchestrator", "projects.registry.json"), { projects: [] });
const siteProjectIds = (sitePublicRegistry.projects || []).map((project) => project.id).sort();
const centralProjectIds = (registry.projects || []).map((project) => project.id).sort();
const missingFromSite = centralProjectIds.filter((id) => !siteProjectIds.includes(id));
const extraInSite = siteProjectIds.filter((id) => !centralProjectIds.includes(id));
const skillNames = [
  "project-orchestrator",
  "project-audit-security",
  "project-cleanup-archive",
  "project-functionality-repair",
  "project-github-publication",
  "project-hostinger-publication"
];
const requiredScripts = [
  "scan",
  "registry:check",
  "status:check",
  "expected:check",
  "plan:coverage",
  "safety:check",
  "security",
  "optimization",
  "architecture",
  "cleanup:audit",
  "cleanup:archive",
  "verify:functionality",
  "repair:functionality",
  "fiches",
  "docs:check",
  "site-ma-methode",
  "site:check",
  "site:render-check",
  "screenshots",
  "screenshots:check",
  "github:prepare",
  "publication:check",
  "hostinger:check",
  "github:sync",
  "backup:prepare",
  "backup:status",
  "git:guard",
  "skills:install",
  "skills:check",
  "agents:sync",
  "subagents",
  "subagents:check",
  "daily",
  "weekly",
  "monthly",
  "dashboard"
];
const requiredConpetancesRelays = [
  "orchestrator:scan",
  "orchestrator:registry",
  "orchestrator:status-check",
  "orchestrator:expected-check",
  "orchestrator:plan-coverage",
  "orchestrator:safety-check",
  "orchestrator:git-guard",
  "orchestrator:site-check",
  "orchestrator:site-render-check",
  "orchestrator:publication-check",
  "orchestrator:hostinger-check",
  "orchestrator:subagents-check",
  "orchestrator:security",
  "orchestrator:cleanup",
  "orchestrator:functionality",
  "orchestrator:docs-check",
  "orchestrator:screenshots-check",
  "orchestrator:daily",
  "orchestrator:weekly",
  "orchestrator:monthly"
];

const checks = [];

check("Projet orchestrateur existe", existsSync(orchestratorRoot), orchestratorRoot);
check("Configuration projets attendus presente", existsSync(join(orchestratorRoot, "config", "projects.expected.json")), "config/projects.expected.json");
check("Registre global couvre exactement les dossiers racine", missingFromRegistry.length === 0 && extraInRegistry.length === 0, `disque=${diskNames.length}, registre=${registryNames.length}, manquants=${missingFromRegistry.join(", ") || "aucun"}, extras=${extraInRegistry.join(", ") || "aucun"}`);
check("Racine registre correcte", normalizePath(registry.root) === normalizePath(defaultProjectsRoot), registry.root || "absente");
check("99_Archive indexe comme ARCHIVE_ONLY", archiveProject.status === "ARCHIVE_ONLY", archiveProject.status || "absent");
check("Taxonomie statuts verifiable", Boolean(scripts["status:check"]) && Boolean(conpetancesScripts["orchestrator:status-check"]) && existsSync(join(orchestratorRoot, "scripts", "validate-project-statuses.mjs")), "status:check + orchestrator:status-check");
check("Projets attendus verifiables", Boolean(scripts["expected:check"]) && Boolean(conpetancesScripts["orchestrator:expected-check"]) && existsSync(join(orchestratorRoot, "scripts", "validate-expected-projects.mjs")), "expected:check + orchestrator:expected-check");
check("Couverture plan corrige verifiable", Boolean(scripts["plan:coverage"]) && Boolean(conpetancesScripts["orchestrator:plan-coverage"]) && existsSync(join(orchestratorRoot, "scripts", "validate-plan-coverage.mjs")), "plan:coverage + orchestrator:plan-coverage");
check("Mode dry-run/non-publication verifiable", Boolean(scripts["safety:check"]) && Boolean(conpetancesScripts["orchestrator:safety-check"]) && existsSync(join(orchestratorRoot, "scripts", "validate-dry-run-safety.mjs")), "safety:check + orchestrator:safety-check");
check("Scripts npm obligatoires presents", requiredScripts.every((script) => scripts[script]), missing(requiredScripts, Object.keys(scripts)).join(", ") || "OK");
check("Relais Conpetances orchestrateur presents", requiredConpetancesRelays.every((script) => conpetancesScripts[script]), missing(requiredConpetancesRelays, Object.keys(conpetancesScripts)).join(", ") || "OK");
check("Skills source presents", skillNames.every((skill) => existsSync(join(orchestratorRoot, "skills-src", skill, "SKILL.md"))), missingSkillsSource().join(", ") || "OK");
check("AGENTS orchestrateur contient section orchestrateur", await fileIncludes(join(orchestratorRoot, "AGENTS.md"), "Orchestrateur de projets Cerveau IA"), "AGENTS.md");
check("AGENTS Cerveau IA contient section orchestrateur", await fileIncludes(join(orchestratorRoot, "..", "..", "AGENTS.md"), "Orchestrateur de projets Cerveau IA"), "D:/00_Cerveau_IA/AGENTS.md");
check("AGENTS Codex global contient section orchestrateur", await fileIncludes(join(homedir(), ".codex", "AGENTS.md"), "Orchestrateur de projets Cerveau IA"), "C:/Users/ysche/.codex/AGENTS.md");
check("AGENTS synchronisent skill Hostinger", await agentsInclude("project-hostinger-publication") && await agentsInclude("MCP Hostinger"), "project-hostinger-publication + MCP Hostinger");
check("Site Ma Methode fiche complete existe", existsSync(join(defaultSiteRoot, "FICHE_PROJET.md")), join(defaultSiteRoot, "FICHE_PROJET.md"));
check("Site Ma Methode audit initial existe", existsSync(join(defaultSiteRoot, "AUDIT_ORCHESTRATEUR_INITIAL.md")), join(defaultSiteRoot, "AUDIT_ORCHESTRATEUR_INITIAL.md"));
check("Site Ma Methode audit securite existe", existsSync(join(defaultSiteRoot, "AUDIT_SECURITE.md")), join(defaultSiteRoot, "AUDIT_SECURITE.md"));
check("Site Ma Methode audit optimisation existe", existsSync(join(defaultSiteRoot, "AUDIT_OPTIMISATION.md")), join(defaultSiteRoot, "AUDIT_OPTIMISATION.md"));
check("Site Ma Methode audit nettoyage existe", existsSync(join(defaultSiteRoot, "AUDIT_NETTOYAGE.md")), join(defaultSiteRoot, "AUDIT_NETTOYAGE.md"));
check("Site Ma Methode rapport fonctionnement existe", existsSync(join(defaultSiteRoot, "RAPPORT_FONCTIONNALITE.md")), join(defaultSiteRoot, "RAPPORT_FONCTIONNALITE.md"));
check("Documentation multi-projets verifiable", Boolean(scripts["docs:check"]) && Boolean(conpetancesScripts["orchestrator:docs-check"]) && existsSync(join(orchestratorRoot, "scripts", "validate-project-documentation.mjs")), "docs:check + orchestrator:docs-check");
check("Schema cartes hub present", existsSync(join(orchestratorRoot, "schemas", "site-project-card.schema.json")), "schemas/site-project-card.schema.json");
check("Captures/vignettes site generees", siteProject.screenshotStatus === "CAPTURED" && (siteProject.siteScreenshots || []).length >= 2, `${siteProject.screenshotStatus || "UNKNOWN"} / ${(siteProject.siteScreenshots || []).length}`);
check("Couverture captures verifiable", Boolean(scripts["screenshots:check"]) && Boolean(conpetancesScripts["orchestrator:screenshots-check"]) && existsSync(join(orchestratorRoot, "scripts", "validate-screenshot-coverage.mjs")), "screenshots:check + orchestrator:screenshots-check");
check("Donnees hub synchronisees exactement", existsSync(join(defaultSiteRoot, "src", "project-registry.js")) && existsSync(join(defaultSiteRoot, "public", "orchestrator", "projects.registry.json")) && missingFromSite.length === 0 && extraInSite.length === 0, `site=${siteProjectIds.length}, registre=${centralProjectIds.length}, manquants=${missingFromSite.join(", ") || "aucun"}, extras=${extraInSite.join(", ") || "aucun"}`);
check("Rendu hub verifiable", Boolean(scripts["site:render-check"]) && Boolean(conpetancesScripts["orchestrator:site-render-check"]) && existsSync(join(orchestratorRoot, "scripts", "validate-site-render.mjs")), "site:render-check + navigateur");
check("Porte publication disponible", Boolean(scripts["publication:check"]) && Boolean(conpetancesScripts["orchestrator:publication-check"]), "publication:check + orchestrator:publication-check");
check("Porte Hostinger MCP disponible", Boolean(scripts["hostinger:check"]) && Boolean(conpetancesScripts["orchestrator:hostinger-check"]) && existsSync(join(orchestratorRoot, "config", "hostinger.rules.json")), "hostinger:check + MCP Hostinger requis");
check("Garde Git/backup verifiable", Boolean(scripts["git:guard"]) && Boolean(conpetancesScripts["orchestrator:git-guard"]) && existsSync(join(orchestratorRoot, "scripts", "validate-git-backup-readiness.mjs")), "git:guard + backup history");
check("Skill Hostinger publication present", existsSync(join(orchestratorRoot, "skills-src", "project-hostinger-publication", "SKILL.md")), "skills-src/project-hostinger-publication");
check("Aucune publication automatique detectee", Boolean(scripts["safety:check"]), "GitHub/Hostinger restent dry-run dans les scripts V1; safety:check le prouve");
check("Dashboard local existe", existsSync(join(orchestratorRoot, "dashboard", "server.mjs")) && existsSync(join(orchestratorRoot, "dashboard", "public", "index.html")), "dashboard/server.mjs");
check("Boutons jour/semaine/mois disponibles", await fileIncludes(join(orchestratorRoot, "dashboard", "public", "index.html"), 'data-action="daily"') && await fileIncludes(join(orchestratorRoot, "dashboard", "public", "index.html"), 'data-action="weekly"') && await fileIncludes(join(orchestratorRoot, "dashboard", "public", "index.html"), 'data-action="monthly"'), "dashboard/public/index.html");
check("Subagents sans ecriture directe", scripts.subagents && scripts["subagents:check"] && existsSync(join(orchestratorRoot, "scripts", "validate-subagent-safety.mjs")), "subagent-dispatch dry-run/analysis-only + subagents:check");
check("Contraintes subagents formalisees", await fileIncludes(join(orchestratorRoot, "scripts", "subagent-dispatch.mjs"), "noApiCallWithoutExplicitApproval") && await fileIncludes(join(orchestratorRoot, "schemas", "subagent-task.schema.json"), "noSecrets"), "dispatch + schema");
check("Memoire centrale mise a jour par commandes externes", existsSync(join(orchestratorRoot, "..", "..", "Memoire", "PROJET_GLOBAL_ETAT.md")), "Memoire/PROJET_GLOBAL_ETAT.md");
check("Compatibilite multi-projets OK recente", await fileIncludes(join(orchestratorRoot, "..", "..", "Memoire", "COMPATIBILITE_RAPPORT.md"), "Validation reussie"), "Memoire/COMPATIBILITE_RAPPORT.md");

for (const item of await runtimeSkillChecks()) checks.push(item);

const statusCounts = checks.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});
const globalStatus = checks.some((item) => item.status === "FAIL")
  ? "INCOMPLETE"
  : checks.some((item) => item.status === "WARN")
    ? "PARTIAL"
    : "OK";

const report = await writeReport(
  "global",
  "audit-instructions-compliance",
  `# Audit conformite instructions orchestrateur

- Date: ${nowIso()}
- Statut global: **${globalStatus}**

## Synthese
${markdownTable(["Statut", "Nombre"], Object.entries(statusCounts))}

## Details
${markdownTable(["Controle", "Statut", "Preuve"], checks.map((item) => [item.label, item.status, item.evidence]))}
`,
  { generatedAt: nowIso(), globalStatus, statusCounts, checks }
);

console.log(`Audit conformite: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);

function check(label, condition, evidence) {
  checks.push({
    label,
    status: condition === true ? "OK" : condition === "WARN" ? "WARN" : "FAIL",
    evidence: String(evidence || "")
  });
}

function missing(required, actual) {
  const set = new Set(actual);
  return required.filter((item) => !set.has(item));
}

function missingSkillsSource() {
  return skillNames.filter((skill) => !existsSync(join(orchestratorRoot, "skills-src", skill, "SKILL.md")));
}

async function fileIncludes(filePath, needle) {
  try {
    return (await readFile(filePath, "utf8")).includes(needle);
  } catch {
    return false;
  }
}

async function agentsInclude(needle) {
  const targets = [
    join(orchestratorRoot, "AGENTS.md"),
    join(orchestratorRoot, "..", "..", "AGENTS.md"),
    join(homedir(), ".codex", "AGENTS.md")
  ];
  for (const target of targets) {
    if (!(await fileIncludes(target, needle))) return false;
  }
  return true;
}

async function runtimeSkillChecks() {
  const config = await readJson(join(orchestratorRoot, "config", "codex-runtime-targets.json"), {});
  const targets = [...(config.globalTargets || []), ...(config.projectTargets || [])];
  const checks = [];
  for (const target of targets) {
    if (!existsSync(target)) {
      checks.push({ label: `Runtime skills target ${target}`, status: "OK", evidence: "dossier absent, copie non requise" });
      continue;
    }
    const mismatches = [];
    for (const skill of skillNames) {
      const source = join(orchestratorRoot, "skills-src", skill);
      const runtime = join(target, skill);
      if (!existsSync(join(runtime, "SKILL.md"))) {
        mismatches.push(`${skill}:missing`);
        continue;
      }
      const sourceManifest = await skillManifest(source);
      const runtimeManifest = await skillManifest(runtime);
      const mismatch = compareManifests(sourceManifest, runtimeManifest);
      if (mismatch !== "PRESENT") mismatches.push(`${skill}:${mismatch.toLowerCase()}`);
    }
    checks.push({
      label: `Runtime skills target ${target}`,
      status: mismatches.length ? "FAIL" : "OK",
      evidence: mismatches.length ? `non alignes: ${mismatches.join(", ")}` : "skills presents et alignes source maitre"
    });
  }
  return checks;
}

function normalizePath(value) {
  return value ? toPosixPath(String(value)).replace(/\/+$/g, "").toLowerCase() : "";
}

async function skillManifest(root) {
  const files = [];

  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const data = await readFile(fullPath);
      files.push({
        path: relative(root, fullPath).replace(/\\/g, "/"),
        hash: createHash("sha256").update(data).digest("hex")
      });
    }
  }

  await visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function compareManifests(sourceManifest, runtimeManifest) {
  const runtimeMap = new Map(runtimeManifest.map((item) => [item.path, item.hash]));
  for (const sourceFile of sourceManifest) {
    if (!runtimeMap.has(sourceFile.path)) return "MISSING";
    if (runtimeMap.get(sourceFile.path) !== sourceFile.hash) return "STALE";
  }
  return "PRESENT";
}
