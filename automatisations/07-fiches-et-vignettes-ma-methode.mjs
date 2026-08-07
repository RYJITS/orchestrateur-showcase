import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultSiteRoot,
  loadRegistry,
  readJson,
  toPosixPath
} from "../scripts/lib/orchestrator-utils.mjs";
import { displayName } from "../scripts/lib/project-content.mjs";
import {
  alignedMarkdownTable,
  automationPaths,
  commandText,
  nowIso,
  parseAutomationArgs,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { automatisationsRoot, orchestratorRoot, resultsRoot } = automationPaths(import.meta.url);
const args = parseAutomationArgs();
const shouldRun = Boolean(args.run);
const forceThumbnails = process.argv.includes("--force-thumbnails");
const localOnly = process.argv.includes("--local-only");
const captureProjects = !process.argv.includes("--no-captures");
const qwenMax = qwenMaxValue();
const modelPaths = {
  fiche: join(automatisationsRoot, "07_Modeles", "FICHE_PROJET_EXEMPLE.md"),
  thumbnails: join(automatisationsRoot, "07_Modeles", "VIGNETTES_GRATUITES.md")
};

const steps = [
  {
    id: "ai-draft",
    label: "Preparer contenu IA pour nouveaux projets",
    command: [process.execPath, [join(orchestratorRoot, "scripts", "generate-project-fiche-ai-draft.mjs"), "--apply", "--agent", "mistral", "--refresh-existing", "--max-projects", "20"]],
    displayCommand: "node scripts/generate-project-fiche-ai-draft.mjs --apply --agent mistral --refresh-existing --max-projects 20",
    purpose: "Pour un nouveau projet ou un projet modifie, analyser le projet avec Mistral puis generer FICHE_CONTENU_PROJET.json."
  },
  ...(captureProjects ? [{
    id: "captures",
    label: "Capturer les interfaces projet OK_PUBLIC",
    command: [process.execPath, [join(orchestratorRoot, "scripts", "capture-project-screenshots.mjs"), "--capture"]],
    displayCommand: "node scripts/capture-project-screenshots.mjs --capture",
    purpose: "Lancer les projets publics avec interface, prendre desktop/mobile et garder ces captures pour les fiches."
  }] : []),
  {
    id: "fiches",
    label: "Actualiser ou creer les fiches projet",
    command: [process.execPath, [join(orchestratorRoot, "scripts", "update-project-fiches.mjs")]],
    displayCommand: "node scripts/update-project-fiches.mjs",
    purpose: "Ecrire FICHE_PROJET.md, INSTALLATION_FR.md, CHANGELOG_FR.md et metadata projet."
  },
  {
    id: "thumbnails",
    label: "Generer seulement les vignettes manquantes",
    command: [
      process.execPath,
      [
        join(orchestratorRoot, "scripts", "generate-project-thumbnails.mjs"),
        ...(localOnly ? [] : ["--qwen-image", "--qwen-max", String(qwenMax)]),
        ...(forceThumbnails ? ["--force"] : [])
      ]
    ],
    displayCommand: `node scripts/generate-project-thumbnails.mjs${localOnly ? "" : ` --qwen-image --qwen-max ${qwenMax}`}${forceThumbnails ? " --force" : ""}`,
    purpose: "Conserver les vignettes existantes, tenter Qwen-Image pour les manquantes puis fallback local Sharp/SVG."
  },
  {
    id: "site",
    label: "Synchroniser Site Ma Methode",
    command: [process.execPath, [join(orchestratorRoot, "scripts", "update-site-ma-methode-projects.mjs"), "--sync"]],
    displayCommand: "node scripts/update-site-ma-methode-projects.mjs --sync",
    purpose: "Copier les fiches dans le site et regenerer le registre public des cartes."
  },
  {
    id: "structure",
    label: "Verifier la structure des fiches",
    command: [process.execPath, [join(orchestratorRoot, "scripts", "validate-project-documentation.mjs"), "--publication"]],
    displayCommand: "node scripts/validate-project-documentation.mjs --publication",
    purpose: "Surveiller que les fiches ont les sections obligatoires, les liens et les mises a jour."
  }
];

const beforeSummary = await buildSummary();
const results = [];

for (const step of steps) {
  if (!shouldRun) {
    results.push({
      ...step,
      status: "DRY_RUN",
      exitCode: null,
      durationMs: 0,
      output: commandText(step)
    });
    continue;
  }
  results.push(await runStep(step));
}

const afterSummary = shouldRun ? await buildSummary() : beforeSummary;
const failures = results.filter((item) => item.exitCode && item.exitCode !== 0);
const globalStatus = !shouldRun
  ? "DRY_RUN"
  : failures.length
    ? "FAIL"
    : afterSummary.counts.missingLocalFiches || afterSummary.counts.missingSiteFiches || afterSummary.counts.missingThumbnails || afterSummary.counts.missingRequiredCaptures
      ? "A_COMPLETER"
      : "OK";

const report = await writeAutomationReport(
  resultsRoot,
  "07-fiches-et-vignettes-ma-methode",
  `# Automatisation 07 - Fiches et vignettes Ma Methode

- Date: ${nowIso()}
- Mode: ${shouldRun ? "RUN" : "DRY_RUN"}
- Statut global: **${globalStatus}**
- Site Ma Methode: \`${defaultSiteRoot}\`
- Captures projet: ${captureProjects ? "oui, pour projets OK_PUBLIC lancables" : "non (--no-captures)"}
- Remplacement vignettes existantes: ${forceThumbnails ? "oui (--force-thumbnails)" : "non"}
- Priorite vignettes: ${localOnly ? "local uniquement" : `Qwen-Image puis local (max Qwen: ${qwenMax})`}

## Resultat lisible

${alignedMarkdownTable(
  ["Controle", "Resultat"],
  [
    ["Projets visibles hors archive", afterSummary.counts.visible],
    ["Fiches locales presentes", `${afterSummary.counts.localFiches}/${afterSummary.counts.visible}`],
    ["Fiches site presentes", `${afterSummary.counts.siteFiches}/${afterSummary.counts.visible}`],
    ["Captures requises presentes", `${afterSummary.counts.capturedRequired}/${afterSummary.counts.requiredCaptures}`],
    ["Captures requises manquantes", afterSummary.counts.missingRequiredCaptures],
    ["Vignettes presentes", `${afterSummary.counts.thumbnails}/${afterSummary.counts.visible}`],
    ["Vignettes manquantes", afterSummary.counts.missingThumbnails],
    ["Priorite Qwen-Image", localOnly ? "non" : `oui, max ${qwenMax}`],
    ["Modeles 07 presents", `${modelStatus().filter((item) => item.exists).length}/2`],
    ["Etapes executees", shouldRun ? results.filter((item) => item.status === "OK").length : "-"],
    ["Etapes en erreur", shouldRun ? failures.length : "-"]
  ]
)}

## Modeles disponibles

${alignedMarkdownTable(
  ["Modele", "Etat", "Chemin"],
  modelStatus().map((item) => [item.label, item.exists ? "OK" : "MANQUE", item.path])
)}

## Solution gratuite retenue

${alignedMarkdownTable(
  ["Besoin", "Solution sans cout", "Regle"],
  freeSolutionRows()
)}

## Controle par projet

${alignedMarkdownTable(
  ["Projet", "Section", "Fiche locale", "Fiche site", "Captures", "Vignette", "Action"],
  afterSummary.rows
)}

## Etapes

${alignedMarkdownTable(
  ["Etape", "Statut", "Commande", "Duree", "Sortie"],
  results.map((item) => [
    item.label,
    item.status,
    commandText(item),
    item.durationMs ? `${item.durationMs} ms` : "-",
    trimText(item.output, 220)
  ])
)}

## Suite conseillee

${globalStatus === "FAIL"
  ? "- Corriger l'etape en erreur puis relancer le 06 en RUN."
  : globalStatus === "A_COMPLETER"
    ? "- Completer les fiches, captures ou vignettes indiquees puis relancer le 06 en RUN."
  : shouldRun
    ? "- Ouvrir Site Ma Methode et verifier visuellement les fiches/vignettes synchronisees."
    : "- Relancer avec \`--run\` ou le lanceur double-clic pour ecrire les fiches, generer seulement les vignettes manquantes et synchroniser le site."}

## Regles

- Ne pas remplacer les vignettes existantes sans \`--force-thumbnails\`.
- Qwen-Image est option 1 pour les vignettes manquantes, avec limite par lancement.
- Le local gratuit est option 2 et prend le relais automatiquement.
- Ne pas utiliser une capture de Site Ma Methode comme vignette d'un autre projet.
- Les captures projet restent separees des vignettes et doivent respecter \`OK_PUBLIC\`.
- Les captures projet sont desktop/mobile et alimentent la fiche detaillee, pas l'image principale de carte.
- Les fiches doivent decrire le projet, pas le script qui les genere.
`,
  {
    generatedAt: nowIso(),
    action: "07-fiches-et-vignettes-ma-methode",
    mode: shouldRun ? "RUN" : "DRY_RUN",
    globalStatus,
    forceThumbnails,
    localOnly,
    captureProjects,
    qwenMax,
    beforeSummary,
    afterSummary,
    modelStatus: modelStatus(),
    freeSolutions: freeSolutionRows(),
    results
  }
);

console.log(`Automatisation 07: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (shouldRun && failures.length) process.exitCode = 1;

function runStep(step) {
  const started = Date.now();
  const [command, commandArgs] = step.command;
  return new Promise((resolvePromise) => {
    execFile(command, commandArgs, {
      cwd: orchestratorRoot,
      windowsHide: true,
      timeout: 20 * 60 * 1000,
      maxBuffer: 40 * 1024 * 1024
    }, (error, stdout = "", stderr = "") => {
      const exitCode = error?.code ?? 0;
      resolvePromise({
        ...step,
        status: exitCode === 0 ? "OK" : "FAIL",
        exitCode,
        durationMs: Date.now() - started,
        output: stdout || stderr || ""
      });
    });
  });
}

async function buildSummary() {
  const registry = await loadRegistry();
  const projects = (registry.projects || []).filter(isVisibleProject);
  const siteRegistry = await readJson(join(defaultSiteRoot, "public", "orchestrator", "projects.registry.json"), { projects: [] });
  const siteCardsById = new Map((siteRegistry.projects || []).map((card) => [card.id, card]));
  const rows = [];
  const details = [];

  for (const project of projects) {
    const card = siteCardsById.get(project.id) || {};
    const localFiche = existsSync(join(project.path, "FICHE_PROJET.md"));
    const siteFiche = await siteFicheExists(project.id, card.ficheUrl);
    const thumbnail = await thumbnailState(project, card);
    const captures = captureState(project);
    const section = card.category || project.siteCategory || project.category || "tools";
    const action = actionFor({ localFiche, siteFiche, captures, thumbnail, project });
    rows.push([
      displayName(project.name),
      section,
      localFiche ? "OK" : "MANQUE",
      siteFiche ? "OK" : "MANQUE",
      captures.label,
      thumbnail.exists ? "OK" : "MANQUE",
      action
    ]);
    details.push({ project: project.name, id: project.id, localFiche, siteFiche, captures, thumbnail, action });
  }

  const requiredCaptures = details.filter((item) => item.captures.required).length;
  return {
    generatedAt: nowIso(),
    counts: {
      visible: projects.length,
      localFiches: details.filter((item) => item.localFiche).length,
      siteFiches: details.filter((item) => item.siteFiche).length,
      requiredCaptures,
      capturedRequired: details.filter((item) => item.captures.required && item.captures.exists).length,
      missingRequiredCaptures: details.filter((item) => item.captures.required && !item.captures.exists).length,
      thumbnails: details.filter((item) => item.thumbnail.exists).length,
      missingLocalFiches: details.filter((item) => !item.localFiche).length,
      missingSiteFiches: details.filter((item) => !item.siteFiche).length,
      missingThumbnails: details.filter((item) => !item.thumbnail.exists).length
    },
    rows,
    details
  };
}

async function siteFicheExists(id, ficheUrl) {
  const relative = String(ficheUrl || `public/orchestrator/fiches/${id}.md`).replace(/^public[\\/]/, "public/");
  return existsSync(join(defaultSiteRoot, relative));
}

async function thumbnailState(project, card) {
  const candidates = [
    project.siteThumbnail,
    card.image,
    `public/orchestrator/thumbnails/${project.id}.webp`,
    `public/orchestrator/thumbnails-ai/${project.id}.webp`
  ].filter(Boolean);
  for (const item of candidates) {
    const normalized = String(item).replace(/\\/g, "/").replace(/^public\//, "public/");
    const absolute = join(defaultSiteRoot, normalized);
    const info = await stat(absolute).catch(() => null);
    if (info?.isFile?.() && info.size > 0) {
      return { exists: true, path: toPosixPath(normalized), size: info.size };
    }
  }
  return { exists: false, path: "", size: 0 };
}

function captureState(project) {
  const shots = Array.isArray(project.screenshots) ? project.screenshots : [];
  const hasDesktop = shots.some((file) => /desktop\.(png|jpe?g|webp)$/i.test(file));
  const hasMobile = shots.some((file) => /mobile\.(png|jpe?g|webp)$/i.test(file));
  const required = project.securityStatus === "OK_PUBLIC" && isLaunchableProject(project);
  const exists = hasDesktop && hasMobile;
  if (exists) return { required, exists, label: "OK", count: shots.length };
  if (required) return { required, exists, label: "MANQUE", count: shots.length };
  return { required, exists, label: "-", count: shots.length };
}

function actionFor({ localFiche, siteFiche, captures, thumbnail, project }) {
  if (!localFiche) return "creer fiche locale";
  if (!siteFiche) return "synchroniser fiche site";
  if (captures.required && !captures.exists) return "capturer projet";
  if (!thumbnail.exists) return "generer vignette gratuite";
  if (project.securityStatus !== "OK_PUBLIC") return "conserver medias publics prudents";
  return "OK";
}

function modelStatus() {
  return [
    { label: "Fiche projet exemple", path: modelPaths.fiche, exists: existsSync(modelPaths.fiche) },
    { label: "Strategie vignettes gratuites", path: modelPaths.thumbnails, exists: existsSync(modelPaths.thumbnails) }
  ];
}

function freeSolutionRows() {
  return [
    ["Conserver les belles vignettes", "Ne rien remplacer si le fichier existe", "Defaut du script thumbnails sans --force"],
    ["Creer une vignette manquante option 1", "Qwen-Image si disponible", "Limite par lancement pour proteger les credits"],
    ["Creer une vignette manquante option 2", "Generation locale WebP via SVG + Sharp", "Fallback gratuit automatique"],
    ["Utiliser une vraie image locale", "Mapper un asset dans generate-project-thumbnails.mjs", "Seulement assets publics valides"],
    ["Ajouter une capture projet", "Capture integree pour OK_PUBLIC lancable", "Desktop/mobile dans la fiche, pas vignette par defaut"],
    ["Verifier par IA texte", "Mistral/Qwen peuvent relire un manifeste", "Pas de generation image payante pour la validation"]
  ];
}

function isLaunchableProject(project) {
  return (project.scripts || []).some((script) => ["dev", "preview", "start"].includes(script));
}

function qwenMaxValue() {
  const equals = process.argv.find((item) => item.startsWith("--qwen-max="));
  if (equals) return Math.max(0, Number(equals.slice("--qwen-max=".length)) || 0);
  const index = process.argv.indexOf("--qwen-max");
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return Math.max(0, Number(process.argv[index + 1]) || 0);
  }
  return 1;
}

function isVisibleProject(project) {
  return project.id !== "99-archive" && project.name !== "99_Archive" && project.category !== "archive";
}
