import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  defaultProjectsRoot,
  gitStatus,
  loadRegistry,
  markdownTable,
  nowIso,
  orchestratorRoot,
  slugify,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const registry = await loadRegistry();
const projects = registry.projects || [];
const results = [];

for (const project of projects) {
  const git = await gitStatus(project.path);
  results.push(validateProject(project, git));
}

const failures = results.filter((result) => result.status === "FAIL");
const warnings = results.filter((result) => result.status === "WARN");
const globalStatus = failures.length ? "FAIL" : warnings.length ? "WARN" : "OK";
const rows = results.map((result) => [
  result.project,
  result.status,
  result.gitState,
  result.backupState,
  result.externalChanges.join("; ") || "aucun",
  result.action
]);

const report = await writeReport(
  "git",
  "validate-git-backup-readiness",
  `# Validation garde Git et backup

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Racine projets: \`${defaultProjectsRoot}\`
- Regle: projets sans Git actifs doivent avoir une trace de backup avant action risquee.
- Regle: changements Git externes demandent une revue humaine avant modification/publication.

${markdownTable(["Projet", "Statut", "Git", "Backup", "Changements externes", "Action"], rows)}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    failures: failures.length,
    warnings: warnings.length,
    results
  }
);

console.log(`Validation Git/backup: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (globalStatus === "FAIL") process.exitCode = 1;

function validateProject(project, git) {
  const backupRoot = join(orchestratorRoot, "backups", slugify(project.name));
  const hasBackupHistory = existsSync(backupRoot);
  const isArchive = project.name === "99_Archive" || project.status === "ARCHIVE_ONLY";
  const externalChanges = git.lines
    .filter((line) => !line.startsWith("##"))
    .map(parseGitPath)
    .filter(Boolean)
    .filter((file) => !isOrchestratorGeneratedPath(file));
  const generatedChanges = git.lines
    .filter((line) => !line.startsWith("##"))
    .map(parseGitPath)
    .filter(Boolean)
    .filter(isOrchestratorGeneratedPath);

  if (isArchive) {
    return {
      project: project.name,
      id: project.id,
      status: "OK",
      gitState: git.hasGit ? git.status : "NO_GIT",
      backupState: "ARCHIVE_READ_ONLY",
      externalChanges,
      generatedChanges,
      action: "Ne pas modifier par defaut"
    };
  }

  if (git.status?.startsWith?.("GIT_ERROR")) {
    return {
      project: project.name,
      id: project.id,
      status: "FAIL",
      gitState: git.status,
      backupState: hasBackupHistory ? "BACKUP_HISTORY" : "NO_BACKUP_HISTORY",
      externalChanges,
      generatedChanges,
      action: "Corriger acces Git avant action"
    };
  }

  if (!git.hasGit) {
    return {
      project: project.name,
      id: project.id,
      status: hasBackupHistory ? "OK" : "FAIL",
      gitState: "NO_GIT",
      backupState: hasBackupHistory ? "BACKUP_HISTORY" : "NO_BACKUP_HISTORY",
      externalChanges,
      generatedChanges,
      action: hasBackupHistory ? "Backup existant, refaire backup avant action risquee" : "Creer backup avant modification"
    };
  }

  if (externalChanges.length) {
    return {
      project: project.name,
      id: project.id,
      status: "WARN",
      gitState: "GIT_DIRTY_EXTERNAL",
      backupState: hasBackupHistory ? "BACKUP_HISTORY" : "GIT_HISTORY",
      externalChanges,
      generatedChanges,
      action: "Revue humaine requise avant modification/publication"
    };
  }

  if (generatedChanges.length) {
    return {
      project: project.name,
      id: project.id,
      status: "OK",
      gitState: "GIT_DIRTY_ORCHESTRATOR",
      backupState: hasBackupHistory ? "BACKUP_HISTORY" : "GIT_HISTORY",
      externalChanges,
      generatedChanges,
      action: "Changements generes par orchestrateur, commit manuel si valide"
    };
  }

  return {
    project: project.name,
    id: project.id,
    status: "OK",
    gitState: "GIT_CLEAN",
    backupState: hasBackupHistory ? "BACKUP_HISTORY" : "GIT_HISTORY",
    externalChanges,
    generatedChanges,
    action: "Aucune alerte"
  };
}

function parseGitPath(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("##")) return "";
  const withoutStatus = trimmed.replace(/^[ MADRCU?!]{1,2}\s+/, "");
  return withoutStatus.includes(" -> ")
    ? withoutStatus.split(" -> ").pop().trim()
    : withoutStatus.trim();
}

function isOrchestratorGeneratedPath(file) {
  const normalized = String(file || "").replace(/\\/g, "/");
  return /(^|\/)(\.project-orchestrator\.json|FICHE_PROJET\.md|INSTALLATION_FR\.md|CHANGELOG_FR\.md)$/i.test(normalized)
    || /^docs\/captures(?:\/|$)/i.test(normalized)
    || /(^|\/)AUDIT_(ARCHITECTURE|NETTOYAGE|OPTIMISATION|SECURITE)\.(md|json)$/i.test(normalized)
    || /(^|\/)PREPARATION_GITHUB\.(md|json)$/i.test(normalized)
    || /(^|\/)RAPPORT_(FONCTIONNALITE|REPARATION_FONCTIONNALITE)\.(md|json)$/i.test(normalized);
}
