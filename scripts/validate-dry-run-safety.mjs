import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  markdownTable,
  nowIso,
  orchestratorRoot,
  readJson,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const scriptsRoot = join(orchestratorRoot, "scripts");
const packageJson = await readJson(join(orchestratorRoot, "package.json"), {});
const conpetancesPackage = await readJson(join(orchestratorRoot, "..", "..", "Conpetances", "package.json"), {});
const texts = await readRequiredTexts([
  "audit-project-cleanup.mjs",
  "archive-unused-assets.mjs",
  "verify-project-functionality.mjs",
  "repair-project-functionality.mjs",
  "github-prepare-public-repo.mjs",
  "github-generate-readme-fr.mjs",
  "github-sync-project.mjs",
  "validate-publication-gates.mjs",
  "validate-hostinger-gates.mjs",
  "capture-project-screenshots.mjs",
  "lib/automation-runner.mjs",
  "../dashboard/server.mjs"
]);
const allScriptTexts = await readAllScripts();
const checks = [];

check(
  "Script safety:check disponible",
  packageJson.scripts?.["safety:check"] === "node scripts/validate-dry-run-safety.mjs" && existsSync(join(scriptsRoot, "validate-dry-run-safety.mjs")),
  packageJson.scripts?.["safety:check"] || "absent"
);
check(
  "Relais Conpetances safety disponible",
  conpetancesPackage.scripts?.["orchestrator:safety-check"] === "node ../Projet/00_ORCHESTRATEUR/scripts/validate-dry-run-safety.mjs",
  conpetancesPackage.scripts?.["orchestrator:safety-check"] || "absent"
);

check(
  "Audit nettoyage reste dry-run uniquement",
  includesAll(texts["audit-project-cleanup.mjs"], [
    "Mode: dry-run uniquement",
    "dryRun: true",
    "Aucun fichier n'est supprime par cet audit"
  ]) && excludesAll(texts["audit-project-cleanup.mjs"], ["safeRename(", "unlink(", "rm(", "rmdir(", "execFile(", "spawn("]),
  "audit-project-cleanup.mjs"
);
check(
  "Archivage demande --apply pour deplacer",
  includesAll(texts["archive-unused-assets.mjs"], [
    "const apply = Boolean(args.apply);",
    "if (!apply)",
    "await safeRename(source, target);",
    "mode: apply ? \"apply\" : \"dry-run\""
  ]),
  "archive-unused-assets.mjs"
);
check(
  "Archivage de dossiers demande un second accord",
  includesAll(texts["archive-unused-assets.mjs"], [
    "const includeDirectories = Boolean(args.includeDirectories);",
    "candidate.type === \"directory\" && !includeDirectories",
    "directory-requires-include-directories"
  ]),
  "archive-unused-assets.mjs --include-directories"
);
check(
  "Verification fonctionnement dry-run par defaut",
  includesAll(texts["verify-project-functionality.mjs"], [
    "const shouldRun = Boolean(args.run);",
    "non, dry-run",
    "Relancer avec --run"
  ]),
  "verify-project-functionality.mjs --run requis pour executer"
);
check(
  "Reparation fonctionnalite diagnostic seulement",
  includesAll(texts["repair-project-functionality.mjs"], [
    "mode: \"dry-run\"",
    "Ce script ne modifie pas le code",
    "Actions proposees"
  ]) && excludesAll(texts["repair-project-functionality.mjs"], ["copyExistingFilesToBackup", "safeRename(", "spawn(", "execFile("]),
  "repair-project-functionality.mjs"
);
check(
  "Preparation GitHub applique seulement avec --apply",
  includesAll(texts["github-prepare-public-repo.mjs"], [
    "const apply = Boolean(args.apply);",
    "if (shouldApply && status !== \"BLOCKED\")",
    "Aucun push automatique",
    "Publication: aucune publication ni push"
  ]) && noPushOrDeployExecutor(texts["github-prepare-public-repo.mjs"]),
  "github-prepare-public-repo.mjs"
);
check(
  "README GitHub applique seulement avec --apply",
  includesAll(texts["github-generate-readme-fr.mjs"], [
    "const apply = Boolean(args.apply);",
    "if (apply && !blockers.length)",
    "Push GitHub: non"
  ]) && noPushOrDeployExecutor(texts["github-generate-readme-fr.mjs"]),
  "github-generate-readme-fr.mjs"
);
check(
  "Synchronisation GitHub sans effet externe",
  includesAll(texts["github-sync-project.mjs"], [
    "Effet externe: aucun",
    "Publication automatique: non",
    "Aucun push automatique en V1"
  ]) && excludesAll(texts["github-sync-project.mjs"], ["node:child_process", "git push", "gh repo", "gh pr"]),
  "github-sync-project.mjs"
);
check(
  "Porte publication rapport seulement",
  includesAll(texts["validate-publication-gates.mjs"], [
    "Effet externe: aucun",
    "aucun push, aucune publication"
  ]) && noPushOrDeployExecutor(texts["validate-publication-gates.mjs"]),
  "validate-publication-gates.mjs"
);
check(
  "Porte Hostinger sans deploiement automatique",
  includesAll(texts["validate-hostinger-gates.mjs"], [
    "Publication reelle: non",
    "Aucun deploiement Hostinger automatique",
    "MCP Hostinger"
  ]) && noPushOrDeployExecutor(texts["validate-hostinger-gates.mjs"]),
  "validate-hostinger-gates.mjs"
);
check(
  "Captures exige drapeau et securite OK_PUBLIC",
  includesAll(texts["capture-project-screenshots.mjs"], [
    "const capture = Boolean(args.capture);",
    "capture ? await captureProject(project) : inventoryProject(project)",
    "project.securityStatus !== \"OK_PUBLIC\"",
    "SKIPPED_SECURITY"
  ]),
  "capture-project-screenshots.mjs --capture + OK_PUBLIC"
);
check(
  "Dashboard lance seulement les modes prudents",
  includesAll(texts["../dashboard/server.mjs"], [
    "archive: [\"archive\", [\"--all\"]]",
    "screenshots: [\"screenshots\", [\"--all\"]]",
    "github: [\"github\", [\"--all\"]]",
    "githubSync: [\"githubSync\", [\"--all\"]]"
  ]) && excludesAll(texts["../dashboard/server.mjs"], ["\"--apply\"", "\"--capture\""]),
  "dashboard/globalActions sans apply/capture"
);
check(
  "Routines automatiques sans apply ni capture",
  excludesAll(texts["lib/automation-runner.mjs"], ["\"--apply\"", "\"--capture\""]) && includesAll(texts["lib/automation-runner.mjs"], [
    "\"cleanup:archive\"",
    "\"github:prepare\"",
    "\"github:sync\""
  ]),
  "daily/weekly/monthly"
);

