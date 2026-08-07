import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  defaultProjectsRoot,
  defaultSiteRoot,
  ensureDir,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  readJson,
  slugify,
  toPosixPath,
  writeJson,
  writeReport
} from "./lib/orchestrator-utils.mjs";
import {
  contentForProject,
  displayName,
  githubUrlForProject,
  hostingerUrlForProject,
  publicUrlForProject
} from "./lib/project-content.mjs";

const args = parseArgs();
const siteRoot = args.site ? String(args.site) : defaultSiteRoot;
const registry = await loadRegistry();
const projects = registry.projects || [];
const visibleProjects = projects.filter(isVisibleHubProject);

if (!projects.length) {
  throw new Error(`Registre vide. Lance d'abord \`npm run scan -- --root "${defaultProjectsRoot}"\`.`);
}

await ensureDir(join(siteRoot, "src"));
await ensureDir(join(siteRoot, "public", "orchestrator", "fiches"));

const cards = [];
for (const project of visibleProjects) {
  const fichePublicPath = await copyFicheToSite(project, siteRoot);
  cards.push(toSiteCard(project, fichePublicPath));
}

await writeFile(
  join(siteRoot, "src", "project-registry.js"),
  `// Fichier genere par 00_ORCHESTRATEUR. Ne pas modifier a la main.
export const orchestratorProjectCards = ${JSON.stringify(cards, null, 2)};
`,
  "utf8"
);

const publicRegistryPath = join(siteRoot, "public", "orchestrator", "projects.registry.json");
const previousPublicRegistry = await readJson(publicRegistryPath, null);
const publicRegistryChanged = previousPublicRegistry?.source !== "00_ORCHESTRATEUR"
  || JSON.stringify(previousPublicRegistry?.projects || []) !== JSON.stringify(cards);
await writeJson(publicRegistryPath, {
  generatedAt: publicRegistryChanged ? nowIso() : previousPublicRegistry?.generatedAt || nowIso(),
  source: "00_ORCHESTRATEUR",
  projects: cards
});

const rows = cards.map((card) => [
  card.name,
  card.category,
  card.status?.global || "",
  card.status?.security || "",
  card.ficheUrl || ""
]);
const report = await writeReport(
  "site",
  "site-ma-methode-sync",
  `# Synchronisation Site Ma Methode

- Date: ${nowIso()}
- Site: \`${siteRoot}\`
- Projets synchronises: ${cards.length}

${markdownTable(["Projet", "Categorie", "Statut", "Securite", "Fiche"], rows)}
`,
  { generatedAt: nowIso(), siteRoot, cards }
);

console.log(`Site Ma Methode synchronise: ${cards.length} projet(s).`);
console.log(`Module genere: ${join(siteRoot, "src", "project-registry.js")}`);
console.log(`Rapport: ${report.mdPath}`);

function isVisibleHubProject(project) {
  return project.id !== "99-archive" && project.name !== "99_Archive";
}

function isGameProject(project) {
  const value = `${project.id || ""} ${project.name || ""}`.toLowerCase();
  return /(?:^|\s)(?:jeu|game|chess)[a-z0-9]*/i.test(value.replace(/[-_]/g, " "));
}

async function copyFicheToSite(project, siteRootPath) {
  const source = join(project.path, "FICHE_PROJET.md");
  if (!existsSync(source)) return null;
  const id = project.id || slugify(project.name);
  const target = join(siteRootPath, "public", "orchestrator", "fiches", `${id}.md`);
  await mkdir(join(siteRootPath, "public", "orchestrator", "fiches"), { recursive: true });
  const content = rewriteFicheCaptureLinks(await readFile(source, "utf8"), id);
  await writeFile(target, content, "utf8");
  return `public/orchestrator/fiches/${id}.md`;
}

