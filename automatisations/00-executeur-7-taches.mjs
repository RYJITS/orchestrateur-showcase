import { execFile } from "node:child_process";
import { basename, join, resolve } from "node:path";
import {
  ensureDir,
  loadRegistry,
  parseArgs,
  toPosixPath,
  writeJson,
  writeText
} from "../scripts/lib/orchestrator-utils.mjs";
import { displayName } from "../scripts/lib/project-content.mjs";
import {
  alignedMarkdownTable,
  automationPaths,
  latestJsonReport,
  nowIso,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { automatisationsRoot, orchestratorRoot, resultsRoot } = automationPaths(import.meta.url);
const args = parseArgs();
const resultName = "00-executeur-7-taches";
const resultRoot = join(resultsRoot, resultName);
await ensureDir(resultRoot);

if (args.list || args.scanList) {
  await runList();
} else {
  await runTasks();
}

async function runList() {
  const listRun = await runCommand({
    label: "Lister les projets",
    command: process.execPath,
    args: [join(automatisationsRoot, "00-executeur-projets.mjs"), "--list"],
    displayCommand: "node automatisations/00-executeur-projets.mjs --list"
  });
  const registry = await loadRegistry();
  const projects = visibleProjects(registry.projects || []).map(projectListRow);
  const data = {
    generatedAt: nowIso(),
    action: resultName,
    mode: "LIST",
    listRun,
    count: projects.length,
    projects
  };
  const markdown = `# Executeur simple 8 taches

- Date: ${data.generatedAt}
- Mode: LIST
- Projets visibles: ${projects.length}

${alignedMarkdownTable(
    ["Projet", "Id", "Section", "Securite", "Publication", "Git"],
    projects.map((project) => [
      project.name,
      project.id,
      project.category,
      project.securityStatus,
      project.publicationStatus,
      project.git
    ])
  )}
`;
  const report = await writeAutomationReport(resultsRoot, resultName, markdown, data);
  await writeText(join(resultRoot, "last-execution.md"), markdown);
  await writeJson(join(resultRoot, "last-execution.json"), data);
  console.log("Executeur 8 taches: LIST");
  console.log(`Projets: ${projects.length}`);
  console.log(`Rapport: ${report.mdPath}`);
}

async function runTasks() {
  const registry = await loadRegistry();
  const projects = visibleProjects(registry.projects || []);
  const selectedProjects = selectProjects(projects);
  const tasks = taskList();
  const testMode = Boolean(args.test || args.dryRun);
  const sequentialMode = tasks.length > 1;
  const taskSpecs = tasks.map((task) => taskSpec(task, testMode));
  const githubTaskIndex = tasks.indexOf("06");
  const hubTaskIndex = tasks.indexOf("07");
  if (!testMode && githubTaskIndex >= 0 && hubTaskIndex > githubTaskIndex) {
    const insertAt = hubTaskIndex + 1;
    taskSpecs.splice(insertAt, 0, ...hubGithubResyncSpecs());
  }

  if (!selectedProjects.length) {
    const data = {
      generatedAt: nowIso(),
      action: resultName,
      mode: testMode ? "TEST" : "RUN",
      status: "FAIL",
      reason: "NO_PROJECT",
      tasks
    };
    const markdown = `# Executeur simple 8 taches

- Statut: **FAIL**
- Detail: aucun projet selectionne.
`;
    const report = await writeAutomationReport(resultsRoot, resultName, markdown, data);
    await writeText(join(resultRoot, "last-execution.md"), markdown);
    await writeJson(join(resultRoot, "last-execution.json"), data);
    console.log("Executeur 8 taches: FAIL");
    console.log(`Rapport: ${report.mdPath}`);
    process.exitCode = 1;
    return;
  }

  const taskRuns = [];
  let blockedBy = null;
  const progress = initialProgress({
    mode: testMode ? "TEST" : "RUN",
    scope: args.all ? "TOUS_LES_PROJETS" : "PROJET",
    selectedProjects,
    tasks,
    taskSpecs
  });
  await writeProgress(progress);

  for (const spec of taskSpecs) {
    if (blockedBy) {
      markProgressRunning(progress, spec);
      const skipped = skippedTaskRun(spec, blockedBy);
      taskRuns.push(skipped);
      markProgressDone(progress, skipped);
      await writeProgress(progress);
      continue;
    }
    markProgressRunning(progress, spec);
    await writeProgress(progress);
    const run = await runCommand(spec);
    taskRuns.push(run);
    markProgressDone(progress, run);
    await writeProgress(progress);
    if (sequentialMode && !taskAllowsNext(run)) {
      blockedBy = run;
    }
  }

  markReportRunning(progress);
  await writeProgress(progress);
  const reportScope = scopeArgs();
  const reportRun = await runCommand({
    label: "Actualiser le rapport final",
    command: process.execPath,
    args: [join(automatisationsRoot, "00-rapport-workflow-projets.mjs"), ...reportScope],
    displayCommand: `node automatisations/00-rapport-workflow-projets.mjs ${reportScope.join(" ")}`.trim()
  });
  markReportDone(progress, reportRun);
  await writeProgress(progress);
  const workflow = await latestJsonReport(resultsRoot, "00-rapport-workflow-projets").catch(() => null);
  const projectRows = buildProjectRows(workflow?.data?.projects || [], selectedProjects);
  const status = taskRuns.some((task) => task.status === "FAIL") || reportRun.status === "FAIL"
    ? "ECHEC"
    : projectRows.some((project) => project.state === "BLOQUE")
      ? "A_CORRIGER"
      : projectRows.some((project) => project.state === "A_REVOIR")
        ? "A_REVOIR"
        : projectRows.length && projectRows.every((project) => project.state === "NON_PUBLIC")
          ? "NON_PUBLIC"
          : "OK";

  const data = {
    generatedAt: nowIso(),
    action: resultName,
    mode: testMode ? "TEST" : "RUN",
    status,
    scope: args.all ? "TOUS_LES_PROJETS" : "PROJET",
    selectedProjects: selectedProjects.map(projectListRow),
    tasks,
    taskRuns,
    reportRun,
    projectRows
  };
  const markdown = renderMarkdown(data);
  const report = await writeAutomationReport(resultsRoot, resultName, markdown, data);
  await writeText(join(resultRoot, "last-execution.md"), markdown);
  await writeJson(join(resultRoot, "last-execution.json"), data);
  await writeProgress({
    ...progress,
    updatedAt: nowIso(),
    status,
    percent: 100,
    currentLabel: "Termine",
    completed: progress.totalSteps,
    taskRuns,
    reportRun,
    projectRows
  });
  console.log(`Executeur 8 taches: ${status}`);
  console.log(`Mode: ${data.mode}`);
  console.log(`Portee: ${data.scope}`);
  console.log(`Taches: ${tasks.join(", ")}`);
  console.log(`Rapport: ${report.mdPath}`);
  if (status === "ECHEC") process.exitCode = 1;
}

function taskSpec(task, testMode) {
  const scope = scopeArgs();
  const runFlag = testMode ? [] : ["--run"];
  const publishFlag = testMode ? [] : ["--publish"];
  const testFlag = testMode ? ["--test"] : [];
  const captures = args.noCaptures ? [] : ["captures"];
  const ficheActions = [...captures, "ai-draft", "fiches", "thumbnails", "site"];
  const localFlag = args.localOnly || args.noQwen ? ["--local-only"] : [];
  const hostingerArgs = args.domain ? ["--domain", String(args.domain)] : [];
  const specs = {
    "01": {
      label: "01 - Scan etat projets",
      args: [join(automatisationsRoot, "00-executeur-projets.mjs"), ...scope, "--actions", "scan", ...testFlag],
      displayCommand: `node automatisations/00-executeur-projets.mjs ${scope.join(" ")} --actions scan${testFlag.length ? " --test" : ""}`
    },
    "02": {
      label: "02 - Moteur audit projet",
      args: [join(automatisationsRoot, "00-executeur-projets.mjs"), ...scope, "--actions", "security,functionality", ...testFlag],
      displayCommand: `node automatisations/00-executeur-projets.mjs ${scope.join(" ")} --actions security,functionality${testFlag.length ? " --test" : ""}`
    },
    "03": {
      label: "03 - Audit securite",
      args: [join(automatisationsRoot, "00-executeur-projets.mjs"), ...scope, "--actions", "security", ...testFlag],
      displayCommand: `node automatisations/00-executeur-projets.mjs ${scope.join(" ")} --actions security${testFlag.length ? " --test" : ""}`
    },
    "04": {
      label: "04 - Preparation GitHub partage",
      args: [join(automatisationsRoot, "04-preparation-git-public.mjs"), ...projectOnlyArgs(), ...runFlag],
      displayCommand: `node automatisations/04-preparation-git-public.mjs ${projectOnlyArgs().join(" ")}${runFlag.length ? " --run" : ""}`.trim()
    },
    "05": {
      label: "05 - Verification statuts publication",
      args: [join(automatisationsRoot, "05-verification-statuts-publication.mjs"), ...projectOnlyArgs(), ...runFlag],
      displayCommand: `node automatisations/05-verification-statuts-publication.mjs ${projectOnlyArgs().join(" ")}${runFlag.length ? " --run" : ""}`.trim()
    },
    "06": {
      label: "06 - Publier GitHub partage",
      args: [join(automatisationsRoot, "06-deploiement-repos-github-public.mjs"), ...projectOnlyArgs(), ...runFlag, ...publishFlag],
      displayCommand: `node automatisations/06-deploiement-repos-github-public.mjs ${projectOnlyArgs().join(" ")}${runFlag.length ? " --run" : ""}${publishFlag.length ? " --publish" : ""}`.trim()
    },
    "07": {
      label: "07 - Fiches et vignettes Ma Methode",
      args: [
        join(automatisationsRoot, "00-executeur-projets.mjs"),
        ...scope,
        "--actions",
        ficheActions.join(","),
        ...testFlag,
        ...localFlag
      ],
      displayCommand: `node automatisations/00-executeur-projets.mjs ${scope.join(" ")} --actions ${ficheActions.join(",")}${testFlag.length ? " --test" : ""}${localFlag.length ? " --local-only" : ""}`
    },
    "08": {
      label: "08 - Publication Hostinger Ma Methode",
      args: [join(automatisationsRoot, "08-publication-hostinger.mjs"), ...runFlag, ...publishFlag, ...hostingerArgs],
      displayCommand: `node automatisations/08-publication-hostinger.mjs${runFlag.length ? " --run" : ""}${publishFlag.length ? " --publish" : ""}${hostingerArgs.length ? ` ${hostingerArgs.join(" ")}` : ""}`.trim()
    }
  };
  const spec = specs[task] || specs["01"];
  return {
    label: spec.label,
    task,
    command: process.execPath,
    args: spec.args,
    cwd: orchestratorRoot,
    displayCommand: spec.displayCommand,
    timeoutMs: 30 * 60 * 1000
  };
}

function hubGithubResyncSpecs() {
  const script = join(automatisationsRoot, "06-deploiement-repos-github-public.mjs");
  const selector = ["--project", "01-site-ma-methode"];
  return [
    {
      label: "07a - Dry-run GitHub du hub apres fiches",
      task: "07a",
      command: process.execPath,
      args: [script, ...selector],
      cwd: orchestratorRoot,
      displayCommand: "node automatisations/06-deploiement-repos-github-public.mjs --project 01-site-ma-methode",
      timeoutMs: 30 * 60 * 1000
    },
    {
      label: "07b - Resynchroniser GitHub du hub",
      task: "07b",
      command: process.execPath,
      args: [script, ...selector, "--run", "--publish", "--no-mistral"],
      cwd: orchestratorRoot,
      displayCommand: "node automatisations/06-deploiement-repos-github-public.mjs --project 01-site-ma-methode --run --publish --no-mistral",
      timeoutMs: 30 * 60 * 1000
    }
  ];
}

function initialProgress({ mode, scope, selectedProjects, tasks, taskSpecs }) {
  const steps = [
    ...taskSpecs.map((spec) => ({
      id: spec.task,
      label: spec.label,
      status: "PENDING",
      command: spec.displayCommand,
      startedAt: null,
      finishedAt: null,
      durationMs: null
    })),
    {
      id: "rapport",
      label: "Actualiser le rapport final",
      status: "PENDING",
      command: "node automatisations/00-rapport-workflow-projets.mjs",
      startedAt: null,
      finishedAt: null,
      durationMs: null
    }
  ];
  return {
    generatedAt: nowIso(),
    updatedAt: nowIso(),
    action: resultName,
    mode,
    scope,
    status: "RUNNING",
    currentTask: "",
    currentLabel: "Preparation",
    percent: 0,
    completed: 0,
    totalSteps: steps.length,
    tasks,
    selectedProjects: selectedProjects.map(projectListRow),
    steps
  };
}

async function writeProgress(progress) {
  progress.updatedAt = nowIso();
  progress.completed = progress.steps.filter((step) => isFinishedProgressStatus(step.status)).length;
  progress.percent = progress.totalSteps
    ? Math.min(100, Math.round((progress.completed / progress.totalSteps) * 100))
    : 0;
  await writeJson(join(resultRoot, "progress.json"), progress);
}

function markProgressRunning(progress, spec) {
  const step = progress.steps.find((item) => item.id === spec.task);
  if (!step) return;
  step.status = "RUNNING";
  step.startedAt = nowIso();
  progress.status = "RUNNING";
  progress.currentTask = spec.task;
  progress.currentLabel = spec.label;
}

function markProgressDone(progress, run) {
  const step = progress.steps.find((item) => item.id === run.task);
  if (!step) return;
  step.status = run.status;
  step.exitCode = run.exitCode;
  step.durationMs = run.durationMs;
  step.finishedAt = nowIso();
  progress.currentLabel = `${run.label}: ${run.status}`;
}

function markReportRunning(progress) {
  const step = progress.steps.find((item) => item.id === "rapport");
  if (!step) return;
  step.status = "RUNNING";
  step.startedAt = nowIso();
  progress.status = "RUNNING";
  progress.currentTask = "rapport";
  progress.currentLabel = step.label;
}

function markReportDone(progress, run) {
  const step = progress.steps.find((item) => item.id === "rapport");
  if (!step) return;
  step.status = run.exitCode === 0 ? "OK" : run.status;
  step.reportStatus = run.status;
  step.exitCode = run.exitCode;
  step.durationMs = run.durationMs;
  step.finishedAt = nowIso();
  progress.currentLabel = `${run.label}: ${run.status}`;
}

function isFinishedProgressStatus(status) {
  const text = String(status || "").toUpperCase();
  return !["", "PENDING", "RUNNING"].includes(text);
}

function taskAllowsNext(taskRun) {
  const status = String(taskRun.status || "").toUpperCase();
  if ([
    "OK",
    "LIST",
    "PUBLIE_GITHUB",
    "PUBLIE_GITHUB_PARTIEL",
    "PRET_GITHUB_PRIVE_VITRINE",
    "PRET_PARTIEL",
    "TEST_PLAN",
    "ACTIONS_PRETES",
    "ACTIONS_APPLIQUEES",
    "ARCHIVE_HOSTINGER_PRETE",
    "READY_MCP_HOSTINGER",
    "DRY_RUN"
  ].includes(status)) return true;
  if (args.all && ["04", "05", "06"].includes(taskRun.task) && !["FAIL", "ECHEC"].includes(status)) {
    return true;
  }
  return false;
}

function skippedTaskRun(spec, blockedBy) {
  const blockedStatus = String(blockedBy.status || "").toUpperCase();
  const nonPublic = blockedStatus === "NON_PUBLIC";
  return {
    task: spec.task || "",
    label: spec.label,
    status: nonPublic ? "SKIPPED_NON_PUBLIC" : "SKIPPED_BLOQUE",
    exitCode: null,
    durationMs: 0,
    command: spec.displayCommand,
    output: nonPublic
      ? `Non lance: la tache ${blockedBy.task || ""} (${blockedBy.label}) a confirme que le projet n'est pas public.`
      : `Non lance: la tache ${blockedBy.task || ""} (${blockedBy.label}) a retourne ${blockedBy.status}.`
  };
}

function scopeArgs() {
  if (args.all) return ["--all"];
  return ["--project", projectSelector()];
}

function projectOnlyArgs() {
  if (args.all) return [];
  return ["--project", projectSelector()];
}

function projectSelector() {
  return String(args.project || "").trim();
}

function taskList() {
  if (args.workflow || args.allTasks) return ["01", "02", "03", "04", "05", "06", "07", "08"];
  const raw = String(args.tasks || args.task || "01");
  return raw.split(",").map(normalizeTask).filter(Boolean);
}

function normalizeTask(value) {
  const text = String(value || "").trim().toLowerCase().replace(/^tache-?/, "");
  const digits = text.replace(/^0?([1-8])$/, "0$1");
  if (/^0[1-8]$/.test(digits)) return digits;
  const aliases = {
    scan: "01",
    audit: "02",
    moteur: "02",
    security: "03",
    securite: "03",
    correction: "05",
    verification: "05",
    statut: "05",
    statuts: "05",
    git: "04",
    preparation: "04",
    github: "06",
    fiches: "07",
    vignettes: "07",
    hostinger: "08",
    publication: "08",
    publier: "08"
  };
  return aliases[text] || "";
}

function buildProjectRows(workflowRows, selectedProjects) {
  const selectedIds = new Set(selectedProjects.map((project) => project.id));
  const selectedNames = new Set(selectedProjects.map((project) => project.name));
  const rows = workflowRows.filter((row) => selectedIds.has(row.id) || selectedNames.has(row.sourceName));
  return rows.map((row) => {
    const analysis = analyzeProject(row);
    return {
      id: row.id,
      project: row.project,
      state: row.status || "A_REVOIR",
      security: row.security || "UNKNOWN",
      publication: row.publication || "UNKNOWN",
      github: row.github || "-",
      githubUrl: row.githubUrl || "",
      publicUrl: row.publicUrl || "",
      ok: analysis.ok,
      notOk: analysis.notOk,
      nextAction: analysis.nextAction,
      helpfulTask: analysis.helpfulTask,
      taskCanHelp: analysis.taskCanHelp
    };
  });
}

function analyzeProject(row) {
  const okItems = splitItems(row.done);
  const problems = splitItems(row.toFix);
  const helpful = [];
  let nextAction = problems[0] || "Aucune action immediate.";
  let taskCanHelp = "Non";
  const text = `${row.security || ""} ${row.publication || ""} ${row.github || ""} ${row.toFix || ""} ${row.functionality || ""}`.toLowerCase();
  const functionality = String(row.functionality || "").toUpperCase();

  if ((row.status || "") === "OK" && !problems.length) {
    return {
      ok: okItems.join("; ") || "OK",
      notOk: "-",
      nextAction: "Aucune",
      helpfulTask: "Aucune",
      taskCanHelp: "Non necessaire"
    };
  }
  if ((row.status || "") === "NON_PUBLIC" && !problems.length) {
    return {
      ok: okItems.join("; ") || "Projet non public confirme",
      notOk: "-",
      nextAction: "Aucune si le projet reste prive",
      helpfulTask: "Decision manuelle",
      taskCanHelp: "Seulement si tu veux une version publique"
    };
  }
  if (/fail|secret|session|sensitive|bloque/.test(text)) {
    helpful.push("03 Audit securite");
    taskCanHelp = "Oui, apres correction des fichiers sensibles";
  }
  if (/FAIL|NON_TESTABLE|MANQUE|ALERTE|UNKNOWN/.test(functionality)) {
    helpful.push("02 Moteur audit");
    taskCanHelp = "Oui, pour verifier le fonctionnement";
  }
  if (/changements locaux restants apres publication/.test(text)) {
    helpful.push("06 Publier GitHub partage");
    taskCanHelp = "Oui, apres validation des changements locaux restants";
  } else if (/github|readme_github|depot|git public|initialiser git|revoir les changements/.test(text)) {
    helpful.push("04 Preparation GitHub partage");
    helpful.push("05 Verification statuts");
    helpful.push("06 Publier GitHub partage");
    taskCanHelp = "Oui, si la securite est OK";
  }
  if (/fiche|vignette|capture|ma methode|documentation/.test(text)) {
    helpful.push("07 Fiches et vignettes");
    taskCanHelp = "Oui, pour documentation et visuels";
  }
  if (/private_internal|garder prive|valider explicitement/.test(text)) {
    helpful.push("Decision manuelle");
    taskCanHelp = "Decision necessaire avant automatisation";
  }
  if (!helpful.length) helpful.push("05 Verification statuts");
  return {
    ok: okItems.join("; ") || "-",
    notOk: problems.join("; ") || "-",
    nextAction,
    helpfulTask: unique(helpful).join(" puis "),
    taskCanHelp
  };
}

function splitItems(value) {
  const text = String(value || "").trim();
  if (!text || text === "-" || /^aucune correction immediate$/i.test(text)) return [];
  const seen = new Set();
  const items = [];
  for (const raw of text.split(";")) {
    const item = readableProblem(raw);
    const key = normalizeProblem(item);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

function readableProblem(value) {
  let text = String(value || "").trim();
  text = text.replace(/^github:\s*/i, "");
  if (/^traiter les alertes github de l'action 02$/i.test(text)) {
    return "choisir les fichiers publics a suivre dans Git";
  }
  return text;
}

function normalizeProblem(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/avant commit public/g, "")
    .replace(/dans git/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderMarkdown(data) {
  return `# Executeur simple 8 taches

- Date: ${data.generatedAt}
- Statut: **${data.status}**
- Mode: ${data.mode}
- Portee: ${data.scope}
- Taches lancees: ${data.tasks.join(", ")}
- Projets: ${data.selectedProjects.length}

## Les 8 taches

${alignedMarkdownTable(
    ["Tache", "Nom simple", "Ce que ca fait"],
    taskDefinitions().map((task) => [task.id, task.label, task.help])
  )}

## Taches executees

${alignedMarkdownTable(
    ["Tache", "Statut", "Code", "Commande", "Sortie"],
    data.taskRuns.map((task) => [
      task.label,
      task.status,
      task.exitCode ?? "-",
      task.command,
      trimText(task.output, 220)
    ])
  )}

## Resultat par projet

${alignedMarkdownTable(
    ["Projet", "Etat", "OK", "Pas OK", "Action a faire", "Tache utile"],
    data.projectRows.map((project) => [
      project.project,
      project.state,
      trimText(project.ok, 180),
      trimText(project.notOk, 220),
      trimText(project.nextAction, 180),
      project.helpfulTask
    ])
  )}

## Est-ce qu'une tache peut aider ?

${alignedMarkdownTable(
    ["Projet", "Tache qui peut aider", "Pourquoi"],
    data.projectRows.map((project) => [
      project.project,
      project.helpfulTask,
      project.taskCanHelp
    ])
  )}

## Regles de securite

- Aucun commit automatique hors tache 06 lancee explicitement en mode publication.
- La tache 06 peut publier sur GitHub public avec audit OK_PUBLIC, ou en prive/vitrine avec audit OK_PRIVATE/OK_PUBLIC et fichiers controles.
- La tache 08 prepare l'archive Hostinger et demande le MCP Hostinger pour la publication reelle.
- Les projets bloques securite restent bloques tant que les fichiers sensibles ne sont pas corriges.
`;
}

function taskDefinitions() {
  return [
    { id: "01", label: "Scan etat projets", help: "Met a jour la liste des projets et leur etat connu." },
    { id: "02", label: "Moteur audit", help: "Verifie securite et fonctionnement pour savoir ce qui bloque." },
    { id: "03", label: "Audit securite", help: "Controle secrets, sessions et fichiers sensibles." },
    { id: "04", label: "Preparation GitHub partage", help: "Prepare le depot public propre ou, pour un non-public, le depot prive interne et la vitrine nettoyee." },
    { id: "05", label: "Verification statuts publication", help: "Verifie les statuts Hostinger/GitHub apres preparation et bloque la suite si une action manuelle reste necessaire." },
    { id: "06", label: "Publier GitHub partage", help: "Publie le depot public ou, pour un non-public, le depot prive interne et la vitrine publique nettoyee." },
    { id: "07", label: "Fiches et vignettes", help: "Capture les projets, actualise les fiches avec liens/captures, genere les vignettes manquantes et synchronise Site Ma Methode." },
    { id: "08", label: "Publication Hostinger", help: "Prepare l'archive publique Site Ma Methode et fournit le handoff MCP Hostinger." }
  ];
}

function runCommand(spec) {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    execFile(spec.command, spec.args, {
      cwd: spec.cwd || orchestratorRoot,
      windowsHide: true,
      timeout: spec.timeoutMs || 20 * 60 * 1000,
      maxBuffer: 80 * 1024 * 1024
    }, (error, stdout = "", stderr = "") => {
      const exitCode = error ? (Number.isInteger(error.code) ? error.code : 1) : 0;
      const output = [stdout, stderr, error && !Number.isInteger(error.code) ? error.message : ""].filter(Boolean).join("\n").trim();
      resolvePromise({
        task: spec.task || "",
        label: spec.label,
        status: exitCode === 0 ? statusFromOutput(output) || "OK" : "FAIL",
        exitCode,
        durationMs: Date.now() - started,
        command: spec.displayCommand,
        output: output || "-"
      });
    });
  });
}

function statusFromOutput(output) {
  const match = String(output || "").match(/(?:Executeur [78] taches|Executeur projets|Automatisation \d+|Rapport workflow projets):\s*([A-Z0-9_]+)/i);
  return match ? match[1].toUpperCase() : "";
}

function selectProjects(projects) {
  if (args.all) return projects;
  const query = projectSelector();
  if (!query) return [];
  const needle = normalize(resolveMaybeProjectPath(query));
  return projects.filter((project) => {
    const values = [project.id, project.name, project.path, basename(project.path || "")].filter(Boolean);
    return values.map(resolveMaybeProjectPath).map(normalize).some((value) => value.includes(needle) || needle.includes(value));
  });
}

function visibleProjects(projects) {
  return projects.filter((project) => project.id !== "99-archive" && project.name !== "99_Archive" && project.category !== "archive");
}

function projectListRow(project) {
  return {
    id: project.id,
    name: displayName(project.name),
    sourceName: project.name,
    path: toPosixPath(project.path),
    category: project.siteCategory || project.category || "tools",
    securityStatus: project.securityStatus || "UNKNOWN",
    publicationStatus: project.publicationStatus || project.status || "UNKNOWN",
    git: project.git?.hasGit ? (project.git.dirty ? "GIT avec changements" : "GIT propre") : "NO_GIT"
  };
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function resolveMaybeProjectPath(value) {
  const text = String(value || "");
  if (/^[a-zA-Z]:[\\/]/.test(text)) return resolve(text);
  return text;
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\\/g, "/");
}
