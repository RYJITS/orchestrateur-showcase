import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  gitStatus,
  loadRegistry,
  parseArgs
} from "../scripts/lib/orchestrator-utils.mjs";
import {
  displayName,
  githubUrlForProject,
  publicUrlForProject
} from "../scripts/lib/project-content.mjs";
import {
  alignedMarkdownTable,
  automationPaths,
  latestJsonReport,
  nowIso,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { resultsRoot } = automationPaths(import.meta.url);
const args = parseArgs();
const registry = await loadRegistry();
const allVisibleProjects = (registry.projects || []).filter((project) =>
  project.id !== "99-archive" && project.name !== "99_Archive" && project.category !== "archive"
);
const visibleProjects = selectProjects(allVisibleProjects);

const reports = {
  pilot: await latest("00-pilote-automatisations"),
  scan: await latest("01-scan-etat-projets"),
  executeurProjects: await latest("00-executeur-projets"),
  preparationGit: await latest("04-preparation-git-public"),
  corrections: await latest("05-verification-statuts-publication"),
  githubPublic: await latest("06-deploiement-repos-github-public"),
  fiches: await latest("07-fiches-et-vignettes-ma-methode"),
  hostingerPublication: await latest("08-publication-hostinger")
};

const scanByDisplay = new Map(
  (reports.scan?.data?.projectSummary?.projectRows || []).map((row) => [normalize(row[0]), row])
);
const actionsByProject = groupByProject(reports.corrections?.data?.actions || []);
const preparationByProject = new Map(
  (reports.preparationGit?.data?.preparations || []).map((item) => [item.project?.name, item])
);
const deploymentByProject = new Map(
  (reports.githubPublic?.data?.preparations || []).map((item) => [item.project?.name, item])
);
const publicationByProject = new Map(
  (reports.githubPublic?.data?.publications || []).map((item) => [item.project, item])
);
const ficheByProject = ficheStateByProject();

const rows = await Promise.all(visibleProjects.map(projectSummary));
const counts = rows.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1;
  return acc;
}, {});
const globalStatus = rows.some((row) => row.status === "BLOQUE")
  ? "A_CORRIGER"
  : rows.some((row) => row.status === "A_REVOIR")
    ? "A_REVOIR"
    : "OK";

const report = await writeAutomationReport(
  resultsRoot,
  "00-rapport-workflow-projets",
  renderMarkdown(),
  {
    generatedAt: nowIso(),
    action: "00-rapport-workflow-projets",
    globalStatus,
    counts,
    sources: sourceRows(),
    projects: rows
  }
);

