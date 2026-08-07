import { existsSync } from "node:fs";
import { copyFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, extname, join, relative } from "node:path";
import {
  copyExistingFilesToBackup,
  ensureDir,
  gitStatus,
  markdownTable,
  nowIso,
  orchestratorRoot,
  parseArgs,
  projectsFromArgs,
  readJson,
  slugify,
  stamp,
  toPosixPath,
  walkFiles,
  writeJson,
  writeReport,
  writeText
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const backupRules = await readJson(join(orchestratorRoot, "config", "backup.rules.json"), {});
const projects = await projectsFromArgs(args);
const results = [];

for (const project of projects) {
  const git = await gitStatus(project.path);
  const files = filesForBackup(project, args);
  const result = {
    project,
    generatedAt: nowIso(),
    git,
    action: args.action || "status",
    mode: git.hasGit ? "git-status" : backupMode(git, files, args),
    filesRequested: files,
    backupRoot: null,
    backupZip: null,
    skippedReason: null
  };

  if (!git.hasGit && files.length) {
    const backup = await copyExistingFilesToBackup(project, files, String(args.action || "backup"));
    result.backupRoot = backup.backupRoot;
  }
  if (shouldCreateFullBackup(git, files, args)) {
    const backup = await createFullProjectBackup(project, String(args.action || "backup"));
    result.backupRoot = backup.backupRoot;
    result.backupZip = backup.zipPath;
    result.filesRequested = backup.manifest.files.map((item) => item.source);
    result.skippedReason = backup.manifest.warning || null;
  }

  results.push(result);
}

const rows = results.map((result) => [
  result.project.name,
  result.git.hasGit ? (result.git.dirty ? "git dirty" : "git ok") : "no git",
  result.mode,
  result.filesRequested.length,
  result.backupZip || result.backupRoot || "rapport seulement"
]);

const report = await writeReport(
  "global",
  "backup-guard",
  `# Backup guard

- Date: ${nowIso()}
- Action: ${args.action || "status"}

${markdownTable(["Projet", "Git", "Mode", "Fichiers", "Backup"], rows)}
`,
  { generatedAt: nowIso(), results }
);

console.log(`Backup guard termine: ${results.length} projet(s).`);
console.log(`Rapport: ${report.mdPath}`);

function filesForBackup(project, options) {
  if (options.docs) {
    return [
      "FICHE_PROJET.md",
      "INSTALLATION_FR.md",
      "CHANGELOG_FR.md",
      "AUDIT_SECURITE.md",
      "AUDIT_NETTOYAGE.md",
      "RAPPORT_FONCTIONNALITE.md",
      ".project-orchestrator.json"
    ].map((file) => join(project.path, file));
  }
  if (options.files) {
    return String(options.files)
      .split(";")
      .map((file) => file.trim())
      .filter(Boolean)
      .map((file) => join(project.path, file));
  }
  return [];
}

function backupMode(git, files, options) {
  if (git.hasGit) return "git-status";
  if (files.length) return "touched-files";
  if (shouldCreateFullBackup(git, files, options)) return "full-project-zip";
  return "status-only";
}

function shouldCreateFullBackup(git, files, options) {
  if (git.hasGit || files.length) return false;
  if (options.status) return false;
  if (options.full) return true;
  return Boolean(options.action && options.action !== "status");
}

async function createFullProjectBackup(project, action) {
  const fullRules = backupRules.fullBackup || {};
  const excludeDirs = new Set(backupRules.excludeDirectories || []);
  const excludeExts = new Set((backupRules.excludeExtensions || []).map((ext) => ext.toLowerCase()));
  const maxFiles = Number(fullRules.maxFiles || 5000);
  const maxTotalBytes = Number(fullRules.maxTotalBytes || 524288000);
  const backupRoot = join(orchestratorRoot, "backups", slugify(project.name), stamp(), action);
  const stagingRoot = join(backupRoot, "project-files");
  const zipPath = join(backupRoot, "backup.zip");
  await ensureDir(stagingRoot);

  const scan = await walkFiles(project.path, { maxFiles, skipDirs: excludeDirs });
  const candidates = scan.files
    .filter((item) => item.type === "file")
    .filter((item) => !excludeExts.has(extname(item.path).toLowerCase()));

  let totalBytes = 0;
  const copied = [];
  let warning = scan.truncated ? `Scan tronque a ${maxFiles} fichiers.` : "";

  for (const item of candidates) {
    if (totalBytes + item.size > maxTotalBytes) {
      warning = `Limite backup atteinte (${maxTotalBytes} octets).`;
      break;
    }
    const rel = relative(project.path, item.path);
    const destination = join(stagingRoot, rel);
    await ensureDir(dirname(destination));
    await copyFile(item.path, destination);
    totalBytes += item.size;
    copied.push({
      source: item.path,
      relativePath: toPosixPath(rel),
      size: item.size
    });
  }

  const manifest = {
    project: project.name,
    projectPath: project.path,
    action,
    createdAt: nowIso(),
    mode: "full-project-zip",
    backupRoot,
    zipPath,
    stagingRoot,
    files: copied,
    fileCount: copied.length,
    totalBytes,
    skippedDirectories: [...excludeDirs],
    skippedExtensions: [...excludeExts],
    warning
  };

  await writeJson(join(backupRoot, "manifest.json"), manifest);
  await writeText(join(backupRoot, "files-touched.txt"), copied.map((item) => item.relativePath).join("\n") + "\n");
  await writeText(join(backupRoot, "git-status-before.md"), `# Git status before backup

- Projet: ${project.name}
- Git: NO_GIT
- Date: ${manifest.createdAt}
`);
  await writeText(join(backupRoot, "restore-instructions.md"), `# Restauration backup - ${project.name}

Archive: \`${zipPath}\`

Pour restaurer:

\`\`\`powershell
Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${project.path}" -Force
\`\`\`

Verifier ensuite:

\`\`\`powershell
cd "${orchestratorRoot}"
npm run verify:functionality -- --project "${project.path}"
\`\`\`
`);

  if (fullRules.createZip !== false && copied.length) {
    await compressDirectory(stagingRoot, zipPath);
    if (fullRules.removeStagingAfterZip !== false) await rm(stagingRoot, { recursive: true, force: true });
  }

  return { backupRoot, zipPath: existsSync(zipPath) ? zipPath : null, manifest };
}

function compressDirectory(sourceDir, zipPath) {
  const sourceGlob = `${sourceDir}\\*`;
  const command = [
    "Compress-Archive",
    "-Path",
    psQuote(sourceGlob),
    "-DestinationPath",
    psQuote(zipPath),
    "-Force"
  ].join(" ");
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("powershell", ["-NoProfile", "-Command", command], { windowsHide: true, timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        rejectPromise(error);
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