function rewriteFicheCaptureLinks(content, id) {
  return String(content || "")
    .replace(
      /\]\((?:\.\/)?docs\/captures\/([^)]+)\)/g,
      `](../captures/${id}/$1)`
    )
    .replace(
      new RegExp(`\\]\\((?:\\./)?public/orchestrator/captures/${escapeRegExp(id)}/([^)]+)\\)`, "g"),
      `](../captures/${id}/$1)`
    );
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toSiteCard(project, ficheUrl) {
  const content = contentForProject(project);
  const image = imageForProject(project);
  const screenshots = screenshotsFor(project);
  const exposePublicLinks = canExposePublicLinks(project);
  const knownHostingerUrl = hostingerUrlForProject(project);
  const knownPublicUrl = publicUrlForProject(project);
  const knownGithubUrl = githubUrlForProject(project);
  const hostingerUrl = exposePublicLinks
    ? (project.links?.hostinger || knownHostingerUrl)
    : "";
  const publicUrl = exposePublicLinks
    ? (project.links?.public || knownPublicUrl)
    : "";
  const githubUrl = githubUrlForSiteCard(project, exposePublicLinks, knownGithubUrl);
  const linkPolicy = {
    exposure: exposePublicLinks ? "publication-ready" : githubUrl ? "showcase-only" : "blocked-by-security",
    publicationAllowed: exposePublicLinks,
    githubShowcaseAllowed: Boolean(githubUrl && !exposePublicLinks),
    securityStatus: project.securityStatus || "UNKNOWN"
  };
  return {
    id: project.id,
    category: siteCategory(project),
    name: content.title || displayName(project.name),
    comment: content.summary,
    image,
    url: hostingerUrl || publicUrl || undefined,
    githubUrl: githubUrl || undefined,
    hostingerUrl: hostingerUrl || undefined,
    linkPolicy,
    ficheUrl: ficheUrl || undefined,
    localPath: toPosixPath(project.path),
    stack: project.stack?.length ? project.stack.slice(0, 5) : ["Projet"],
    status: {
      global: project.status || "NEEDS_DOCUMENTATION",
      security: project.securityStatus || "UNKNOWN",
      functionality: project.functionalityStatus || "UNKNOWN",
      publication: project.publicationStatus || "NEEDS_DOCUMENTATION"
    },
    details: detailsFor(content, project),
    highlights: highlightsFor(project, content),
    functions: functionsFor(project, content),
    screenshots,
    mediaPolicy: mediaPolicyFor(project, screenshots)
  };
}

function canExposePublicLinks(project) {
  return project.securityStatus === "OK_PUBLIC"
    && !/SENSITIVE|BLOCKED|FAIL|ARCHIVE/.test(`${project.status || ""} ${project.publicationStatus || ""}`);
}

function githubUrlForSiteCard(project, exposePublicLinks, knownGithubUrl) {
  if (exposePublicLinks) return project.links?.github || knownGithubUrl || "";
  const privateInternal = project.status === "PRIVATE_INTERNAL" || project.publicationStatus === "PRIVATE_INTERNAL";
  if (!privateInternal || !["OK_PUBLIC", "OK_PRIVATE"].includes(project.securityStatus)) return "";
  return project.links?.githubShowcase || "";
}

function siteCategory(project) {
  if (isGameProject(project)) return "design";
  return ["tools", "design", "ai"].includes(project.siteCategory || project.category)
    ? (project.siteCategory || project.category)
    : "tools";
}

function imageForProject(project) {
  if (canExposePublicThumbnail(project)) return project.siteThumbnail;
  return "public/generated/images/projects/project-grid-map-20260614.webp";
}

function screenshotsFor(project) {
  if (!canExposePublicMedia(project) && !canExposePublicScreenshots(project)) return [];
  if (Array.isArray(project.siteScreenshots) && project.siteScreenshots.length) return project.siteScreenshots;
  return [];
}

