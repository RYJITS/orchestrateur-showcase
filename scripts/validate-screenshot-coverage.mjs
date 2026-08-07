import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultSiteRoot,
  loadRegistry,
  markdownTable,
  nowIso,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const registry = await loadRegistry();
const siteCards = await readSiteCards();
const siteCardsById = new Map(siteCards.map((card) => [card.id, card]));
const results = [];

for (const project of registry.projects || []) {
  results.push(await validateProject(project));
}

const failures = results.filter((result) => result.status === "FAIL");
const warnings = results.filter((result) => result.status === "WARN");
const globalStatus = failures.length ? "FAIL" : warnings.length ? "WARN" : "OK";
const rows = results.map((result) => [
  result.project,
  result.status,
  result.captureRequirement,
  result.projectFiles,
  result.siteFiles,
  result.thumbnail,
  result.blockers.join("; ") || "aucun",
  result.warnings.join("; ") || "aucune"
]);

const report = await writeReport(
  "screenshots",
  "validate-screenshot-coverage",
  `# Validation couverture captures

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Regle: les projets lancables et \`OK_PUBLIC\` doivent avoir desktop, mobile et vignette site.
- Regle: les projets sensibles/prives/archives ne doivent pas exposer de captures publiques.

${markdownTable(["Projet", "Statut", "Exigence", "Projet", "Site", "Vignette", "Blocages", "Alertes"], rows)}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    failures: failures.length,
    warnings: warnings.length,
    results
  }
);

console.log(`Validation captures: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (globalStatus === "FAIL") process.exitCode = 1;

async function validateProject(project) {
  const blockers = [];
  const warnings = [];
  const launchable = (project.scripts || []).some((script) => ["dev", "preview", "start"].includes(script));
  const requiresCapture = project.securityStatus === "OK_PUBLIC" && launchable && project.name !== "99_Archive";
  const blockedForPublic = project.name === "99_Archive"
    || project.securityStatus !== "OK_PUBLIC"
    || /SENSITIVE|BLOCKED|FAIL|ARCHIVE|PRIVATE_INTERNAL/.test(`${project.status || ""} ${project.publicationStatus || ""}`);

  const projectShots = project.screenshots || [];
  const siteShots = project.siteScreenshots || [];
  const siteCard = siteCardsById.get(project.id) || {};
  const cardShots = siteCard.screenshots || [];
  const cardImage = siteCard.image || "";
  const projectFiles = await existingProjectFiles(project, projectShots);
  const siteFiles = await existingSiteFiles(siteShots);
  const thumbnail = project.siteThumbnail ? await fileState(join(defaultSiteRoot, project.siteThumbnail.replace(/^public[\\/]/, "public/"))) : { exists: false, size: 0 };
  const hasDesktop = projectShots.some((file) => /desktop\.(png|jpe?g|webp)$/i.test(file));
  const hasMobile = projectShots.some((file) => /mobile\.(png|jpe?g|webp)$/i.test(file));

  if (requiresCapture) {
    if (!isAcceptedCaptureStatus(project.screenshotStatus)) blockers.push(`not-captured:${project.screenshotStatus || "UNKNOWN"}`);
    if (projectShots.length < 2 || projectFiles.existing < 2) blockers.push("project-desktop-mobile-missing");
    if (siteShots.length < 2 || siteFiles.existing < 2) blockers.push("site-desktop-mobile-missing");
    if (!project.siteThumbnail || !thumbnail.exists || thumbnail.size <= 0) blockers.push("site-thumbnail-missing");
    if (!hasDesktop) blockers.push("desktop-shot-not-tagged");
    if (!hasMobile) blockers.push("mobile-shot-not-tagged");
  } else if (launchable && project.securityStatus !== "OK_PUBLIC") {
    warnings.push(`capture-blocked-by-security:${project.securityStatus || "UNKNOWN"}`);
  }

  if (blockedForPublic && (siteShots.length || isCaptureLikeThumbnail(project.siteThumbnail))) {
    blockers.push("blocked-project-exposes-site-captures");
  }
  if (blockedForPublic && cardShots.length) {
    blockers.push("blocked-project-card-has-screenshots");
  }
  if (blockedForPublic && /public\/(?:project-shots|images)\//i.test(cardImage)) {
    blockers.push("blocked-project-card-has-specific-media");
  }

  const unsafeNames = [...projectShots, ...siteShots, project.siteThumbnail || ""].filter((file) => /(?:^|[\\/])\.env|token|secret|password|private/i.test(file));
  if (unsafeNames.length) blockers.push(`unsafe-capture-path:${unsafeNames.join(",")}`);

  return {
    project: project.name,
    id: project.id,
    status: blockers.length ? "FAIL" : warnings.length ? "WARN" : "OK",
    captureRequirement: requiresCapture ? "CAPTURE_REQUIRED" : launchable ? "SKIPPED_SECURITY_OR_PRIVATE" : "NO_SERVER_SCRIPT",
    screenshotStatus: project.screenshotStatus || "UNKNOWN",
    projectFiles: `${projectFiles.existing}/${projectShots.length}`,
    siteFiles: `${siteFiles.existing}/${siteShots.length}`,
    cardScreenshots: cardShots.length,
    cardImage,
    thumbnail: thumbnail.exists ? `${thumbnail.size} bytes` : "absente",
    blockers,
    warnings
  };
}

function isAcceptedCaptureStatus(value) {
  return ["CAPTURED", "HAS_SCREENSHOTS", "PUBLIC_SAFE_CAPTURED"].includes(String(value || ""));
}

function isCaptureLikeThumbnail(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  return /public\/orchestrator\/captures\//i.test(normalized)
    || /public\/project-shots\//i.test(normalized)
    || /(?:^|\/)(?:screenshots|captures)\//i.test(normalized);
}

async function readSiteCards() {
  const filePath = join(defaultSiteRoot, "public", "orchestrator", "projects.registry.json");
  try {
    const json = JSON.parse(await readFile(filePath, "utf8"));
    return json.projects || [];
  } catch {
    return [];
  }
}

async function existingProjectFiles(project, files) {
  let existing = 0;
  for (const file of files) {
    const state = await fileState(join(project.path, file));
    if (state.exists && state.size > 0) existing += 1;
  }
  return { existing };
}

async function existingSiteFiles(files) {
  let existing = 0;
  for (const file of files) {
    const relative = String(file).replace(/^public[\\/]/, "public/");
    const state = await fileState(join(defaultSiteRoot, relative));
    if (state.exists && state.size > 0) existing += 1;
  }
  return { existing };
}

async function fileState(path) {
  if (!existsSync(path)) return { exists: false, size: 0 };
  try {
    const info = await stat(path);
    return { exists: info.isFile(), size: info.size };
  } catch {
    return { exists: false, size: 0 };
  }
}
