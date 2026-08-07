import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { readJson } from "../scripts/lib/orchestrator-utils.mjs";
import {
  alignedMarkdownTable,
  automationPaths,
  nowIso,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { automatisationsRoot, orchestratorRoot, resultsRoot } = automationPaths(import.meta.url);
const args = parseArgs();
const mode = args.runAll ? "RUN_ALL" : args.testProject ? "TEST_PROJET" : "AUDIT";
const tasks = [
  { id: "01", label: "Scan etat projets", script: "01-scan-etat-projets.mjs", active: true },
  { id: "02", label: "Moteur audit", script: "02-moteur-audit.mjs", active: true },
  { id: "03", label: "Audit securite", script: "03-audit-securite.mjs", active: true },
  { id: "04", label: "Preparation GitHub partage", script: "04-preparation-git-public.mjs", active: true },
  { id: "05", label: "Verification statuts publication", script: "05-verification-statuts-publication.mjs", active: true },
  { id: "06", label: "Deploiement GitHub partage", script: "06-deploiement-repos-github-public.mjs", active: true, supportsProject: true },
  { id: "07", label: "Fiches et vignettes Ma Methode", script: "07-fiches-et-vignettes-ma-methode.mjs", active: true },
  { id: "08", label: "Publication Hostinger Ma Methode", script: "08-publication-hostinger.mjs", active: true }
];

const syntaxResults = await runSyntaxChecks();
const dryRunResults = await runDryRuns();
const realResults = [];
let projectTest = null;
let runAllNotice = null;

if (mode === "TEST_PROJET") {
  projectTest = await runProjectTest();
} else if (mode === "RUN_ALL") {
  if (!args.confirmRunAll) {
    runAllNotice = {
      status: "REFUS_CONFIRMATION",
      message: "Ajouter --confirm-run-all pour lancer les actions RUN globales."
    };
  } else {
    realResults.push(...await runAllActiveTasks());
  }
}

const technicalOk = syntaxResults.every((item) => item.exitCode === 0)
  && dryRunResults.every((item) => item.exitCode === 0);
const realOk = realResults.every((item) => item.exitCode === 0)
  && (!projectTest || projectTest.status !== "FAIL")
  && (!runAllNotice || runAllNotice.status !== "REFUS_CONFIRMATION");
const globalStatus = !technicalOk
  ? "FAIL_TECHNIQUE"
  : mode === "AUDIT"
    ? "OK_TECHNIQUE"
    : realOk
      ? "OK"
      : "A_COMPLETER";

const report = await writeAutomationReport(
  resultsRoot,
  "00-pilote-automatisations",
  renderReport(),
  {
    generatedAt: nowIso(),
    action: "00-pilote-automatisations",
    mode,
    globalStatus,
    technicalOk,
    syntaxResults,
    dryRunResults,
    realResults,
    projectTest,
    runAllNotice
  }
);

console.log(`Pilote automatisations: ${globalStatus}`);
console.log(`Rapport: ${report.mdPath}`);
if (globalStatus === "FAIL_TECHNIQUE") process.exitCode = 1;
if (mode !== "AUDIT" && globalStatus !== "OK") process.exitCode = 1;

async function runSyntaxChecks() {
  return Promise.all(tasks.map((task) => runCommand({
    ...task,
    phase: "syntax",
    displayCommand: `node --check automatisations/${task.script}`,
    command: process.execPath,
    args: ["--check", join(automatisationsRoot, task.script)]
  })));
}

async function runDryRuns() {
  const results = [];
  for (const task of tasks) {
    results.push(await runCommand({
      ...task,
      phase: "dry-run",
      displayCommand: `node automatisations/${task.script}`,
      command: process.execPath,
      args: [join(automatisationsRoot, task.script)]
    }));
  }
  return results;
}

async function runProjectTest() {
  const projectQuery = String(args.project || "").trim();
  if (!projectQuery) {
    return { status: "FAIL", message: "Projet manquant. Utiliser --project <nom-ou-id>." };
  }

  const project = await findProject(projectQuery);
  if (!project) {
    return { status: "FAIL", message: `Projet introuvable: ${projectQuery}` };
  }

  const steps = [];
  steps.push(await runCommand({
    id: "04",
    label: "Run reel cible action 04",
    phase: "project-test",
    displayCommand: `node automatisations/04-preparation-git-public.mjs --run --project ${projectQuery}`,
    command: process.execPath,
    args: [join(automatisationsRoot, "04-preparation-git-public.mjs"), "--run", "--project", projectQuery]
  }));

  const buildStep = await runProjectBuild(project);
  if (buildStep) steps.push(buildStep);

  const publicFileCheck = await checkGeneratedPublicFiles(project);
  const failed = steps.some((item) => item.exitCode !== 0) || publicFileCheck.status === "FAIL";
  return {
    status: failed ? "FAIL" : "OK",
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      securityStatus: project.securityStatus,
      publicationStatus: project.publicationStatus
    },
    steps,
    publicFileCheck,
    note: "Test reel limite au projet cible: preparation GitHub partage et build; aucun push hors tache 06 en mode publication."
  };
}