function mediaPolicyFor(project, screenshots) {
  const hasScreenshots = Array.isArray(screenshots) && screenshots.length > 0;
  const policy = {
    exposure: hasScreenshots
      ? (canExposePublicMedia(project) ? "publication-ready" : "safe-reviewed-captures")
      : "none",
    publicationAllowed: canExposePublicMedia(project),
    screenshotStatus: project.screenshotStatus || "NOT_CAPTURED"
  };
  if (project.publicScreenshotReview) policy.publicScreenshotReview = project.publicScreenshotReview;
  return policy;
}

function canExposePublicMedia(project) {
  return project.securityStatus === "OK_PUBLIC"
    && !/SENSITIVE|BLOCKED|FAIL|ARCHIVE|PRIVATE_INTERNAL/.test(`${project.status || ""} ${project.publicationStatus || ""}`);
}

function canExposePublicThumbnail(project) {
  const thumbnail = String(project.siteThumbnail || "").replace(/\\/g, "/");
  return /^public\/orchestrator\/thumbnails-ai\/[^/]+\.webp$/i.test(thumbnail)
    || /^public\/orchestrator\/thumbnails\/[^/]+\.webp$/i.test(thumbnail);
}

function canExposePublicScreenshots(project) {
  const screenshots = Array.isArray(project.siteScreenshots) ? project.siteScreenshots : [];
  if (!screenshots.length) return false;
  const safePrefix = `public/orchestrator/captures/${project.id}/`;
  const pathsArePublicCaptures = screenshots.every((shot) => {
    const normalized = String(shot || "").replace(/\\/g, "/");
    return normalized.startsWith(safePrefix) && /\.(png|jpe?g|webp)$/i.test(normalized);
  });
  return pathsArePublicCaptures
    && (project.publicScreenshotReview === "SAFE_SYNTHETIC_UI" || project.screenshotStatus === "PUBLIC_SAFE_CAPTURED");
}

function highlightsFor(project, content) {
  const lines = [
    content.purpose,
    `Statut: ${project.status || "NEEDS_DOCUMENTATION"}.`,
    `Securite: ${project.securityStatus || "UNKNOWN"}.`
  ];
  const hostingerUrl = canExposePublicLinks(project) ? hostingerUrlForProject(project) : "";
  const publicUrl = canExposePublicLinks(project) ? publicUrlForProject(project) : "";
  if (hostingerUrl) lines.push(`Lien Hostinger connu: ${hostingerUrl}.`);
  else if (publicUrl) lines.push(`Lien public connu: ${publicUrl}.`);
  return lines.filter(Boolean);
}

function detailsFor(content, project) {
  const details = content.details || {};
  return {
    application: details.application || content.summary,
    fonctionnement: details.fonctionnement || content.purpose,
    conception: details.conception || content.purpose,
    capabilities: normalizeLines(details.capabilities?.length ? details.capabilities : content.functions).slice(0, 10),
    tools: normalizeLines(details.tools?.length ? details.tools : details.techniques).slice(0, 10),
    techniques: normalizeLines(details.techniques?.length ? details.techniques : project.stack).slice(0, 8),
    automations: normalizeLines(details.automations || []).slice(0, 8)
  };
}

function functionsFor(project, content) {
  const lines = [
    ...(content.functions || [])
  ];
  if (project.scripts?.includes?.("registry:check")) lines.push("Validation exacte du registre disponible via npm run registry:check.");
  if (project.scripts?.includes?.("check")) lines.push("Controle automatisable detecte via npm run check.");
  if (project.scripts?.includes?.("validate")) lines.push("Validation automatisable detectee via npm run validate.");
  if (project.scripts?.includes?.("compat:check")) lines.push("Controle compatibilite detecte via npm run compat:check.");
  if (project.scripts?.includes?.("dev")) lines.push("Lancement local disponible via npm run dev.");
  if (project.scripts?.includes?.("build")) lines.push("Build automatisable detecte.");
  if (project.scripts?.includes?.("test")) lines.push("Tests automatises detectes.");
  return lines;
}

function normalizeLines(value = []) {
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}