console.log(`Rapport workflow projets: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);

async function projectSummary(project) {
  const title = displayName(project.name);
  const scan = scanByDisplay.get(normalize(title)) || [];
  const currentGit = project.path ? await gitStatus(project.path) : null;
  const currentGitLabel = currentGit?.hasGit
    ? (currentGit.dirty ? "GIT avec changements" : "GIT propre")
    : scan[2] || "-";
  const github = preparationByProject.get(project.name) || deploymentByProject.get(project.name) || null;
  const githubPublication = publicationByProject.get(project.name) || null;
  const githubPublished = githubPublication?.status === "OK";
  const githubReady = github?.status === "READY_GITHUB_PUBLIC";
  const githubPrivateShowcaseReady = github?.status === "READY_GITHUB_PRIVATE_SHOWCASE";
  const githubPrivateShowcasePublished = githubPublished && Boolean(githubPublication?.privateRepository || githubPublication?.showcaseRepository);
  const projectGithubUrl = githubUrlForProject(project) || githubPublication?.showcaseRepository || githubPublication?.repository || "";
  const fiche = ficheByProject.get(project.name) || null;
  const actions = actionsByProject.get(project.name) || [];
  const files = generatedPublicFiles(project);
  const nonPublic = isNonPublicProject(project);
  const done = [];
  const fixes = [];

  if (scan[3] === "OK" || fiche?.localFiche) done.push("fiche locale OK");
  if (scan[4] === "OK" || fiche?.siteFiche) done.push("fiche site OK");
  if (scan[5] === "OK") done.push("carte Ma Methode OK");
  if (fiche?.thumbnail?.exists || project.siteThumbnail) done.push("vignette OK");
  if (files.publicReadme && files.publicPlan) done.push("preparation GitHub publique ecrite");
  if (files.privateReadme && files.privatePlan && files.showcaseReadme && files.showcasePlan) done.push("preparation GitHub prive + vitrine ecrite");
  if (reports.pilot?.data?.projectTest?.project?.name === project.name && reports.pilot?.data?.projectTest?.status === "OK") {
    done.push("test reel pilote OK");
  }
  if (publicUrlForProject(project)) done.push("lien public detecte");
  if (githubPublished) done.push(`publication GitHub OK: ${githubPublication.repository}`);
  if (githubPrivateShowcasePublished) done.push("depot GitHub prive et vitrine publique publies");
  if (projectGithubUrl) done.push("depot GitHub detecte");
  if (reports.hostingerPublication?.data?.globalStatus === "READY_MCP_HOSTINGER") done.push("publication Hostinger prete pour MCP");
  if (reports.hostingerPublication?.data?.globalStatus === "ARCHIVE_HOSTINGER_PRETE") done.push("archive Hostinger prete");
  if (nonPublic && githubPrivateShowcaseReady) done.push("pret pour GitHub prive + vitrine");

  if (String(project.securityStatus || "").startsWith("FAIL")) {
    fixes.push(`corriger securite: ${project.securityStatus}`);
  }
  if (github?.actions?.length && !githubPublished && !githubReady && !githubPrivateShowcaseReady) {
    fixes.push(...github.actions.filter((item) => !/preparation.*prete/i.test(item)).slice(0, 4));
  }
  if (!nonPublic || githubPrivateShowcaseReady || githubPrivateShowcasePublished) {
    for (const action of actions.slice(0, 5)) {
      if (githubPublished && /^github$/i.test(action.family || "")) continue;
      if (githubReady && /^github$/i.test(action.family || "")) continue;
      if (githubPrivateShowcaseReady && /^github$/i.test(action.family || "")) continue;
      if (isCoveredHostingerBuildAction(action, github)) continue;
      fixes.push(`${action.family}: ${action.action}`);
    }
  }
  if (!nonPublic && !projectGithubUrl && project.securityStatus === "OK_PUBLIC" && !/PRIVATE|ARCHIVE/.test(`${project.status} ${project.publicationStatus}`)) {
    fixes.push("creer/relier le depot GitHub public apres validation");
  }
  if (!nonPublic && githubPublished && currentGit?.dirty) {
    fixes.push("revoir les changements locaux restants apres publication");
  }
  if (!nonPublic && !files.publicReadme && project.securityStatus === "OK_PUBLIC") fixes.push("generer README_GITHUB_PUBLIC.md via tache 04");
  if (!nonPublic && fiche?.action && fiche.action !== "OK" && !isStaleMediaAction(fiche.action, project)) fixes.push(fiche.action);
  if (!nonPublic && reports.hostingerPublication?.data?.globalStatus === "FAIL") fixes.push("corriger la tache 08 publication Hostinger");

  const uniqueFixes = unique(fixes).slice(0, 7);
  const status = String(project.securityStatus || "").startsWith("FAIL") || github?.status?.startsWith?.("BLOQUE")
    ? "BLOQUE"
    : uniqueFixes.length
      ? "A_REVOIR"
      : "OK";

  return {
    id: project.id,
    project: title,
    sourceName: project.name,
    section: scan[1] || project.siteCategory || project.category || "tools",
    status,
    security: project.securityStatus || "UNKNOWN",
    functionality: project.functionalityStatus || "UNKNOWN",
    publication: project.publicationStatus || project.status || "UNKNOWN",
    git: currentGitLabel,
    github: githubPrivateShowcasePublished
      ? `PRIVE+VITRINE: ${githubPublication.showcaseRepository || githubPublication.repository}`
      : githubPublished
        ? `PUBLIE: ${githubPublication.repository}`
        : github?.status || scan[6] || "-",
    publicUrl: publicUrlForProject(project) || "",
    githubUrl: projectGithubUrl,
    siteThumbnail: project.siteThumbnail || "",
    documentation: docStatus(scan, fiche),
    done: done.length ? unique(done).join("; ") : "-",
    toFix: uniqueFixes.length ? uniqueFixes.join("; ") : "Aucune correction immediate",
    publicFiles: files
  };
}

function isNonPublicProject(project) {
  const text = `${project.securityStatus || ""} ${project.status || ""} ${project.publicationStatus || ""}`.toUpperCase();
  return /OK_PRIVATE|PRIVATE_INTERNAL|ARCHIVE_ONLY/.test(text);
}

function ficheStateByProject() {
  const map = new Map(
    (reports.fiches?.data?.afterSummary?.details || reports.fiches?.data?.beforeSummary?.details || [])
      .map((item) => [item.project, item])
  );
  const execution = reports.executeurProjects?.data || {};
  const ranFicheWorkflow = (execution.actions || []).some((action) =>
    ["fiches", "captures", "thumbnails", "site"].includes(String(action || "").toLowerCase())
  );
  if (!ranFicheWorkflow) return map;
  for (const result of execution.projectResults || []) {
    const statuses = (result.actions || []).map((action) => String(action.status || "").toUpperCase());
    const hasFailure = statuses.some((status) => ["FAIL", "BLOCKED", "BLOQUE"].includes(status));
    const previous = map.get(result.project) || {};
    map.set(result.project, {
      ...previous,
      project: result.project,
      action: hasFailure ? previous.action || "verifier la tache 07" : "OK",
      sourceAction00: reports.executeurProjects?.path || null
    });
  }
  return map;
}

function isCoveredHostingerBuildAction(action, preparation) {
  if (!/^hostinger$/i.test(action.family || "")) return false;
  if (!/build|npm run build|vite/i.test(action.action || "")) return false;
  return preparation?.status === "READY_GITHUB_PUBLIC" && preparation?.localInstall?.buildCommand;
}

function isStaleMediaAction(action, project) {
  if (!/conserver medias publics prudents/i.test(action || "")) return false;
  return project.securityStatus === "OK_PUBLIC";
}

function generatedPublicFiles(project) {
  return {
    publicReadme: existsSync(join(project.path, "README_GITHUB_PUBLIC.md")),
    publicPlan: existsSync(join(project.path, "PREPARATION_GITHUB_PUBLIC.md")),
    publicJson: existsSync(join(project.path, "PREPARATION_GITHUB_PUBLIC.json")),
    privateReadme: existsSync(join(project.path, "README_GITHUB_PRIVATE.md")),
    privatePlan: existsSync(join(project.path, "PREPARATION_GITHUB_PRIVATE.md")),
    showcaseReadme: existsSync(join(project.path, "README_GITHUB_SHOWCASE.md")),
    showcasePlan: existsSync(join(project.path, "PREPARATION_GITHUB_SHOWCASE.md"))
  };
}

function docStatus(scan, fiche) {
  const local = scan[3] === "OK" || fiche?.localFiche ? "fiche locale" : "";
  const site = scan[4] === "OK" || fiche?.siteFiche ? "fiche site" : "";
  const card = scan[5] === "OK" ? "carte" : "";
  const parts = [local, site, card].filter(Boolean);
  return parts.length ? parts.join(" + ") : "a completer";
}

function groupByProject(actions) {
  const map = new Map();
  for (const action of actions) {
    const key = action.project || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(action);
  }
  return map;
}

function renderMarkdown() {
  return `# Rapport workflow par projet

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Projets analyses: ${rows.length}
- OK: ${counts.OK || 0}
- A revoir: ${counts.A_REVOIR || 0}
- Bloques: ${counts.BLOQUE || 0}
- Prives/vitrines: ${rows.filter((row) => /PRIVATE|PRIVE|VITRINE|SHOWCASE/.test(`${row.publication} ${row.github}`)).length}

## Sources utilisees

${alignedMarkdownTable(["Source", "Statut", "Rapport"], sourceRows())}

## Vue projet

${alignedMarkdownTable(
    ["Projet", "Section", "Statut", "Securite", "Publication", "GitHub"],
    rows.map((row) => [row.project, row.section, row.status, row.security, row.publication, row.github])
  )}

## Fait / A corriger

${alignedMarkdownTable(
    ["Projet", "Fait", "A corriger"],
    rows.map((row) => [row.project, trimText(row.done, 260), trimText(row.toFix, 360)])
  )}

## Documentation et Git

${alignedMarkdownTable(
    ["Projet", "Documentation", "Git local", "Fichiers publics 06"],
    rows.map((row) => [
      row.project,
      row.documentation,
      row.git,
      [
        row.publicFiles.publicReadme ? "README" : "README manquant",
        row.publicFiles.publicPlan ? "plan MD" : "plan MD manquant",
        row.publicFiles.publicJson ? "plan JSON" : "plan JSON manquant",
        row.publicFiles.privateReadme ? "README prive" : "",
        row.publicFiles.showcaseReadme ? "README vitrine" : ""
      ].join(", ")
    ])
  )}

## Lecture rapide

- \`OK\`: les pieces principales connues sont en place.
- \`A_REVOIR\`: une action manuelle ou une decision de publication reste necessaire.
- \`BLOQUE\`: securite ou publication publique bloquee avant toute diffusion.
- Les projets prives/interne passent par GitHub prive + vitrine publique nettoyee quand l'audit est OK_PRIVATE ou OK_PUBLIC.
- Ce rapport ne publie rien et ne modifie aucun depot GitHub.
`;
}