async function runAllActiveTasks() {
  const active = tasks.filter((task) => task.active);
  const results = [];
  for (const task of active) {
    const extraArgs = task.id === "07" && args.localOnly ? ["--run", "--local-only"] : ["--run"];
    results.push(await runCommand({
      ...task,
      phase: "run-all",
      displayCommand: `node automatisations/${task.script} ${extraArgs.join(" ")}`,
      command: process.execPath,
      args: [join(automatisationsRoot, task.script), ...extraArgs]
    }));
  }
  return results;
}

async function runProjectBuild(project) {
  const packageJsonPath = join(project.path, "package.json");
  if (!existsSync(packageJsonPath)) return null;
  const packageJson = await readJson(packageJsonPath, {});
  if (!packageJson.scripts?.build) {
    return {
      id: "build",
      label: "Build projet",
      phase: "project-test",
      displayCommand: "npm run build",
      status: "SKIP",
      exitCode: 0,
      durationMs: 0,
      output: "Aucun script build detecte."
    };
  }
  return runCommand({
    id: "build",
    label: "Build projet",
    phase: "project-test",
    displayCommand: "npm run build",
    command: process.platform === "win32" ? "cmd.exe" : "npm",
    args: process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"],
    cwd: project.path,
    timeoutMs: 10 * 60 * 1000
  });
}

