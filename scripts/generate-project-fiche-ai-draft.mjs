import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import {
  copyExistingFilesToBackup,
  defaultProjectsRoot,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  toPosixPath,
  writeReport
} from "./lib/orchestrator-utils.mjs";
import {
  contentForProject,
  detailsForProject,
  displayName,
  projectContent
} from "./lib/project-content.mjs";
import {
  callMistral,
  callQwen,
  loadSubagentEnv
} from "./lib/subagent-api-utils.mjs";

const args = parseArgs();
const apply = Boolean(args.apply);
const missingOnly = args.missingOnly !== false;
const refreshExisting = Boolean(args.refreshExisting || args.refresh || args.updateExisting);
const maxProjects = Number(args.maxProjects || 2);
const agent = String(args.agent || "mistral").toLowerCase();
const registry = await loadRegistry();
const refs = args.project
  ? await projectsFromArgs(args)
  : (registry.projects || []).map((project) => ({ name: project.name, path: project.path }));
const candidates = [];
const results = [];

for (const ref of refs) {
  const project = (registry.projects || []).find((item) => normalizePath(item.path) === normalizePath(ref.path)) || {
    id: basename(ref.path).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: ref.name,
    path: ref.path,
    stack: [],
    scripts: []
  };
  if (isArchiveProject(project)) {
    results.push({ project: project.name, status: "SKIPPED_ARCHIVE", agent: "-", output: "-", details: "Archive ignoree." });
    continue;
  }
  const refreshNeeded = await needsContentRefresh(project);
  if (missingOnly && hasCuratedContent(project) && !args.force) {
    results.push({ project: project.name, status: "SKIPPED_HAS_CONTENT", agent: "-", output: "-", details: "Contenu metier deja disponible." });
    continue;
  }
  if (existsSync(join(project.path, "FICHE_CONTENU_PROJET.json")) && !args.force && !refreshNeeded) {
    results.push({ project: project.name, status: "SKIPPED_OVERRIDE_EXISTS", agent: "-", output: "FICHE_CONTENU_PROJET.json", details: "Override deja present." });
    continue;
  }
  candidates.push(project);
}

const envInfo = await loadSubagentEnv();
for (const project of candidates.slice(0, maxProjects)) {
  results.push(await draftProject(project, envInfo.env));
}
for (const project of candidates.slice(maxProjects)) {
  results.push({ project: project.name, status: "SKIPPED_LIMIT", agent: "-", output: "-", details: `Limite max-projects=${maxProjects}.` });
}

const failures = results.filter((item) => item.status === "ERROR");
const generated = results.filter((item) => item.status === "WRITTEN" || item.status === "DRY_RUN_READY");
const globalStatus = failures.length ? "FAIL" : generated.length ? (apply ? "WRITTEN" : "DRY_RUN_READY") : "NO_ACTION";

const report = await writeReport(
  "documentation",
  "generate-project-fiche-ai-draft",
  `# Brouillon IA contenu fiche projet

- Date: ${nowIso()}
- Mode: ${apply ? "apply" : "dry-run"}
- Agent prioritaire: ${agent}
- Actualiser existants modifies: ${refreshExisting ? "oui" : "non"}
- Nouveaux projets traitables: ${candidates.length}
- Statut global: **${globalStatus}**

${markdownTable(["Projet", "Statut", "Agent", "Sortie", "Details"], results.map((item) => [
  item.project,
  item.status,
  item.agent,
  item.output,
  item.details
]))}
`,
  { generatedAt: nowIso(), mode: apply ? "apply" : "dry-run", agent, maxProjects, missingOnly, refreshExisting, globalStatus, results }
);

