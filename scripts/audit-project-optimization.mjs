import { extname, join } from "node:path";
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
const projectRefs = await projectsFromArgs(args);
const results = [];

for (const projectRef of projectRefs) {
  const project = await scanProject(projectRef);
  if (project.name === "99_Archive" && !args.includeArchive) {
    results.push({
      project,
      generatedAt: nowIso(),
      status: "ARCHIVE_READ_ONLY",
      recommendations: [],
      reportPath: null,
      skipped: "ARCHIVE_READ_ONLY"
    });
    continue;
  }
  const audit = await auditOptimization(project);
  results.push(audit);
  await writeProjectOptimizationReport(audit);
}

const registry = await loadRegistry();
for (const audit of results) {
  const index = registry.projects.findIndex((project) => project.id === audit.project.id);
  const base = index >= 0 ? registry.projects[index] : audit.project;
  const next = {
    ...base,
    optimizationStatus: audit.status,
    reports: {
      ...(base.reports || {}),
      ...(audit.reportPath ? { optimization: toPosixPath(audit.reportPath) } : {})
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
  result.status,
  result.recommendations?.length || 0,
  result.recommendations?.slice(0, 2).map((item) => item.title).join("; ") || result.skipped || "-"
]);
const report = await writeReport(
  "optimization",
  "audit-optimization-global",
  `# Audit optimisation global

- Date: ${nowIso()}
- Mode: analyse uniquement

${markdownTable(["Projet", "Statut", "Pistes", "Exemples"], rows)}
`,
  { generatedAt: nowIso(), results }
);

console.log(`Audit optimisation termine: ${results.length} projet(s).`);
console.log(`Rapport global: ${report.mdPath}`);

async function auditOptimization(project) {
  const files = await walkFiles(project.path, { maxFiles: 12000, includeSkippedDirs: true });
  const fileItems = files.files.filter((item) => item.type === "file");
  const skipped = files.files.filter((item) => item.skipped);
  const recommendations = [];

  const largeFiles = fileItems
    .filter((item) => item.size > 10 * 1024 * 1024)
    .map((item) => ({ path: relativeForReport(project.path, item.path), size: item.size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 12);
  if (largeFiles.length) {
    recommendations.push({
      priority: "medium",
      title: "Verifier les fichiers lourds",
      details: largeFiles.map((item) => `${item.path} (${Math.round(item.size / 1024 / 1024)} MB)`)
    });
  }

  const generatedDirs = skipped.map((item) => relativeForReport(project.path, item.path)).filter((path) => /node_modules|dist|build|\.next|out|coverage|\.cache/.test(path));
  if (generatedDirs.length) {
    recommendations.push({
      priority: "low",
      title: "Exclure les dossiers generes des audits et publications",
      details: generatedDirs.slice(0, 12)
    });
  }

  if (project.hasPackageJson && !project.scripts.includes("build") && !project.scripts.includes("test") && !project.scripts.includes("lint")) {
    recommendations.push({
      priority: "medium",
      title: "Ajouter au moins une commande de verification",
      details: ["Aucun script build/test/lint detecte."]
    });
  }

  const imageCount = fileItems.filter((item) => [".png", ".jpg", ".jpeg"].includes(extname(item.path).toLowerCase())).length;
  const webpCount = fileItems.filter((item) => extname(item.path).toLowerCase() === ".webp").length;
  if (imageCount > 20 && webpCount < imageCount / 3) {
    recommendations.push({
      priority: "low",
      title: "Optimiser les images vers WebP quand c'est public",
      details: [`Images PNG/JPG: ${imageCount}`, `Images WebP: ${webpCount}`]
    });
  }

  if (!project.docs.securityAudit || !project.docs.functionalityReport) {
    recommendations.push({
      priority: "high",
      title: "Completer les rapports de base",
      details: ["AUDIT_SECURITE.md et RAPPORT_FONCTIONNALITE.md doivent exister avant diffusion."]
    });
  }

  const status = recommendations.some((item) => item.priority === "high")
    ? "NEEDS_ACTION"
    : recommendations.length
      ? "HAS_RECOMMENDATIONS"
      : "OK";

  return {
    project,
    generatedAt: nowIso(),
    status,
    recommendations,
    summary: {
      scannedFiles: fileItems.length,
      truncated: files.truncated
    },
    reportPath: join(project.path, "AUDIT_OPTIMISATION.md")
  };
}

async function writeProjectOptimizationReport(audit) {
  const rows = audit.recommendations.map((item) => [
    item.priority,
    item.title,
    item.details.join("; ")
  ]);
  const body = `# Audit optimisation - ${audit.project.name}

- Date: ${audit.generatedAt}
- Projet: \`${audit.project.path}\`
- Statut: **${audit.status}**
- Fichiers analyses: ${audit.summary.scannedFiles}

${rows.length ? markdownTable(["Priorite", "Piste", "Details"], rows) : "Aucune piste d'optimisation detectee par la V1."}

## Regle

Cet audit ne modifie rien. Les optimisations doivent rester compatibles multi-projets et etre verifiees apres action.
`;
  await writeText(audit.reportPath, body);
  await writeJson(join(audit.project.path, "AUDIT_OPTIMISATION.json"), {
    generatedAt: audit.generatedAt,
    status: audit.status,
    recommendations: audit.recommendations,
    summary: audit.summary
  });
}