async function checkGeneratedPublicFiles(project) {
  const files = [
    "README_GITHUB_PUBLIC.md",
    "PREPARATION_GITHUB_PUBLIC.md",
    "PREPARATION_GITHUB_PUBLIC.json"
  ];
  const patterns = [
    { label: "chemin-local", regex: /[A-Z]:\\/i },
    { label: "cle-hostinger-interne", regex: /"hostingerUrl"\s*:/i },
    { label: "token-openai", regex: /sk-[A-Za-z0-9_-]{12,}/ },
    { label: "token-github", regex: /(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]+/i },
    { label: "cle-google", regex: /AIza[A-Za-z0-9_-]{20,}/ },
    { label: "valeur-secret", regex: /(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*[^\\s'"]{4,}/i }
  ];
  const rows = [];
  for (const file of files) {
    const absolutePath = join(project.path, file);
    if (!existsSync(absolutePath)) {
      rows.push({ file, status: "MANQUE", issue: "fichier non genere" });
      continue;
    }
    const text = await readFile(absolutePath, "utf8").catch(() => "");
    const issues = patterns.filter((pattern) => pattern.regex.test(text)).map((pattern) => pattern.label);
    rows.push({ file, status: issues.length ? "FAIL" : "OK", issue: issues.join(", ") || "-" });
  }
  return {
    status: rows.some((row) => row.status !== "OK") ? "FAIL" : "OK",
    rows
  };
}

async function findProject(query) {
  const registry = await readJson(join(orchestratorRoot, "config", "projects.registry.json"), { projects: [] });
  const needle = query.toLowerCase();
  return (registry.projects || []).find((project) => {
    const values = [project.id, project.name, basename(project.path || "")].filter(Boolean);
    return values.some((value) => String(value).toLowerCase().includes(needle));
  }) || null;
}

function runCommand(spec) {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const done = (error, stdout = "", stderr = "") => {
      const exitCode = error ? (Number.isInteger(error.code) ? error.code : 1) : 0;
      const errorOutput = error && !Number.isInteger(error.code) ? error.message : "";
      const output = [stdout, stderr, errorOutput].filter(Boolean).join("\n").trim();
      resolvePromise({
        id: spec.id,
        label: spec.label,
        phase: spec.phase,
        status: exitCode === 0 ? (automationStatus(output) || "OK") : "FAIL",
        exitCode,
        durationMs: Date.now() - started,
        displayCommand: spec.displayCommand,
        output: output || "-"
      });
    };
    try {
      execFile(spec.command, spec.args, {
        cwd: spec.cwd || orchestratorRoot,
        windowsHide: true,
        timeout: spec.timeoutMs || 20 * 60 * 1000,
        maxBuffer: 60 * 1024 * 1024
      }, done);
    } catch (error) {
      done(error);
    }
  });
}

function automationStatus(output) {
  const match = String(output || "").match(/(?:Automatisation \d+|Pilote automatisations):\s*([A-Z0-9_]+)/i);
  return match ? match[1].toUpperCase() : "";
}

function renderReport() {
  return `# Pilote automatisations 00

- Date: ${nowIso()}
- Mode: ${mode}
- Statut global: **${globalStatus}**
- Garantie: aucun push GitHub automatique hors tache 06 et aucune publication Hostinger directe hors MCP. La tache 08 prepare seulement le handoff Hostinger.

## Audit syntaxe

${alignedMarkdownTable(
  ["Tache", "Role", "Statut", "Commande"],
  syntaxResults.map((item) => [item.id, item.label, item.status, item.displayCommand])
)}

## Audit dry-run

${alignedMarkdownTable(
  ["Tache", "Role", "Statut", "Code", "Sortie"],
  dryRunResults.map((item) => [
    item.id,
    item.label,
    item.status,
    item.exitCode,
    trimText(item.output, 180)
  ])
)}

## Interpretation

${technicalOk
    ? "- Les taches 01 a 08 sont executables techniquement en dry-run."
    : "- Une erreur technique bloque l'enchainement. Voir les lignes FAIL."}
- Les statuts metier comme \`BLOQUE_GITHUB_PUBLIC\`, \`ACTIONS_MANUELLES\` ou \`A_COMPLETER\` restent des garde-fous normaux: ils empechent de publier trop vite, ils ne sont pas des erreurs du pilote.
- La tache 05 est conservee comme alias historique; la chaine active utilise la tache 06 pour GitHub public, prive et vitrine.

${mode === "TEST_PROJET" ? renderProjectTest() : ""}
${mode === "RUN_ALL" ? renderRunAll() : ""}

## Commandes

${alignedMarkdownTable(
  ["Besoin", "Commande"],
  [
    ["Audit complet", "node automatisations/00-pilote-automatisations.mjs"],
    ["Test reel projet", "node automatisations/00-pilote-automatisations.mjs --test-project --project <nom>"],
    ["Run global confirme", "node automatisations/00-pilote-automatisations.mjs --run-all --confirm-run-all"],
    ["Run global sans Qwen", "node automatisations/00-pilote-automatisations.mjs --run-all --confirm-run-all --local-only"]
  ]
)}
`;
}

function renderProjectTest() {
  if (!projectTest) return "";
  if (projectTest.status === "FAIL" && !projectTest.steps) {
    return `## Test reel projet

- Statut: **FAIL**
- Detail: ${projectTest.message}
`;
  }
  return `## Test reel projet

- Projet: ${projectTest.project.name}
- Securite: ${projectTest.project.securityStatus}
- Publication: ${projectTest.project.publicationStatus}
- Statut: **${projectTest.status}**
- Note: ${projectTest.note}

${alignedMarkdownTable(
    ["Etape", "Statut", "Code", "Duree", "Sortie"],
    projectTest.steps.map((item) => [
      item.label,
      item.status,
      item.exitCode,
      `${item.durationMs} ms`,
      trimText(item.output, 180)
    ])
  )}

### Controle fichiers publics

${alignedMarkdownTable(
    ["Fichier", "Statut", "Issue"],
    projectTest.publicFileCheck.rows.map((row) => [row.file, row.status, row.issue])
  )}
`;
}

function renderRunAll() {
  if (runAllNotice) {
    return `## Run global

- Statut: **${runAllNotice.status}**
- Detail: ${runAllNotice.message}
`;
  }
  return `## Run global

${alignedMarkdownTable(
    ["Tache", "Role", "Statut", "Code", "Sortie"],
    realResults.map((item) => [
      item.id,
      item.label,
      item.status,
      item.exitCode,
      trimText(item.output, 180)
    ])
  )}
`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--audit") parsed.audit = true;
    else if (item === "--test-project") parsed.testProject = true;
    else if (item === "--run-all") parsed.runAll = true;
    else if (item === "--confirm-run-all") parsed.confirmRunAll = true;
    else if (item === "--local-only") parsed.localOnly = true;
    else if (item === "--project") parsed.project = argv[index + 1] || "";
    else if (item.startsWith("--project=")) parsed.project = item.slice("--project=".length);
    if (item === "--project") index += 1;
  }
  return parsed;
}