console.log(`Brouillons IA fiches: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (failures.length) process.exitCode = 1;

async function draftProject(project, env) {
  const snapshot = await buildSafeSnapshot(project);
  const prompt = buildPrompt(project, snapshot);
  const system = [
    "Tu es un redacteur technique et produit.",
    "Tu rediges une presentation factuelle du projet analyse pour une fiche publique et un README GitHub.",
    "Tu ne dois pas inventer de secret, de cle API, ni de publication.",
    "Le sujet principal est toujours le projet lui-meme: probleme resolu, fonctionnement, conception, fonctions, installation, utilisation, outils et evolutions prouvees.",
    "Ne decris jamais le processus qui scanne le dossier, genere la fiche, produit le README, synchronise le catalogue ou publie la documentation.",
    "Ne mentionne un orchestrateur que s'il constitue reellement le produit analyse ou une fonction metier indispensable du projet.",
    "Reponds uniquement en JSON valide, sans Markdown."
  ].join(" ");
  const calls = agent === "mistral" ? ["mistral", "qwen"] : ["qwen", "mistral"];
  let lastReason = "Aucun agent IA n'a fourni un JSON exploitable.";
  for (const call of calls) {
    let attemptPrompt = prompt;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = call === "mistral"
        ? await callMistral({ env, prompt: attemptPrompt, system, temperature: 0.2, maxTokens: 2200, responseFormat: { type: "json_object" } })
        : await callQwen({ env, prompt: attemptPrompt, system, temperature: 0.2, maxTokens: 2200, responseFormat: { type: "json_object" } });
      if (response.status !== "OK") {
        lastReason = `${call}: ${response.reason || response.status}`;
        break;
      }
      const parsed = parseJson(response.content);
      const cleaned = validateDraft(parsed, project, snapshot);
      if (!cleaned.ok) {
        lastReason = cleaned.reason;
        attemptPrompt = buildCorrectionPrompt(project, parsed, cleaned.reason, snapshot);
        continue;
      }
      const target = join(project.path, "FICHE_CONTENU_PROJET.json");
      const mdTarget = join(project.path, "FICHE_CONTENU_PROJET_DRAFT.md");
      const correction = attempt ? `; correction automatique ${attempt}` : "";
      if (apply) {
        await copyExistingFilesToBackup(project, [target, mdTarget], "fiche-contenu-mistral");
        await writeFile(target, `${JSON.stringify(cleaned.data, null, 2)}\n`, "utf8");
        await writeFile(mdTarget, renderDraftMarkdown(cleaned.data), "utf8");
        return { project: project.name, status: "WRITTEN", agent: call, output: "FICHE_CONTENU_PROJET.json", details: `Modele ${response.model || call}${correction}.` };
      }
      return { project: project.name, status: "DRY_RUN_READY", agent: call, output: "FICHE_CONTENU_PROJET.json", details: `Modele ${response.model || call}${correction}; rien ecrit.` };
    }
  }
  return { project: project.name, status: "ERROR", agent: calls.join("->"), output: "-", details: lastReason };
}

function buildCorrectionPrompt(project, rejectedDraft, reason, snapshot) {
  return JSON.stringify({
    instruction: "Reecris le brouillon refuse uniquement a partir des preuves source fournies. Retire les fonctions inventees et distingue strictement ce qui est implemente de ce qui est seulement propose.",
    project: {
      id: project.id,
      name: project.name,
      title: displayName(project.name)
    },
    validationError: reason,
    rejectedDraft,
    implementation: snapshot.implementation,
    sourceSnippets: snapshot.snippets,
    constraints: [
      "Repondre avec le meme schema JSON.",
      "Ne jamais mentionner l'orchestrateur, le scan, le registre, le hub, la fiche, le README ou la publication comme fonction du projet.",
      "Ne pas ajouter de fait absent des extraits source.",
      "Si implementation.status vaut BRIEF_ONLY, presenter le projet comme un cahier des charges ou un concept a developper et formuler toutes les fonctions au futur ou comme fonctions prevues.",
      "Ne pas exposer de chemin local complet ni de donnee privee."
    ]
  }, null, 2);
}

async function buildSafeSnapshot(project) {
  const files = [];
  await walk(project.path, files);
  const selected = files
    .sort((a, b) => scoreFile(b.path) - scoreFile(a.path) || a.path.localeCompare(b.path))
    .slice(0, 36);
  const snippets = [];
  for (const item of selected.slice(0, 12)) {
    const text = await safeReadText(join(project.path, item.path), 30000);
    if (text) snippets.push({ path: item.path, text });
  }
  const implementation = detectImplementationState(files, snippets);
  return {
    project: {
      id: project.id,
      name: project.name,
      path: toPosixPath(relative(defaultProjectsRoot, project.path)),
      stack: project.stack || [],
      scripts: project.scripts || [],
      status: project.status,
      functionalityStatus: project.functionalityStatus,
      securityStatus: project.securityStatus,
      publicationStatus: project.publicationStatus
    },
    curatedProjectBrief: projectContent[project.id] ? {
      ...projectContent[project.id],
      details: detailsForProject(project)
    } : null,
    implementation,
    manifest: selected.map((item) => ({ path: item.path, size: item.size })),
    snippets
  };
}

async function walk(root, files, folder = root) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(folder, entry.name);
    const rel = toPosixPath(relative(root, full));
    if (entry.isDirectory()) {
      if (skipDir(entry.name)) continue;
      await walk(root, files, full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (skipFile(rel)) continue;
    const info = await stat(full).catch(() => null);
    if (!info || info.size > 160000) continue;
    files.push({ path: rel, size: info.size, mtimeMs: info.mtimeMs || 0 });
  }
}

async function safeReadText(path, maxLength) {
  const info = await stat(path).catch(() => null);
  if (!info || info.size > maxLength) return "";
  const buffer = await readFile(path).catch(() => null);
  if (!buffer || buffer.includes(0)) return "";
  const text = buffer.toString("utf8");
  if (/(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN .*PRIVATE KEY-----)/i.test(text)) return "";
  return text.slice(0, maxLength);
}

function buildPrompt(project, snapshot) {
  return JSON.stringify({
    instruction: "Produis un JSON centre exclusivement sur le projet analyse. Le brief edite est prioritaire sur les anciens README ou documents generes.",
    expectedShape: {
      title: "Nom lisible",
      summary: "Resume court en une phrase",
      purpose: "A quoi sert le projet",
      audience: "Pour qui",
      functions: ["fonction visible"],
      recentUpdates: ["changement recent ou synchronisation"],
      details: {
        application: "A quoi sert le projet, en detail",
        fonctionnement: "Comment l'application ou le projet fonctionne",
        conception: "Comment le projet a ete reflechi et construit, avec les choix de structure et de design",
        installation: "Installation locale concrete, pre-requis et commandes utiles",
        utilisation: "Comment utiliser concretement l'application ou le projet apres installation",
        capabilities: ["capacite"],
        tools: ["outil ou service"],
        techniques: ["technique ou stack"],
        automations: ["automation faisant reellement partie du projet"]
      }
    },
    constraints: [
      "Francais clair.",
      "Ne jamais expliquer qui genere, actualise ou publie la fiche ou le README.",
      "Ne pas presenter le scan, le registre, la carte du hub ou la synchronisation documentaire comme le but du projet.",
      "Ne pas lister la generation de fiches, la preparation GitHub, l'audit des autres projets ou la synchronisation du catalogue parmi les fonctions du projet, sauf si le brief edite dit explicitement que le projet est lui-meme cet outil.",
      "Utiliser le brief edite comme source metier prioritaire lorsqu'il est present.",
      "Considerer les fichiers FICHE, AUDIT, RAPPORT et PREPARATION_GITHUB comme des artefacts de suivi, jamais comme la definition du projet.",
      "Ne pas exposer de secret.",
      "Ne pas inventer de lien public.",
      "Ne pas utiliser de chemin local complet dans le texte public; decrire les commandes de facon generique.",
      "Si package.json existe, deduire installation/lancement depuis les scripts fournis.",
      "Respecter snapshot.implementation: BRIEF_ONLY signifie qu'aucune application executable n'est prouvee. Dans ce cas, parler de specification, de MVP prevu et de fonctions a developper; ne jamais dire que les utilisateurs peuvent deja utiliser ces fonctions.",
      "Ne jamais transformer le nom du dossier ou un titre ambigu en fonction metier sans preuve dans les extraits source.",
      "N'inclure dans recentUpdates que des changements dates ou clairement prouves, sans doublon.",
      "Si le contexte est insuffisant, le dire sobrement au lieu d'inventer une fonction ou une audience."
    ],
    snapshot
  }, null, 2);
}

function validateDraft(value, project, snapshot) {
  if (!value || typeof value !== "object") return { ok: false, reason: "JSON absent." };
  const recentUpdates = uniqueList([
    ...list(value.recentUpdates),
    ...list(value.details?.recentUpdates)
  ]);
  const data = {
    title: text(value.title) || displayName(project.name),
    summary: text(value.summary),
    purpose: text(value.purpose),
    audience: text(value.audience) || "Usage projet.",
    functions: list(value.functions),
    recentUpdates,
    details: {
      application: text(value.details?.application),
      fonctionnement: text(value.details?.fonctionnement),
      conception: text(value.details?.conception),
      installation: text(value.details?.installation),
      utilisation: text(value.details?.utilisation),
      capabilities: list(value.details?.capabilities),
      tools: list(value.details?.tools),
      techniques: list(value.details?.techniques),
      automations: list(value.details?.automations)
    }
  };
  const curated = projectContent[project.id];
  if (curated) {
    const curatedDetails = detailsForProject(project);
    data.title = text(curated.title) || data.title;
    data.summary = text(curated.summary) || data.summary;
    data.purpose = text(curated.purpose) || data.purpose;
    data.audience = text(curated.audience) || data.audience;
    data.functions = list(curated.functions).length ? list(curated.functions) : data.functions;
    data.recentUpdates = list(curated.recentUpdates).length ? uniqueList(curated.recentUpdates) : data.recentUpdates;
    for (const field of ["application", "fonctionnement", "conception", "installation", "utilisation"]) {
      const curatedText = text(curatedDetails[field]);
      if (curatedText) data.details[field] = curatedText;
    }
    for (const field of ["capabilities", "tools", "techniques", "automations"]) {
      const curatedList = list(curatedDetails[field]);
      if (curatedList.length) data.details[field] = curatedList;
    }
  }
  if (!data.summary || !data.purpose || !data.details.application || !data.details.fonctionnement || !data.details.conception) {
    return { ok: false, reason: "Champs metier obligatoires incomplets." };
  }
  const focusError = projectFocusError(data, project, snapshot);
  if (focusError) return { ok: false, reason: focusError };
  return { ok: true, data };
}

function projectFocusError(data, project, snapshot) {
  if (project.id === "00-orchestrateur") return "";
  const allowsOrchestratorReference = project.id === "01-site-ma-methode" || /orchestr/i.test(project.name || "");
  if (!allowsOrchestratorReference && /\borchestrateur\b/.test(normalizeForComparison(JSON.stringify(data)))) {
    return "Le texte attribue au projet une dependance a l'orchestrateur qui n'est pas validee.";
  }
  const narrative = [
    data.summary,
    data.purpose,
    data.details.application,
    data.details.fonctionnement,
    data.details.conception
  ].join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const metaPatterns = [
    /(?:orchestrateur|script)[^.]{0,180}(?:genere|produit|redige|actualise|synchronise)[^.]{0,140}(?:fiche|readme|documentation|carte|registre)/,
    /(?:fiche|readme)[^.]{0,140}(?:genere|produit|actualise)[^.]{0,140}(?:orchestrateur|script)/
  ];
  if (metaPatterns.some((pattern) => pattern.test(narrative))) {
    return "Le texte decrit la fabrication de la fiche au lieu du projet.";
  }

  if (snapshot?.implementation?.status === "BRIEF_ONLY") {
    const plannedLanguage = /(?:cahier des charges|specification|concept|prototype a developper|mvp prevu|application prevue|devra|permettra|pourra)/.test(narrative);
    const operationalClaims = /(?:fonctionne comme|permet aux utilisateurs|les utilisateurs peuvent|le systeme permet|est accessible via une interface|offre une interface)/.test(narrative);
    if (!plannedLanguage || operationalClaims) {
      return "Le dossier contient seulement un brief: la fiche doit presenter des fonctions prevues, pas une application deja operationnelle.";
    }
  }

  if (project.id === "01-site-ma-methode") return "";
  const claimedFunctions = normalizeForComparison([
    ...data.functions,
    ...data.details.capabilities,
    ...data.details.automations
  ].join(" "));
  const publicationWorkflowPatterns = [
    /(?:generation|creation|actualisation|mise a jour)[^.;]{0,100}(?:fiche projet|fiches projet|readme)/,
    /(?:preparation|publication|deploiement)[^.;]{0,100}(?:depot github|depots github|github)/,
    /(?:synchronisation|mise a jour)[^.;]{0,100}(?:catalogue public|registre projet|carte du hub)/,
    /audit[^.;]{0,80}(?:des autres projets|de securite et de fonctionnement des projets)/
  ];
  return publicationWorkflowPatterns.some((pattern) => pattern.test(claimedFunctions))
    ? "Les fonctions attribuees au projet decrivent en realite le workflow de l'orchestrateur."
    : "";
}

function normalizeForComparison(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function detectImplementationState(files, snippets) {
  const evidence = files
    .map((item) => item.path)
    .filter((path) => isImplementationEvidence(path))
    .slice(0, 20);
  const sourceText = normalizeForComparison(snippets.map((item) => item.text).join("\n"));
  const briefMarkers = [
    /structure technique proposee/,
    /premiere version mvp/,
    /a faire dans le mvp/,
    /instruction courte pour codex/,
    /creer une application/
  ].filter((pattern) => pattern.test(sourceText)).length;
  return {
    status: evidence.length ? "IMPLEMENTATION_DETECTED" : briefMarkers >= 1 ? "BRIEF_ONLY" : "DOCUMENTATION_ONLY",
    evidence,
    briefMarkers
  };
}

function isImplementationEvidence(path) {
  const normalized = toPosixPath(path).toLowerCase();
  return normalized === "package.json"
    || normalized === "pyproject.toml"
    || normalized === "requirements.txt"
    || normalized === "dockerfile"
    || normalized === "index.html"
    || normalized.startsWith("src/")
    || normalized.startsWith("app/")
    || normalized.startsWith("api/")
    || normalized.startsWith("scripts/")
    || /\.(?:js|jsx|mjs|cjs|ts|tsx|py|php|go|rs|java|cs)$/.test(normalized);
}

function renderDraftMarkdown(data) {
  return `# Brouillon contenu fiche - ${data.title}

## Resume
${data.summary}

## A quoi sert le projet
${data.purpose}

## Fonctionnement
${data.details.fonctionnement}

## Construction
${data.details.conception}

## Installation
${data.details.installation || "Installation a completer."}

## Utilisation
${data.details.utilisation || "Utilisation a completer."}

## Fonctions
${data.functions.map((item) => `- ${item}`).join("\n")}
`;
}

async function needsContentRefresh(project) {
  if (args.force) return true;
  const target = join(project.path, "FICHE_CONTENU_PROJET.json");
  if (!existsSync(target)) return true;
  if (!refreshExisting) return false;
  const targetInfo = await stat(target).catch(() => null);
  if (!targetInfo) return true;
  const files = [];
  await walk(project.path, files);
  return files.some((item) => isRefreshSignalFile(item.path) && item.mtimeMs > targetInfo.mtimeMs);
}

function isRefreshSignalFile(path) {
  const normalized = toPosixPath(path).toLowerCase();
  return normalized === "package.json"
    || normalized === "index.html"
    || normalized.startsWith("src/")
    || normalized.startsWith("app/")
    || normalized.startsWith("components/")
    || normalized.startsWith("pages/")
    || normalized.startsWith("scripts/")
    || /^vite\.config\./i.test(normalized)
    || /(?:^|\/)(main|app|index)\.(?:js|jsx|ts|tsx|mjs|css)$/i.test(normalized);
}

function hasCuratedContent(project) {
  if (projectContent[project.id]) return true;
  const content = contentForProject(project);
  return !String(content.details?.application || "").includes("Fiche metier a completer");
}

function parseJson(textValue) {
  const cleaned = String(textValue || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function text(value) {
  const flattened = flattenStructuredText(value);
  if (/^\[object Object\]$/i.test(flattened.trim())) return "";
  return sanitizePublicText(
    flattened
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function flattenStructuredText(value) {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(flattenStructuredText).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  return Object.entries(value).map(([key, item]) => {
    const rendered = flattenStructuredText(item).trim();
    if (!rendered) return "";
    const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
    return label ? `${label}: ${rendered}` : rendered;
  }).filter(Boolean).join("\n");
}

function list(value) {
  return (Array.isArray(value) ? value : [value]).map(text).filter(Boolean).slice(0, 12);
}

function uniqueList(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 12);
}

function sanitizePublicText(value) {
  return String(value || "")
    .replace(/`[A-Za-z]:[\\/][^`]+`/g, "`un dossier local dedie`")
    .replace(/`\/(?:home|users|mnt|var|etc)\/[^`]+`/gi, "`un dossier local dedie`")
    .replace(/\b[A-Za-z]:[\\/][^\s),;]+/g, "un dossier local dedie")
    .replace(/\/(?:home|users|mnt|var|etc)\/[^\s),;]+/gi, "un dossier local dedie");
}

function scoreFile(path) {
  const normalized = path.toLowerCase();
  if (/(?:^|\/)(?:brief|projet|project|specification|cahier)[^/]*\.md$/i.test(normalized)) return 110;
  if (normalized === "readme.md") return 100;
  if (normalized === "package.json") return 95;
  if (normalized.includes("app") || normalized.includes("main") || normalized.includes("index")) return 80;
  if (normalized.startsWith("src/")) return 70;
  if (normalized.endsWith(".md")) return 60;
  return 20;
}

function skipDir(name) {
  return [".git", "node_modules", "dist", "build", ".next", ".cache", "coverage", "logs", "sessions", "session"].includes(name);
}

function skipFile(path) {
  const normalized = path.toLowerCase();
  const base = basename(normalized);
  if (base.startsWith(".env") || normalized.includes("secret") || normalized.includes("token")) return true;
  if (/^(?:fiche_projet|fiche_contenu_projet(?:_draft)?|audit_|rapport_|preparation_github_)/i.test(base)) return true;
  if (/^readme_github_/i.test(base) || base === ".project-orchestrator.json") return true;
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip", ".7z", ".rar", ".pdf", ".xlsx", ".xls", ".db", ".sqlite"].includes(extname(normalized));
}

function isArchiveProject(project) {
  return project.id === "99-archive" || project.name === "99_Archive" || project.category === "archive";
}

function normalizePath(value) {
  return toPosixPath(resolve(String(value || ""))).toLowerCase();
}
