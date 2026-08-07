import { basename, extname, join } from "node:path";
import {
  inferProjectStatus,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  relativeForReport,
  saveRegistry,
  scanProject,
  toPosixPath,
  walkFiles,
  writeJson,
  writeReport,
  writeText
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const projects = await projectsFromArgs(args);
const results = [];

for (const projectRef of projects) {
  if (projectRef.name === "99_Archive" && !args.includeArchive) {
    results.push({
      project: await scanProject(projectRef),
      generatedAt: nowIso(),
      dryRun: true,
      candidates: [],
      truncated: false,
      reportPath: null,
      skipped: "ARCHIVE_READ_ONLY"
    });
    continue;
  }
  const project = await scanProject(projectRef);
  const audit = await auditCleanup(project);
  results.push(audit);
  await writeProjectCleanupReport(audit);
}

const registry = await loadRegistry();
for (const audit of results) {
  const index = registry.projects.findIndex((project) => project.id === audit.project.id);
  const base = index >= 0 ? registry.projects[index] : audit.project;
  const next = {
    ...base,
    cleanupStatus: audit.candidates.length ? "DRY_RUN_CANDIDATES" : "OK",
    reports: {
      ...(base.reports || {}),
      ...(audit.reportPath ? { cleanup: toPosixPath(audit.reportPath) } : {})
    },
    updatedAt: nowIso()
  };
  next.status = inferProjectStatus(next);
  if (index >= 0) registry.projects[index] = next;
  else registry.projects.push(next);
}
registry.generatedAt = nowIso();
await saveRegistry(registry);

const rows = results.map((result) => [
  result.project.name,
  result.candidates.length,
  result.candidates.filter((item) => item.confidence === "SURE_ARCHIVE").length,
  result.candidates.filter((item) => item.confidence === "PROBABLE_ARCHIVE").length
]);
const report = await writeReport(
  "cleanup",
  "audit-cleanup-global",
  `# Audit nettoyage global

- Date: ${nowIso()}
- Mode: dry-run uniquement

${markdownTable(["Projet", "Candidats", "SURE_ARCHIVE", "PROBABLE_ARCHIVE"], rows)}
`,
  { generatedAt: nowIso(), results }
);
console.log(`Audit nettoyage dry-run termine: ${results.length} projet(s).`);
console.log(`Rapport global: ${report.mdPath}`);

async function auditCleanup(project) {
  const candidates = [];
  const files = await walkFiles(project.path, { maxFiles: 12000, includeSkippedDirs: true });
  for (const item of files.files) {
    const rel = relativeForReport(project.path, item.path);
    const lowerRel = rel.toLowerCase();
    const base = basename(item.path).toLowerCase();
    const ext = extname(item.path).toLowerCase();
    if (item.skipped && /node_modules|\.cache|dist|build|\.next|out|coverage/.test(lowerRel)) {
      candidates.push({ path: rel, type: "directory", confidence: "SURE_ARCHIVE", reason: "dossier genere ou cache detecte" });
      continue;
    }
    if ([".log", ".tmp"].includes(ext) || base.endsWith(".bak")) {
      candidates.push({ path: rel, type: "file", confidence: "PROBABLE_ARCHIVE", reason: "fichier temporaire ou log" });
      continue;
    }
    if (ext === ".zip" && !project.name.toLowerCase().includes("archive")) {
      candidates.push({ path: rel, type: "file", confidence: "PROBABLE_ARCHIVE", reason: "archive locale a verifier avant conservation" });
      continue;
    }
    if (item.size > 50 * 1024 * 1024 && [".mp4", ".mov", ".zip", ".psd", ".blend"].includes(ext)) {
      candidates.push({ path: rel, type: "file", confidence: "A_VERIFIER", reason: "fichier lourd" });
    }
  }
  return {
    project,
    generatedAt: nowIso(),
    dryRun: true,
    candidates,
    truncated: files.truncated,
    reportPath: join(project.path, "AUDIT_NETTOYAGE.md")
  };
}

async function writeProjectCleanupReport(audit) {
  const rows = audit.candidates.map((item) => [item.confidence, item.type, item.path, item.reason]);
  const body = `# Audit nettoyage - ${audit.project.name}

- Date: ${audit.generatedAt}
- Projet: \`${audit.project.path}\`
- Mode: **dry-run**

${rows.length ? markdownTable(["Confiance", "Type", "Chemin", "Raison"], rows) : "Aucun candidat de nettoyage detecte par la V1."}

## Regle

Aucun fichier n'est supprime par cet audit. Toute action reelle doit passer par sauvegarde, archive et verification.
`;
  await writeText(audit.reportPath, body);
  await writeJson(join(audit.project.path, "AUDIT_NETTOYAGE.json"), {
    generatedAt: audit.generatedAt,
    dryRun: true,
    candidates: audit.candidates
  });
}
