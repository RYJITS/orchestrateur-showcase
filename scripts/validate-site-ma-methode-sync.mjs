import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultSiteRoot,
  loadRegistry,
  markdownTable,
  nowIso,
  orchestratorRoot,
  readJson,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const registry = await loadRegistry();
const centralProjects = (registry.projects || []).filter(isVisibleHubProject);
const siteModulePath = join(defaultSiteRoot, "src", "project-registry.js");
const sitePublicPath = join(defaultSiteRoot, "public", "orchestrator", "projects.registry.json");
const siteFichesRoot = join(defaultSiteRoot, "public", "orchestrator", "fiches");
const siteCardSchemaPath = join(orchestratorRoot, "schemas", "site-project-card.schema.json");
const siteCardSchema = await readJson(siteCardSchemaPath, {});

const sitePublic = await readJsonFile(sitePublicPath, { projects: [] });
const siteModule = existsSync(siteModulePath)
  ? await import(`${pathToFileURL(siteModulePath).href}?t=${Date.now()}`)
  : { orchestratorProjectCards: [] };

const publicCards = sitePublic.projects || [];
const moduleCards = siteModule.orchestratorProjectCards || [];
const centralIds = centralProjects.map((project) => project.id).sort();
const publicIds = publicCards.map((card) => card.id).sort();
const moduleIds = moduleCards.map((card) => card.id).sort();

const missingFromPublic = centralIds.filter((id) => !publicIds.includes(id));
const extraInPublic = publicIds.filter((id) => !centralIds.includes(id));
const missingFromModule = centralIds.filter((id) => !moduleIds.includes(id));
const extraInModule = moduleIds.filter((id) => !centralIds.includes(id));
const mismatchedPublicStatuses = mismatchedStatuses(centralProjects, publicCards);
const mismatchedModuleStatuses = mismatchedStatuses(centralProjects, moduleCards);
const unsafePublicLinks = publicCards.filter(hasUnsafePublicLink).map((card) => card.id);
const unsafeModuleLinks = moduleCards.filter(hasUnsafePublicLink).map((card) => card.id);
const unsafePublicMedia = publicCards.filter(hasUnsafePublicMedia).map((card) => card.id);
const unsafeModuleMedia = moduleCards.filter(hasUnsafePublicMedia).map((card) => card.id);
const archiveCards = [...publicCards, ...moduleCards].filter((card) => !isVisibleHubProject(card)).map((card) => card.id);
const publicSchemaIssues = validateCardsAgainstSchema(publicCards, "json");
const moduleSchemaIssues = validateCardsAgainstSchema(moduleCards, "module");
const missingFicheFiles = await missingFiches(publicCards);
const sensitiveHits = await scanGeneratedSiteData();

const checks = [
  check("Schema carte hub present", existsSync(siteCardSchemaPath), siteCardSchemaPath),
  check("Module JS genere present", existsSync(siteModulePath), siteModulePath),
  check("JSON public genere present", existsSync(sitePublicPath), sitePublicPath),
  check("JSON public couvre tous les projets", missingFromPublic.length === 0 && extraInPublic.length === 0, diffEvidence(missingFromPublic, extraInPublic)),
  check("Module JS couvre tous les projets", missingFromModule.length === 0 && extraInModule.length === 0, diffEvidence(missingFromModule, extraInModule)),
  check("Schema cartes JSON public respecte", publicSchemaIssues.length === 0, publicSchemaIssues.slice(0, 12).join(", ") || "OK"),
  check("Schema cartes module JS respecte", moduleSchemaIssues.length === 0, moduleSchemaIssues.slice(0, 12).join(", ") || "OK"),
  check("Statuts JSON public alignes", mismatchedPublicStatuses.length === 0, mismatchedPublicStatuses.join(", ") || "OK"),
  check("Statuts module JS alignes", mismatchedModuleStatuses.length === 0, mismatchedModuleStatuses.join(", ") || "OK"),
  check("Liens publics bloques pour projets sensibles dans JSON", unsafePublicLinks.length === 0, unsafePublicLinks.join(", ") || "OK"),
  check("Liens publics bloques pour projets sensibles dans module JS", unsafeModuleLinks.length === 0, unsafeModuleLinks.join(", ") || "OK"),
  check("Medias publics bloques pour projets sensibles dans JSON", unsafePublicMedia.length === 0, unsafePublicMedia.join(", ") || "OK"),
  check("Medias publics bloques pour projets sensibles dans module JS", unsafeModuleMedia.length === 0, unsafeModuleMedia.join(", ") || "OK"),
  check("Archive absente des cartes publiques", archiveCards.length === 0, archiveCards.join(", ") || "OK"),
  check("Fiches publiques referencees presentes", missingFicheFiles.length === 0, missingFicheFiles.join(", ") || "OK"),
  check("Aucune signature evidente de secret dans les donnees generees", sensitiveHits.length === 0, sensitiveHits.map((hit) => `${hit.file}:${hit.pattern}`).join(", ") || "OK")
];