const dangerousHits = findDangerousExecutablePatterns(allScriptTexts);
check(
  "Aucune commande push/deploy/destruction directe detectee",
  dangerousHits.length === 0,
  dangerousHits.join("; ") || "aucune"
);

const failures = checks.filter((item) => item.status === "FAIL");
const globalStatus = failures.length ? "FAIL" : "OK";
const report = await writeReport(
  "safety",
  "validate-dry-run-safety",
  `# Validation mode dry-run et non-publication

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Regle V1: pas de suppression directe, pas de push, pas de deploiement, pas de capture publique sensible sans garde explicite.

${markdownTable(["Controle", "Statut", "Preuve"], checks.map((item) => [item.label, item.status, item.evidence]))}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    failures: failures.length,
    checks
  }
);

console.log(`Validation dry-run/non-publication: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (failures.length) process.exitCode = 1;

function check(label, condition, evidence) {
  checks.push({
    label,
    status: condition ? "OK" : "FAIL",
    evidence: String(evidence || "")
  });
}

async function readRequiredTexts(files) {
  const result = {};
  for (const file of files) {
    result[file] = await safeRead(join(scriptsRoot, file));
  }
  return result;
}

async function readAllScripts() {
  const files = [];
  await visit(scriptsRoot);
  return files;

  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git"].includes(entry.name)) continue;
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
      if (entry.name === "validate-dry-run-safety.mjs") continue;
      files.push({
        name: basename(fullPath),
        path: fullPath,
        text: await safeRead(fullPath)
      });
    }
  }
}

async function safeRead(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function includesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function excludesAll(text, needles) {
  return needles.every((needle) => !text.includes(needle));
}

function noPushOrDeployExecutor(text) {
  return !/(execFile|exec|spawn)\s*\([^)]*(git\s+push|gh\s+(repo|pr|release)|npm\s+publish|deploy|publish|upload)/is.test(text);
}

function findDangerousExecutablePatterns(items) {
  const hits = [];
  for (const item of items) {
    const text = item.text;
    if (/(execFile|exec|spawn)\s*\([^)]*(git\s+push|gh\s+(repo|pr|release)|npm\s+publish|firebase\s+deploy|netlify\s+deploy|vercel\s+deploy)/is.test(text)) {
      hits.push(`${item.name}:push-or-deploy-executor`);
    }
    if (!/^validate-/.test(item.name) && /\b(deployHostinger|publishHostinger|uploadHostinger)\s*\(/.test(text)) {
      hits.push(`${item.name}:hostinger-deploy-function`);
    }
    const deleteHit = /\b(unlink|rm|rmdir)\s*\(/.test(text);
    const allowedBackupStagingCleanup = item.name === "git-backup-guard.mjs"
      && text.includes("await rm(stagingRoot, { recursive: true, force: true })")
      && text.includes("backupRoot");
    const allowedPublicationStagingCleanup = item.name === "publish-site-ma-methode.mjs"
      && text.includes("await rm(outputRoot, { recursive: true, force: true })")
      && text.includes("defaultSiteRoot")
      && text.includes("\"output\", \"hostinger\"")
      && text.includes("Output hors zone autorisee");
    const validatorPatternList = item.name.startsWith("validate-")
      && (text.includes("FORBIDDEN_WRITE_PATTERNS") || text.includes("const destructivePatterns"));
    if (deleteHit && !allowedBackupStagingCleanup && !allowedPublicationStagingCleanup && !validatorPatternList) {
      hits.push(`${item.name}:direct-delete-api`);
    }
  }
  return hits;
}
