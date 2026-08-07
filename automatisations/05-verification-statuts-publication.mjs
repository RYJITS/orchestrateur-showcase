import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  gitStatus,
  loadRegistry,
  readJson
} from "../scripts/lib/orchestrator-utils.mjs";
import {
  alignedMarkdownTable,
  automationPaths,
  latestJsonReport,
  nowIso,
  parseAutomationArgs,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { orchestratorRoot, resultsRoot } = automationPaths(import.meta.url);
const args = parseAutomationArgs();
const shouldRun = Boolean(args.run);
const githubRules = await readJson(join(orchestratorRoot, "config", "github.rules.json"), {});
const latestAction02 = await latestAction02Report();
const latestAction04 = await latestJsonReport(resultsRoot, "04-preparation-git-public", (data) => Boolean(data?.preparations)).catch(() => null);
const preparationByProject = new Map(
  (latestAction04?.data?.preparations || []).map((item) => [item.project?.name, item])
);
const action04AppliedByProject = new Map(
  (latestAction04?.data?.applied || []).map((item) => [item.project, item])
);
const registry = await loadRegistry();
const projectsByName = new Map((registry.projects || []).map((project) => [project.name, project]));
const targetProjectNames = selectedProjectNames(registry.projects || [], args.project);
const plan = await buildCorrectionPlan(latestAction02.data);
const applied = [];

if (shouldRun) {
  for (const action of plan.actions.filter((item) => item.mode === "auto")) {
    applied.push(await applyAction(action));
  }
}

const globalStatus = plan.counts.blocked
  ? "ACTIONS_BLOQUEES"
  : plan.counts.manual
    ? "ACTIONS_MANUELLES"
    : plan.counts.auto
      ? shouldRun ? "ACTIONS_APPLIQUEES" : "ACTIONS_PRETES"
      : "OK";

const report = await writeAutomationReport(
  resultsRoot,
  "05-verification-statuts-publication",
  `# Automatisation 05 - Verification statuts publication

- Date: ${nowIso()}
- Mode: ${shouldRun ? "RUN" : "DRY_RUN"}
- Statut global: **${globalStatus}**
- Source action 02: \`${latestAction02.path}\`
- Source action 04: ${latestAction04?.path ? `\`${latestAction04.path}\`` : "aucun rapport 04 exploitable"}

## Resultat lisible

${alignedMarkdownTable(
  ["Controle", "Resultat"],
  [
    ["Statuts source analyses", plan.counts.total],
    ["Lignes d'action controlees", plan.counts.actionRows],
    ["OK / aucune action", plan.counts.none],
    ["A faire automatique", plan.counts.auto],
    ["A faire manuel", plan.counts.manual],
    ["Bloque securite", plan.counts.blocked],
    ["Actions appliquees", shouldRun ? applied.filter((item) => item.status === "OK").length : "-"],
    ["Actions en erreur", shouldRun ? applied.filter((item) => item.status === "FAIL").length : "-"]
  ]
)}

## Definition des statuts d'action

${alignedMarkdownTable(
  ["Statut action", "Sens"],
  actionStatusDefinitionRows()
)}

## Actions par statut Hostinger Vite

${alignedMarkdownTable(
  ["Projet", "Statut Vite", "Statut action", "Action", "Mode", "Pourquoi"],
  plan.hostingerRows
)}

## Actions par statut GitHub

${alignedMarkdownTable(
  ["Projet", "Statut GitHub", "Statut action", "Action", "Mode", "Pourquoi"],
  plan.githubRows
)}

## Actions automatiques

${plan.autoRows.length
  ? alignedMarkdownTable(["Projet", "Action", "Statut action", "Mode", "Etat"], plan.autoRows)
  : "- Aucune action automatique disponible."}

## Actions manuelles

${plan.manualRows.length
  ? alignedMarkdownTable(["Projet", "Action", "Statut source", "Statut action", "Raison"], plan.manualRows)
  : "- Aucune action manuelle requise."}

## Execution

${shouldRun
  ? applied.length
    ? alignedMarkdownTable(["Projet", "Action", "Statut action", "Resultat", "Details"], applied.map((item) => [item.project, item.action, appliedActionStatus(item), item.status, item.details]))
    : "- Aucune action automatique a appliquer."
  : "- Dry-run uniquement. Relancer avec '--run' ou choisir 'R' dans le lanceur pour appliquer les actions automatiques sures avant publication."}

## Regles

- Pas de suppression automatique.
- Pas de 'git add', pas de commit, pas de push.
- Pas de reecriture d'historique Git.
- Les secrets, fichiers suivis dangereux et historiques bloques restent en correction manuelle.
`,
  {
    generatedAt: nowIso(),
    action: "05-verification-statuts-publication",
    mode: shouldRun ? "RUN" : "DRY_RUN",
    globalStatus,
    sourceAction02: latestAction02.path,
    sourceAction04: latestAction04?.path || null,
    actionStatusDefinitions: actionStatusDefinitionRows().map(([status, meaning]) => ({ status, meaning })),
    counts: plan.counts,
    actions: plan.actions,
    applied
  }
);

console.log(`Automatisation 05: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (shouldRun && applied.some((item) => item.status === "FAIL")) process.exitCode = 1;

async function buildCorrectionPlan(action02) {
  let hostDetails = action02.hostingerVite?.details || [];
  let githubDetails = action02.githubGitOnly?.details || [];
  if (targetProjectNames) {
    hostDetails = hostDetails.filter((item) => targetProjectNames.has(item.project));
    githubDetails = githubDetails.filter((item) => targetProjectNames.has(item.project));
  }
  hostDetails = hostDetails.map(refreshHostingerDetail);
  githubDetails = await Promise.all(githubDetails.map(refreshGithubDetail));
  const hostingerRows = [];
  const githubRows = [];
  const actions = [];
  const allCorrectionRows = [];

  for (const item of hostDetails) {
    const correction = withActionStatus(correctionForHostinger(item));
    const row = { ...correction, project: item.project, family: "hostinger", status: item.status };
    allCorrectionRows.push(row);
    hostingerRows.push([item.project, item.status, correction.actionStatus, correction.action, correction.mode, correction.reason]);
    if (correction.mode !== "none") actions.push(row);
  }

  for (const item of githubDetails) {
    const corrections = correctionsForGithub(item).map(withActionStatus);
    for (const correction of corrections) {
      const row = { ...correction, project: item.project, family: "github", status: item.status };
      allCorrectionRows.push(row);
      githubRows.push([item.project, item.status, correction.actionStatus, correction.action, correction.mode, correction.reason]);
      if (correction.mode !== "none") actions.push(row);
    }
    if (!corrections.length) {
      const correction = withActionStatus({ action: "Aucune action", mode: "none", reason: "Statut deja OK." });
      allCorrectionRows.push({ ...correction, project: item.project, family: "github", status: item.status });
      githubRows.push([item.project, item.status, correction.actionStatus, correction.action, correction.mode, correction.reason]);
    }
  }

  const autoRows = actions
    .filter((item) => item.mode === "auto")
    .map((item) => [item.project, item.action, item.actionStatus, shouldRun ? "execution" : "pret", item.reason]);
  const manualRows = actions
    .filter((item) => item.mode === "manual" || item.mode === "blocked")
    .map((item) => [item.project, item.action, item.status, item.actionStatus, item.reason]);

  return {
    counts: {
      total: hostDetails.length + githubDetails.length,
      actionRows: allCorrectionRows.length,
      none: allCorrectionRows.filter((item) => item.actionStatus === "OK_AUCUNE_ACTION").length,
      auto: actions.filter((item) => item.mode === "auto").length,
      manual: actions.filter((item) => item.mode === "manual").length,
      blocked: actions.filter((item) => item.mode === "blocked").length
    },
    hostingerRows,
    githubRows,
    autoRows,
    manualRows,
    actions
  };
}

function refreshHostingerDetail(item) {
  const applied = action04AppliedByProject.get(item.project);
  const preparation = preparationByProject.get(item.project);
  if (applied?.build?.status === "OK") {
    return {
      ...item,
      status: "OK_HOSTINGER_VITE",
      warnings: [],
      sourceAction04: latestAction04?.path || null,
      reason: "Build Vite/Node deja valide par la tache 04."
    };
  }
  if (applied?.build?.status === "FAIL") {
    return {
      ...item,
      status: "NEEDS_VITE_BUILD",
      warnings: [applied.build.details || "build-echec-action-04"],
      sourceAction04: latestAction04?.path || null
    };
  }
  if (preparation?.status === "READY_GITHUB_PUBLIC" && preparation?.localInstall?.buildCommand) {
    return {
      ...item,
      status: "OK_HOSTINGER_VITE",
      warnings: [],
      sourceAction04: latestAction04?.path || null,
      reason: "La tache 04 couvre le build Vite/Node avant publication."
    };
  }
  return item;
}

async function refreshGithubDetail(item) {
  if (String(item.status || "").startsWith("BLOCKED_GITHUB")) return item;
  const preparation = preparationByProject.get(item.project);
  if (preparation?.status === "READY_GITHUB_PUBLIC" || preparation?.status === "READY_GITHUB_PRIVATE_SHOWCASE") {
    const readyStatus = preparation.status === "READY_GITHUB_PRIVATE_SHOWCASE"
      ? "OK_GITHUB_PRIVATE_SHOWCASE"
      : "OK_GITHUB_PUBLIC";
    return {
      ...item,
      status: readyStatus,
      warnings: [
        ...(preparation.gitChangePlan?.publicUseful?.length ? ["git-changements-utiles-controles-par-04"] : []),
        ...(preparation.gitChangePlan?.ignoredLocal?.length ? ["git-changements-internes-ignores-par-04"] : [])
      ],
      trackedCount: preparation.git?.trackedFilesCount || preparation.git?.trackedCount || 0,
      currentGitStatus: preparation.status,
      sourceAction04: latestAction04?.path || null
    };
  }
  if (preparation?.gitChangePlan?.reviewRequired?.length) {
    return {
      ...item,
      status: "REVIEW_GITHUB_DATA",
      warnings: ["git-changements-a-revoir"],
      trackedCount: preparation.git?.trackedFilesCount || preparation.git?.trackedCount || 0,
      currentGitStatus: preparation.git?.status || "REVUE_GIT_REQUISE",
      sourceAction04: latestAction04?.path || null
    };
  }
  const project = projectsByName.get(item.project);
  if (!project) return item;
  const git = await gitStatus(project.path);
  const trackedCount = git.hasGit ? await gitTrackedCount(project.path) : 0;
  if (!git.hasGit) {
    return { ...item, status: "NO_GIT", warnings: ["git-local-absent"], trackedCount, currentGitStatus: git.status };
  }
  const warnings = [];
  if (!trackedCount) warnings.push("aucun-fichier-suivi-par-git");
  if (git.dirty) warnings.push("git-avec-changements-locaux");
  return {
    ...item,
    status: warnings.length ? "REVIEW_GITHUB_DATA" : "OK_GITHUB_PUBLIC",
    warnings,
    trackedCount,
    currentGitStatus: git.status
  };
}

async function gitTrackedCount(projectPath) {
  try {
    const output = await execFileText("git", ["ls-files"], projectPath, 10000);
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
  } catch {
    return 0;
  }
}

function selectedProjectNames(projects, target) {
  const query = String(target || "").trim();
  if (!query) return null;
  const needle = normalize(query);
  const names = new Set();
  for (const project of projects) {
    const values = [project.id, project.name, project.path, basename(project.path || "")].filter(Boolean);
    if (values.some((value) => normalize(value).includes(needle) || needle.includes(normalize(value)))) {
      names.add(project.name);
    }
  }
  return names;
}

function withActionStatus(correction) {
  return {
    ...correction,
    actionStatus: correction.actionStatus || actionStatusForMode(correction.mode)
  };
}

function actionStatusForMode(mode) {
  if (mode === "none") return "OK_AUCUNE_ACTION";
  if (mode === "auto") return "A_FAIRE_AUTO";
  if (mode === "manual") return "A_FAIRE_MANUEL";
  if (mode === "blocked") return "BLOQUE_SECURITE";
  return "A_ANALYSER";
}

function actionStatusDefinitionRows() {
  return [
    ["OK_AUCUNE_ACTION", "Le controle passe deja ou ne concerne pas ce canal."],
    ["A_FAIRE_AUTO", "Correction sure disponible via l'action 04 en mode RUN."],
    ["A_FAIRE_MANUEL", "Correction a faire/revoir manuellement avant publication."],
    ["BLOQUE_SECURITE", "Publication bloquee tant que le probleme securite n'est pas corrige."],
    ["APPLIQUE_OK", "Action automatique executee avec succes pendant un RUN."],
    ["ECHEC_ACTION", "Action automatique tentee mais en erreur pendant un RUN."],
    ["A_ANALYSER", "Statut non reconnu a analyser avant toute action."]
  ];
}

function appliedActionStatus(item) {
  return item.status === "OK" ? "APPLIQUE_OK" : "ECHEC_ACTION";
}

function correctionForHostinger(item) {
  if (item.status === "OK_HOSTINGER_VITE") {
    return { action: "Aucune action", mode: "none", reason: "Build Vite publiable." };
  }
  if (item.status === "NEEDS_VITE_BUILD") {
    return {
      action: "Lancer npm run build",
      mode: "auto",
      kind: "vite-build",
      reason: "Le dossier publie Vite est manquant."
    };
  }
  if (item.status === "REVIEW_HOSTINGER_VITE") {
    return {
      action: "Verifier le build Vite puis rebuild",
      mode: "manual",
      reason: item.warnings?.join?.("; ") || "Le build contient un fichier ou motif a verifier."
    };
  }
  if (item.status === "BLOCKED_HOSTINGER_VITE") {
    return {
      action: "Corriger les fichiers publies bloques",
      mode: "blocked",
      reason: item.blockers?.join?.("; ") || "Le build contient un element interdit."
    };
  }
  if (item.status === "NON_VITE") {
    return { action: "Ignorer Hostinger Vite", mode: "none", reason: "Projet non Vite." };
  }
  return { action: "Analyser statut Hostinger inconnu", mode: "manual", reason: item.status || "Statut inconnu." };
}

function correctionsForGithub(item) {
  if (item.status === "OK_GITHUB_PUBLIC" || item.status === "OK_GITHUB_PRIVATE" || item.status === "OK_GITHUB_PRIVATE_SHOWCASE" || item.status === "OK_GIT_LOCAL") {
    return [{ action: "Aucune action", mode: "none", reason: "GitHub git-only deja OK." }];
  }
  if (item.status === "NO_GIT") {
    return [{
      action: "Initialiser Git apres validation",
      mode: "manual",
      reason: "GitHub impossible sans depot Git local."
    }];
  }
  if (item.status === "BLOCKED_GITHUB_SECRETS") {
    return [{
      action: "Retirer/remplacer les secrets suivis",
      mode: "blocked",
      reason: item.blockers?.join?.("; ") || "Secret suivi par Git."
    }];
  }
  if (item.status === "BLOCKED_GITHUB_HISTORY") {
    return [{
      action: "Nettoyer l'historique ou garder en prive",
      mode: "blocked",
      reason: item.blockers?.join?.("; ") || "Historique Git sensible."
    }];
  }
  if (item.status === "REVIEW_GITHUB_DATA") {
    const corrections = [];
    if (item.gitignoreMissing?.length || /^MANQUE|A_COMPLETER/.test(item.gitignoreStatus || "")) {
      corrections.push({
        action: "Completer .gitignore",
        mode: "auto",
        kind: "gitignore",
        missing: item.gitignoreMissing || missingFromGitignoreStatus(item.gitignoreStatus),
        reason: "Regles GitHub manquantes dans .gitignore."
      });
    }
    if ((item.warnings || []).some((warning) => String(warning).includes("aucun-fichier-suivi-par-git"))) {
      corrections.push({
        action: "Choisir les fichiers publics a suivre",
        mode: "manual",
        reason: "Aucun fichier n'est suivi par Git; pas de git add automatique."
      });
    }
    if ((item.warnings || []).some((warning) => String(warning).includes("git-avec-changements-locaux"))) {
      corrections.push({
        action: "Revoir les changements locaux",
        mode: "manual",
        reason: "Git contient des modifications; pas de commit automatique."
      });
    }
    if ((item.warnings || []).some((warning) => String(warning).includes("git-changements-a-revoir"))) {
      corrections.push({
        action: "Revoir les changements Git non classes",
        mode: "manual",
        reason: "La tache 04 a detecte au moins un changement non publiable automatiquement."
      });
    }
    if ((item.warnings || []).some((warning) => String(warning).includes("secrets-possibles"))) {
      corrections.push({
        action: "Verifier les secrets possibles",
        mode: "manual",
        reason: "Un motif secret possible doit etre confirme ou corrige."
      });
    }
    return corrections.length ? corrections : [{
      action: "Revue manuelle GitHub",
      mode: "manual",
      reason: "Statut REVIEW_GITHUB_DATA sans correction automatique claire."
    }];
  }
  return [{ action: "Analyser statut GitHub inconnu", mode: "manual", reason: item.status || "Statut inconnu." }];
}

async function applyAction(action) {
  const project = projectsByName.get(action.project);
  if (!project) {
    return { project: action.project, action: action.action, status: "FAIL", details: "Projet absent du registre." };
  }
  if (action.kind === "gitignore") return applyGitignoreAction(project, action);
  if (action.kind === "vite-build") return applyViteBuildAction(project);
  return { project: action.project, action: action.action, status: "FAIL", details: "Action automatique inconnue." };
}

async function applyGitignoreAction(project, action) {
  const file = join(project.path, ".gitignore");
  const groups = requiredGitignoreGroups().filter((group) => action.missing?.includes(group.label));
  if (!groups.length) {
    return { project: project.name, action: action.action, status: "OK", details: "Aucune regle manquante." };
  }
  await mkdir(dirname(file), { recursive: true });
  const current = existsSync(file) ? await readFile(file, "utf8").catch(() => "") : "";
  const lines = current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const additions = [];
  for (const group of groups) {
    for (const pattern of group.patterns) {
      if (!gitignoreHas(lines, pattern)) additions.push(pattern);
    }
  }
  if (!additions.length) {
    return { project: project.name, action: action.action, status: "OK", details: ".gitignore deja complet." };
  }
  const block = [
    "",
    "# Ajout automatique orchestrateur - publication GitHub",
    ...additions
  ].join("\n");
  await appendFile(file, `${block}\n`, "utf8");
  return { project: project.name, action: action.action, status: "OK", details: `Ajoute: ${additions.join(", ")}` };
}

async function applyViteBuildAction(project) {
  const packageJson = await readJson(join(project.path, "package.json"), null);
  if (!packageJson?.scripts?.build) {
    return { project: project.name, action: "Lancer npm run build", status: "FAIL", details: "Script build absent." };
  }
  try {
    const output = await execFileText("npm", ["run", "build"], project.path, 10 * 60 * 1000);
    return { project: project.name, action: "Lancer npm run build", status: "OK", details: trim(output) };
  } catch (error) {
    return { project: project.name, action: "Lancer npm run build", status: "FAIL", details: trim(error.stdout || error.stderr || error.message) };
  }
}

async function latestAction02Report() {
  const report = await latestJsonReport(
    resultsRoot,
    "02-moteur-audit",
    (data) => Boolean(data?.hostingerVite && data?.githubGitOnly)
  );
  if (report) return report;
  throw new Error("Aucun rapport JSON action 02 exploitable trouve. Lance d'abord l'action 02.");
}

function requiredGitignoreGroups() {
  return githubRules.gitOnlyPublication?.requiredGitignoreGroups || [
    { label: "env", patterns: [".env", ".env*", ".env.local"] },
    { label: "node_modules", patterns: ["node_modules", "node_modules/"] },
    { label: "sessions", patterns: ["session", "sessions", "baileys-auth"] },
    { label: "logs", patterns: ["*.log", "logs", "logs/"] },
    { label: "private-keys", patterns: ["*.pem", "*.key", "*.p12", "*.pfx"] }
  ];
}

function missingFromGitignoreStatus(status) {
  const match = String(status || "").match(/^A_COMPLETER:(.+)$/);
  if (!match) return requiredGitignoreGroups().map((group) => group.label);
  return match[1].split(",").map((item) => item.trim()).filter(Boolean);
}

function gitignoreHas(lines, pattern) {
  const wanted = String(pattern || "").toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
  return lines.some((line) => {
    const normalized = line.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
    return normalized === wanted || normalized.includes(wanted);
  });
}

function execFileText(command, commandArgs, cwd, timeout) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, commandArgs, { cwd, windowsHide: true, timeout, maxBuffer: 20 * 1024 * 1024 }, (error, stdout = "", stderr = "") => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        rejectPromise(error);
        return;
      }
      resolvePromise(stdout || stderr || "OK");
    });
  });
}

function trim(value) {
  return trimText(value, 180);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, "-")
    .replace(/\\/g, "/");
}