const globalStatus = checks.every((item) => item.status === "OK") ? "OK" : "FAIL";
const rows = publicCards.map((card) => [
  card.id,
  card.status?.global || "MISSING",
  card.status?.security || "MISSING",
  card.hostingerUrl || "",
  card.githubUrl || ""
]);

const report = await writeReport(
  "site",
  "validate-site-ma-methode-sync",
  `# Validation synchro Site Ma Methode

- Date: ${nowIso()}
- Statut global: **${globalStatus}**
- Projets registre central: ${centralIds.length}
- Projets JSON public: ${publicIds.length}
- Projets module JS: ${moduleIds.length}

## Controles
${markdownTable(["Controle", "Statut", "Preuve"], checks.map((item) => [item.label, item.status, item.evidence]))}

## Cartes publiques
${markdownTable(["Projet", "Global", "Securite", "Hostinger", "GitHub"], rows)}
`,
  {
    generatedAt: nowIso(),
    globalStatus,
    centralIds,
    publicIds,
    moduleIds,
    missingFromPublic,
    extraInPublic,
    missingFromModule,
    extraInModule,
    mismatchedPublicStatuses,
    mismatchedModuleStatuses,
    unsafePublicLinks,
    unsafeModuleLinks,
    unsafePublicMedia,
    unsafeModuleMedia,
    archiveCards,
    publicSchemaIssues,
    moduleSchemaIssues,
    missingFicheFiles,
    sensitiveHits,
    checks
  }
);

