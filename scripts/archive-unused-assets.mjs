import { existsSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  ensureDir,
  inferProjectStatus,
  loadRegistry,
  markdownTable,
  nowIso,
  orchestratorRoot,
  parseArgs,
  projectsFromArgs,
  relativeForReport,
  safeRename,
  saveRegistry,
  scanProject,
  slugify,
  stamp,
  toPosixPath,
  writeJson,
  writeReport,
  writeText
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const apply = Boolean(args.apply);
const includeDirectories = Boolean(args.includeDirectories);
const confidence = String(args.confidence || "SURE_ARCHIVE");
const refs = await projectsFromArgs(args);
const results = [];

for (const ref of refs) {
  const project = await scanProject(ref);
  if (project.name === "99_Archive" && !args.includeArchive) {
    results.push({
      project,
      generatedAt: nowIso(),
      mode: apply ? "apply" : "dry-run",
      status: "ARCHIVE_READ_ONLY",
      candidates: [],
      archived: [],
      skipped: [{ path: ".", reason: "archive-read-only" }]
    });
    continue;
  }
  const result = await archiveProject(project);
  results.push(result);
}

const registry = await loadRegistry();
for (const result of results) {
  const index = registry.projects.findIndex((project) => project.id === result.project.id);
  const base = index >= 0 ? registry.projects[index] : result.project;
  const next = {
    ...base,
    archiveStatus: result.status,
    lastArchiveRun: result.generatedAt,
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
  result.mode,
  result.status,
  result.candidates.length,
  result.archived.length,
  result.skipped.length
]);
const report = await writeReport(
  "cleanup",
  "archive-unused-assets-global",
  `# Archivage fichiers inutilises

- Date: ${nowIso()}
- Mode: ${apply ? "apply" : "dry-run"}
- Confiance cible: ${confidence}

${markdownTable(["Projet", "Mode", "Statut", "Candidats", "Archives", "Ignorés"], rows)}
`,
  { generatedAt: nowIso(), mode: apply ? "apply" : "dry-run", confidence, results }
);

console.log(`Archivage ${apply ? "applique" : "dry-run"} termine: ${results.length} projet(s).`);
console.log(`Rapport global: ${report.mdPath}`);

async function archiveProject(project) {
  const cleanupJson = join(project.path, "AUDIT_NETTOYAGE.json");
  const generatedAt = nowIso();
  if (!existsSync(cleanupJson)) {
    return {
      project,
      generatedAt,
      mode: apply ? "apply" : "dry-run",
      status: "NO_CLEANUP_AUDIT",
      candidates: [],
      archived: [],
      skipped: [{ path: cleanupJson, reason: "audit-nettoyage-json-manquant" }]
    };
  }

  const audit = JSON.parse(await readFile(cleanupJson, "utf8"));
  const allCandidates = Array.isArray(audit.candidates) ? audit.candidates : [];
  const candidates = allCandidates.filter((item) => item.confidence === confidence);
  const archiveRoot = join(orchestratorRoot, "archives", slugify(project.name), stamp());
  const archived = [];
  const skipped = [];

  for (const candidate of candidates) {
    const source = resolve(project.path, candidate.path);
    if (!source.startsWith(resolve(project.path))) {
      skipped.push({ path: candidate.path, reason: "hors-projet" });
      continue;
    }
    if (!existsSync(source)) {
      skipped.push({ path: candidate.path, reason: "introuvable" });
      continue;
    }
    if (candidate.type === "directory" && !includeDirectories) {
      skipped.push({ path: candidate.path, reason: "directory-requires-include-directories" });
      continue;
    }
    const target = join(archiveRoot, categoryFor(candidate), candidate.path);
    if (!apply) {
      archived.push({ path: candidate.path, target: toPosixPath(target), dryRun: true });
      continue;
    }
    await ensureDir(dirname(target));
    await safeRename(source, target);
    archived.push({ path: candidate.path, target: toPosixPath(target), dryRun: false });
  }

  if (apply || archived.length || skipped.length) {
    await ensureDir(archiveRoot);
    await writeJson(join(archiveRoot, "manifest.json"), {
      project: project.name,
      projectPath: project.path,
      generatedAt,
      mode: apply ? "apply" : "dry-run",
      confidence,
      includeDirectories,
      archived,
      skipped
    });
    await writeText(join(archiveRoot, "restore-instructions.md"), restoreInstructions(project, archived));
    if (existsSync(join(project.path, "AUDIT_NETTOYAGE.md"))) {
      await copyFile(join(project.path, "AUDIT_NETTOYAGE.md"), join(archiveRoot, "audit-nettoyage.md"));
    }
  }

  const status = apply
    ? archived.length ? "ARCHIVED" : "NO_ACTION"
    : archived.length ? "DRY_RUN_READY" : skipped.length ? "DRY_RUN_SKIPPED" : "NO_CANDIDATES";

  return {
    project,
    generatedAt,
    mode: apply ? "apply" : "dry-run",
    status,
    archiveRoot: toPosixPath(archiveRoot),
    candidates,
    archived,
    skipped
  };
}

function categoryFor(candidate) {
  const path = String(candidate.path).toLowerCase();
  if (/log/.test(path)) return "logs";
  if (/dist|build|\.next|out|cache|node_modules/.test(path)) return "builds";
  if (/\.(png|jpe?g|webp|svg|mp4|mov|avi)$/i.test(path)) return "assets-unused";
  if (/screenshot|capture/.test(path)) return "old-screenshots";
  if (/duplicate|duplicat/.test(path)) return "duplicates";
  return "outputs";
}

function restoreInstructions(project, archived) {
  return `# Restauration archive - ${project.name}

Pour restaurer un fichier, deplacer son chemin depuis l'archive vers:

\`${project.path}\`

Fichiers concernes:

${archived.length ? archived.map((item) => `- ${item.path} <- ${item.target}`).join("\n") : "- Aucun fichier deplace en mode dry-run."}

Apres restauration, relancer:

\`\`\`powershell
cd "${orchestratorRoot}"
npm run verify:functionality -- --project "${project.path}"
\`\`\`
`;
}