function sourceRows() {
  return [
    ["00 pilote", reports.pilot?.data?.globalStatus || "MANQUE", reports.pilot?.path || "-"],
    ["01 scan", reports.scan?.data?.globalStatus || "MANQUE", reports.scan?.path || "-"],
    ["04 preparation Git", reports.preparationGit?.data?.globalStatus || "MANQUE", reports.preparationGit?.path || "-"],
    ["05 verification statuts", reports.corrections?.data?.globalStatus || "MANQUE", reports.corrections?.path || "-"],
    ["06 GitHub partage", reports.githubPublic?.data?.globalStatus || "MANQUE", reports.githubPublic?.path || "-"],
    ["07 fiches/vignettes", reports.fiches?.data?.globalStatus || "MANQUE", reports.fiches?.path || "-"],
    ["08 publication Hostinger", reports.hostingerPublication?.data?.globalStatus || "MANQUE", reports.hostingerPublication?.path || "-"]
  ];
}

async function latest(folder) {
  return latestJsonReport(resultsRoot, folder).catch(() => null);
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\\/g, "/");
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function selectProjects(projects) {
  if (args.all || !args.project) return projects;
  const needle = normalize(resolveMaybeProjectPath(args.project));
  return projects.filter((project) => {
    const values = [project.id, project.name, project.path, basename(project.path || "")].filter(Boolean);
    return values.map(resolveMaybeProjectPath).map(normalize).some((value) => value.includes(needle) || needle.includes(value));
  });
}

function resolveMaybeProjectPath(value) {
  const text = String(value || "");
  if (/^[a-zA-Z]:[\\/]/.test(text)) return resolve(text);
  return text;
}