console.log(`Validation Site Ma Methode: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (globalStatus !== "OK") process.exitCode = 1;

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function mismatchedStatuses(projects, cards) {
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const mismatches = [];
  for (const project of projects) {
    const card = cardById.get(project.id);
    if (!card) continue;
    const expected = [
      project.status || "UNKNOWN",
      project.securityStatus || "UNKNOWN",
      project.functionalityStatus || "UNKNOWN",
      project.publicationStatus || "UNKNOWN"
    ].join("/");
    const actual = [
      card.status?.global || "UNKNOWN",
      card.status?.security || "UNKNOWN",
      card.status?.functionality || "UNKNOWN",
      card.status?.publication || "UNKNOWN"
    ].join("/");
    if (expected !== actual) mismatches.push(`${project.id}: ${actual} != ${expected}`);
  }
  return mismatches;
}

function isVisibleHubProject(project) {
  return project.id !== "99-archive" && project.name !== "99_Archive";
}

function hasUnsafePublicLink(card) {
  const hasApplicationLink = Boolean(card.url || card.hostingerUrl);
  const blockedStatus = /SENSITIVE|BLOCKED|FAIL|ARCHIVE/.test(`${card.status?.global} ${card.status?.publication}`);
  if (hasApplicationLink && (card.status?.security !== "OK_PUBLIC" || blockedStatus)) return true;
  if (!card.githubUrl) return false;
  const showcaseOnly = card.linkPolicy?.exposure === "showcase-only"
    && card.linkPolicy?.githubShowcaseAllowed === true
    && ["OK_PUBLIC", "OK_PRIVATE"].includes(card.status?.security)
    && /^https:\/\/github\.com\//i.test(card.githubUrl)
    && !hasApplicationLink;
  if (showcaseOnly) return false;
  return card.status?.security !== "OK_PUBLIC" || blockedStatus;
}

function hasUnsafePublicMedia(card) {
  const blocked = card.status?.security !== "OK_PUBLIC"
    || /SENSITIVE|BLOCKED|FAIL|ARCHIVE|PRIVATE_INTERNAL/.test(`${card.status?.global} ${card.status?.publication}`);
  if (!blocked) return false;
  if ((card.screenshots || []).length && !hasSafeReviewedPublicScreenshots(card)) return true;
  return /public\/(?:project-shots|images)\//i.test(card.image || "");
}

function hasSafeReviewedPublicScreenshots(card) {
  const screenshots = Array.isArray(card.screenshots) ? card.screenshots : [];
  if (!screenshots.length) return false;
  const review = card.mediaPolicy?.publicScreenshotReview;
  const status = card.mediaPolicy?.screenshotStatus;
  if (review !== "SAFE_SYNTHETIC_UI" && status !== "PUBLIC_SAFE_CAPTURED") return false;
  const safePrefix = `public/orchestrator/captures/${card.id}/`;
  return screenshots.every((shot) => {
    const normalized = String(shot || "").replace(/\\/g, "/");
    return normalized.startsWith(safePrefix) && /\.(png|jpe?g|webp)$/i.test(normalized);
  });
}

function validateCardsAgainstSchema(cards, source) {
  const issues = [];
  for (const card of cards) {
    issues.push(...validateObject(card, siteCardSchema, source, card.id || "unknown"));
  }
  return issues;
}

function validateObject(value, schema, source, path) {
  const issues = [];
  if (!schema || typeof schema !== "object") return issues;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${source}:${path}:not-object`];
    for (const key of schema.required || []) {
      if (value[key] === undefined || value[key] === null || value[key] === "") issues.push(`${source}:${path}.${key}:missing`);
    }
    for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
      if (value[key] === undefined) continue;
      issues.push(...validateObject(value[key], propertySchema, source, `${path}.${key}`));
    }
    return issues;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${source}:${path}:not-array`];
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) issues.push(`${source}:${path}:min-items-${schema.minItems}`);
    if (schema.items) {
      value.forEach((item, index) => {
        issues.push(...validateObject(item, schema.items, source, `${path}[${index}]`));
      });
    }
    return issues;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return [`${source}:${path}:not-string`];
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) issues.push(`${source}:${path}:min-length-${schema.minLength}`);
  }
  if (schema.enum && !schema.enum.includes(value)) issues.push(`${source}:${path}:invalid-${value}`);
  return issues;
}

async function missingFiches(cards) {
  const missing = [];
  for (const card of cards) {
    if (!card.ficheUrl) continue;
    const relativePath = String(card.ficheUrl).replace(/^public[\\/]/, "");
    const target = join(defaultSiteRoot, "public", relativePath);
    if (!existsSync(target)) missing.push(`${card.id}:${card.ficheUrl}`);
  }
  return missing;
}

async function scanGeneratedSiteData() {
  const files = [
    siteModulePath,
    sitePublicPath,
    ...(await ficheFiles())
  ].filter((file) => existsSync(file));
  const patterns = [
    { name: ".env", regex: /(^|[\\/])\.env(?:\.|$|[\\/])/i },
    { name: "api_key", regex: /\bapi[_-]?key\b\s*[:=]/i },
    { name: "private_key", regex: /\bprivate[_-]?key\b\s*[:=]/i },
    { name: "access_token", regex: /\baccess[_-]?token\b\s*[:=]/i },
    { name: "refresh_token", regex: /\brefresh[_-]?token\b\s*[:=]/i },
    { name: "password", regex: /\bpassword\b\s*[:=]/i },
    { name: "bearer", regex: /\bbearer\s+[a-z0-9._-]{20,}/i },
    { name: "openai_key", regex: /\bsk-[a-z0-9_-]{20,}/i },
    { name: "github_token", regex: /\bgh[pousr]_[a-z0-9_]{20,}/i },
    { name: "private_key_block", regex: /BEGIN [A-Z ]*PRIVATE KEY/i }
  ];
  const hits = [];
  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => "");
    for (const pattern of patterns) {
      if (pattern.regex.test(content)) hits.push({ file, pattern: pattern.name });
    }
  }
  return hits;
}

async function ficheFiles() {
  if (!existsSync(siteFichesRoot)) return [];
  const entries = await readdir(siteFichesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(siteFichesRoot, entry.name));
}

function check(label, condition, evidence) {
  return {
    label,
    status: condition ? "OK" : "FAIL",
    evidence: String(evidence || "")
  };
}

function diffEvidence(missing, extra) {
  return `manquants=${missing.join(", ") || "aucun"}, extras=${extra.join(", ") || "aucun"}`;
}
