import {
  defaultProjectsRoot,
  inferProjectStatus,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  saveRegistry,
  scanProject,
  toPosixPath,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const root = args.root || defaultProjectsRoot;
const projectRefs = await projectsFromArgs(args);
const scanned = [];

for (const project of projectRefs) {
  scanned.push(await scanProject(project));
}

const previous = await loadRegistry();
const projects = args.project
  ? [...(previous.projects || [])]
  : [];

for (const project of scanned) {
  const old = previous.projects?.find?.((item) => item.id === project.id) || {};
  const merged = {
    ...old,
    ...project,
    securityStatus: preserveStatus(old.securityStatus, project.securityStatus),
    functionalityStatus: preserveStatus(old.functionalityStatus, project.functionalityStatus),
    publicationStatus: preserveStatus(old.publicationStatus, project.publicationStatus),
    links: {
      ...(old.links || {}),
      ...(project.links || {})
    },
    screenshots: project.screenshots?.length ? project.screenshots : (old.screenshots || []),
    siteScreenshots: project.siteScreenshots?.length ? project.siteScreenshots : (old.siteScreenshots || []),
    siteThumbnail: project.siteThumbnail || old.siteThumbnail || null,
    screenshotStatus: old.screenshotStatus || project.screenshotStatus,
    publicScreenshotReview: old.publicScreenshotReview || project.publicScreenshotReview,
    reports: old.reports || {}
  };
  sortProjectScreenshots(merged);
  merged.status = inferProjectStatus(merged);
  const index = projects.findIndex((item) => item.id === merged.id);
  if (index >= 0) projects[index] = merged;
  else projects.push(merged);
}

projects.sort((a, b) => a.name.localeCompare(b.name, "fr"));

const registry = {
  generatedAt: nowIso(),
  root: toPosixPath(root),
  projects
};

await saveRegistry(registry);

const rows = projects.map((project) => [
  project.name,
  project.category,
  project.status,
  project.securityStatus,
  project.functionalityStatus,
  project.git.hasGit ? (project.git.dirty ? "git dirty" : "git ok") : "no git",
  project.hasPackageJson ? project.scripts.join(", ") || "package" : "no package"
]);

const markdown = `# Scan global projets

- Date: ${registry.generatedAt}
- Racine: \`${registry.root}\`
- Projets detectes: ${projects.length}

${markdownTable(
  ["Projet", "Categorie", "Statut", "Securite", "Fonctionnement", "Git", "Scripts"],
  rows
)}
`;

const report = await writeReport("global", "scan-projects", markdown, registry);
console.log(`Scan termine: ${projects.length} projet(s).`);
console.log(`Registre: config/projects.registry.json`);
console.log(`Rapport: ${report.mdPath}`);

function preserveStatus(previousStatus, nextStatus) {
  if (!previousStatus) return nextStatus;
  if (["UNKNOWN", "KNOWN_REPORT", "NEEDS_DOCUMENTATION"].includes(nextStatus)) return previousStatus;
  return nextStatus;
}

function sortProjectScreenshots(project) {
  project.screenshots = sortScreenshotList(project.screenshots);
  project.siteScreenshots = sortScreenshotList(project.siteScreenshots);
}

function sortScreenshotList(list = []) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((left, right) => {
    const rankDiff = screenshotRank(left) - screenshotRank(right);
    if (rankDiff) return rankDiff;
    return String(left || "").localeCompare(String(right || ""), "fr", {
      numeric: true,
      sensitivity: "base"
    });
  });
}

function screenshotRank(filePath) {
  const normalized = String(filePath || "").toLowerCase().replace(/\\/g, "/");
  const fileName = normalized.split("/").pop()?.replace(/\.[^.]+$/, "") || normalized;
  const tokens = fileName.split(/[^a-z0-9]+/).filter(Boolean);
  const order = new Map([
    ["cockpit", 10],
    ["commande", 10],
    ["command", 10],
    ["planning", 20],
    ["planif", 20],
    ["archives", 30],
    ["archive", 30],
    ["galva", 40],
    ["referentiels", 50],
    ["referentiel", 50],
    ["audit", 60],
    ["desktop", 70],
    ["mobile", 80]
  ]);
  for (const token of tokens.reverse()) {
    if (order.has(token)) return order.get(token);
  }
  return 100;
}
