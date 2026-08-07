import { execFile } from "node:child_process";
import { basename, join, resolve } from "node:path";
import {
  defaultProjectsRoot,
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
  nowIso,
  trimText,
  writeAutomationReport
} from "./lib/automation-utils.mjs";

const { automatisationsRoot, orchestratorRoot, resultsRoot } = automationPaths(import.meta.url);
const args = parseArgs();
const resultName = "00-executeur-projets";
const resultRoot = join(resultsRoot, resultName);
await ensureDir(resultRoot);

if (args.list || args.scanList) {
  await scanAndListProjects();
} else {
  await executeProjectActions();
}

async function scanAndListProjects() {
  const scan = await runCommand({
    label: "Scanner tous les projets",
    command: process.execPath,
    args: [join(orchestratorRoot, "scripts", "scan-projects.mjs")],
    displayCommand: "node scripts/scan-projects.mjs"
  });
  const registry = await loadRegistry();
  const projects = projectList(registry.projects || []);
  const data = {
    generatedAt: nowIso(),
    action: "00-executeur-projets-list",
    mode: "LIST",
    scan,
    count: projects.length,
    projects
  };
  const markdown = `# Executeur projets - Liste

- Date: ${data.generatedAt}
- Mode: LIST
- Projets listes: ${projects.length}
- Scan: ${scan.status}

${alignedMarkdownTable(
    ["Projet", "Section", "Statut", "Securite", "Publication", "Git"],
    projects.map((project) => [
      project.name,
      project.category,
      project.status,
      project.securityStatus,
      project.publicationStatus,
      project.git
    ])
  )}
`;
  const report = await writeAutomationReport(resultsRoot, resultName, markdown, data);
  await writeJson(join(resultRoot, "projects-latest.json"), data);
  await writeText(join(resultRoot, "projects-latest.md"), markdown);
  console.log(`Executeur projets: LIST`);
  console.log(`Projets: ${projects.length}`);
  console.log(`Liste: ${join(resultRoot, "projects-latest.json")}`);
  console.log(`Rapport: ${report.mdPath}`);
}

async function executeProjectActions() {
  const actions = actionList();
  const testMode = Boolean(args.test || args.dryRun);
  const preScan = await maybeRunGlobalScanBeforeSelection(actions, testMode);
  const registry = await loadRegistry();
  const allProjects = visibleProjects(registry.projects || []);
  const selectedProjects = selectProjects(allProjects);

  if (!selectedProjects.length) {
    const markdown = `# Executeur projets

- Date: ${nowIso()}
- Statut: **FAIL**
- Detail: aucun projet selectionne. Utiliser \`--project <nom-ou-id>\`, \`--all\` ou \`--list\`.
`;
    const data = { generatedAt: nowIso(), action: resultName, status: "FAIL", reason: "NO_PROJECT" };
    const report = await writeAutomationReport(resultsRoot, resultName, markdown, data);
    await writeText(join(resultRoot, "last-execution.md"), markdown);
    await writeJson(join(resultRoot, "last-execution.json"), data);
    console.log("Executeur projets: FAIL");
    console.log(`Rapport: ${report.mdPath}`);
    process.exitCode = 1;
    return;
  }

  const projectResults = [];
  let siteSyncRequested = false;
  let reportRequested = false;

  for (const project of selectedProjects) {
    const projectResult = {
      project: project.name,
      id: project.id,
      title: displayName(project.name),
      path: project.path,
      securityStatus: project.securityStatus || "UNKNOWN",
      publicationStatus: project.publicationStatus || project.status || "UNKNOWN",
      actions: []
    };
    for (const action of actions) {
      if (action === "site") {
        siteSyncRequested = true;
        projectResult.actions.push(plannedGlobalAction("site"));
        continue;
      }
      if (action === "report") {
        reportRequested = true;
        projectResult.actions.push(plannedGlobalAction("report"));
        continue;
      }
      projectResult.actions.push(await executeActionForProject(project, action, testMode));
    }
    projectResults.push(projectResult);
  }

  const globalActions = [];
  if (siteSyncRequested) {
    globalActions.push(await executeGlobalAction("site", testMode));
  }
  if (reportRequested || actions.includes("workflow")) {
    globalActions.push(await executeGlobalAction("report", false));
  }

  const data = {
    generatedAt: nowIso(),
    action: resultName,
    mode: testMode ? "TEST" : "RUN",
    scope: args.all ? "ALL_PROJECTS" : "PROJECT",
    selectedProjects: selectedProjects.map((project) => ({ id: project.id, name: project.name, path: project.path })),
    actions,
    preScan,
    counts: countStatuses(projectResults, globalActions),
    projectResults,
    globalActions
  };
  const markdown = renderExecutionReport(data);
  const report = await writeAutomationReport(resultsRoot, resultName, markdown, data);
  await writeText(join(resultRoot, "last-execution.md"), markdown);
  await writeJson(join(resultRoot, "last-execution.json"), data);
  await writeJson(join(resultRoot, "projects-latest.json"), {
    generatedAt: nowIso(),
    action: "00-executeur-projets-list",
    mode: "CURRENT_REGISTRY",
    count: allProjects.length,
    projects: projectList(allProjects)
  });

  const globalStatus = data.counts.fail > 0 ? "ECHEC" : data.counts.blocked > 0 ? "A_CORRIGER" : "OK";
  console.log(`Executeur projets: ${globalStatus}`);
  console.log(`Mode: ${data.mode}`);
  console.log(`Projets: ${selectedProjects.length}`);
  console.log(`Rapport: ${report.mdPath}`);
  if (data.counts.fail > 0) process.exitCode = 1;
}

async function maybeRunGlobalScanBeforeSelection(actions, testMode) {
  if (!args.all) return null;
  if (!actions.includes("scan")) return null;
  if (testMode) {
    return {
      action: "scan-global",
      label: "Scan global disque avant selection",
      status: "TEST_PLAN",
      exitCode: null,
      command: "node scripts/scan-projects.mjs",
      output: "Mode test: scan global non execute."
    };
  }
  return runCommand({
    action: "scan-global",
    label: "Scan global disque avant selection",
    command: process.execPath,
    args: [join(orchestratorRoot, "scripts", "scan-projects.mjs")],
    cwd: orchestratorRoot,
    displayCommand: "node scripts/scan-projects.mjs",
    timeoutMs: 10 * 60 * 1000
  });
}

async function executeActionForProject(project, action, testMode) {
  const spec = actionSpec(project, action, testMode);
  if (!spec) {
    return {
      action,
      label: action,
      status: "INCONNU",
      exitCode: null,
      command: "-",
      output: "Action inconnue."
    };
  }
  if (testMode && spec.skipInTest) {
    return {
      action,
      label: spec.label,
      status: "TEST_PLAN",
      exitCode: null,
      command: spec.displayCommand,
      output: "Mode test: commande non executee."
    };
  }
  return runCommand({
    label: spec.label,
    action,
    command: spec.command,
    args: spec.args,
    cwd: spec.cwd || orchestratorRoot,
    displayCommand: spec.displayCommand,
    timeoutMs: spec.timeoutMs || 20 * 60 * 1000
  });
}

async function executeGlobalAction(action, testMode) {
  const specs = {
    site: {
      label: "Synchroniser Site Ma Methode",
      command: process.execPath,
      args: [join(orchestratorRoot, "scripts", "update-site-ma-methode-projects.mjs"), "--sync"],
      displayCommand: "node scripts/update-site-ma-methode-projects.mjs --sync",
      skipInTest: true
    },
    report: {
      label: "Generer rapport consolide",
      command: process.execPath,
      args: [join(automatisationsRoot, "00-rapport-workflow-projets.mjs")],
      displayCommand: "node automatisations/00-rapport-workflow-projets.mjs",
      skipInTest: false
    }
  };
  const spec = specs[action];
  if (testMode && spec.skipInTest) {
    return {
      action,
      label: spec.label,
      status: "TEST_PLAN",
      exitCode: null,
      command: spec.displayCommand,
      output: "Mode test: commande globale non executee."
    };
  }
  return runCommand({ action, ...spec });
}

function actionSpec(project, action, testMode) {
  const projectPath = project.path;
  const projectSelector = project.id || project.name;
  const qwenArgs = args.localOnly || args.noQwen
    ? []
    : ["--qwen-image", "--qwen-max", String(args.qwenMax || 1)];
  const captureArgs = testMode ? [] : ["--capture"];
  const specs = {
    scan: {
      label: "Scanner projet",
      command: process.execPath,
      args: [join(orchestratorRoot, "scripts", "scan-projects.mjs"), "--project", projectPath],
      displayCommand: `node scripts/scan-projects.mjs --project "${projectPath}"`
    },
    security: {
      label: "Audit securite projet",
      command: process.execPath,
      args: [join(orchestratorRoot, "scripts", "audit-project-security.mjs"), "--project", projectPath],
      displayCommand: `node scripts/audit-project-security.mjs --project "${projectPath}"`
    },
    functionality: {
      label: "Verifier fonctionnement",
      command: process.execPath,
      args: [
        join(orchestratorRoot, "scripts", "verify-project-functionality.mjs"),
        "--project",
        projectPath,
        ...(testMode ? [] : ["--run"])
      ],
      displayCommand: `node scripts/verify-project-functionality.mjs --project "${projectPath}"${testMode ? "" : " --run"}`,
      timeoutMs: 10 * 60 * 1000
    },
    github: {
      label: "Preparer GitHub partage",
      command: process.execPath,
      args: [
        join(automatisationsRoot, "04-preparation-git-public.mjs"),
        "--project",
        projectSelector,
        ...(testMode ? [] : ["--run"])
      ],
      displayCommand: `node automatisations/04-preparation-git-public.mjs --project "${projectSelector}"${testMode ? "" : " --run"}`
    },
    "ai-draft": {
      label: "Analyser et rediger contenu Mistral",
      command: process.execPath,
      args: [
        join(orchestratorRoot, "scripts", "generate-project-fiche-ai-draft.mjs"),
        "--project",
        projectPath,
        "--apply",
        "--agent",
        "mistral",
        "--refresh-existing",
        "--max-projects",
        "1"
      ],
      displayCommand: `node scripts/generate-project-fiche-ai-draft.mjs --project "${projectPath}" --apply --agent mistral --refresh-existing --max-projects 1`,
      skipInTest: true,
      timeoutMs: 5 * 60 * 1000
    },
    fiches: {
      label: "Actualiser fiches projet",
      command: process.execPath,
      args: [join(orchestratorRoot, "scripts", "update-project-fiches.mjs"), "--project", projectPath],
      displayCommand: `node scripts/update-project-fiches.mjs --project "${projectPath}"`,
      skipInTest: true
    },
    captures: {
      label: "Capturer projet",
      command: process.execPath,
      args: [join(orchestratorRoot, "scripts", "capture-project-screenshots.mjs"), "--project", projectPath, ...captureArgs],
      displayCommand: `node scripts/capture-project-screenshots.mjs --project "${projectPath}"${testMode ? "" : " --capture"}`,
      timeoutMs: 10 * 60 * 1000
    },
    thumbnails: {
      label: "Generer vignette projet",
      command: process.execPath,
      args: [join(orchestratorRoot, "scripts", "generate-project-thumbnails.mjs"), "--project", projectSelector, ...qwenArgs],
      displayCommand: `node scripts/generate-project-thumbnails.mjs --project "${projectSelector}"${qwenArgs.length ? ` ${qwenArgs.join(" ")}` : ""}`,
      skipInTest: true,
      timeoutMs: 5 * 60 * 1000
    }
  };
  return specs[action] || null;
}

function actionList() {
  if (args.workflow) {
    const base = ["scan", "security", "functionality", "github"];
    if (!args.noCaptures) base.push("captures");
    base.push("ai-draft", "fiches", "thumbnails", "site", "report");
    return base;
  }
  const raw = String(args.actions || args.action || "scan");
  return raw.split(",").map((item) => normalizeAction(item)).filter(Boolean);
}

function normalizeAction(value) {
  const item = String(value || "").trim().toLowerCase();
  const aliases = {
    "fonctionnement": "functionality",
    "function": "functionality",
    "securite": "security",
    "sécurité": "security",
    "github-public": "github",
    "git": "github",
    "ai": "ai-draft",
    "ia": "ai-draft",
    "mistral": "ai-draft",
    "contenu": "ai-draft",
    "redaction": "ai-draft",
    "fiche": "fiches",
    "vignette": "thumbnails",
    "vignettes": "thumbnails",
    "capture": "captures",
    "captures-projet": "captures",
    "site-ma-methode": "site",
    "rapport": "report"
  };
  return aliases[item] || item;
}

function selectProjects(projects) {
  if (args.all) return projects;
  const query = String(args.project || "").trim();
  if (!query) return [];
  const needle = normalize(resolveMaybeProjectPath(query));
  return projects.filter((project) => {
    const values = [project.id, project.name, project.path, basename(project.path || "")].filter(Boolean).map(resolveMaybeProjectPath).map(normalize);
    return values.some((value) => value.includes(needle) || needle.includes(value));
  });
}

function visibleProjects(projects) {
  if (args.includeArchive) return projects;
  return projects.filter((project) => project.id !== "99-archive" && project.name !== "99_Archive" && project.category !== "archive");
}

function projectList(projects) {
  return visibleProjects(projects).map((project) => ({
    id: project.id,
    name: displayName(project.name),
    sourceName: project.name,
    path: toPosixPath(project.path),
    category: project.siteCategory || project.category || "tools",
    status: project.status || "UNKNOWN",
    securityStatus: project.securityStatus || "UNKNOWN",
    functionalityStatus: project.functionalityStatus || "UNKNOWN",
    publicationStatus: project.publicationStatus || "UNKNOWN",
    git: project.git?.hasGit ? (project.git.dirty ? "GIT avec changements" : "GIT propre") : "NO_GIT",
    hasPackageJson: Boolean(project.hasPackageJson),
    scripts: project.scripts || []
  }));
}

function plannedGlobalAction(action) {
  return {
    action,
    label: action === "site" ? "Synchronisation site globale" : "Rapport consolide global",
    status: "GLOBAL_APRES_PROJETS",
    exitCode: null,
    command: action,
    output: "Action globale executee une seule fois apres les projets."
  };
}

function runCommand(spec) {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const done = (error, stdout = "", stderr = "") => {
      const exitCode = error ? (Number.isInteger(error.code) ? error.code : 1) : 0;
      const errorOutput = error && !Number.isInteger(error.code) ? error.message : "";
      const output = [stdout, stderr, errorOutput].filter(Boolean).join("\n").trim();
      resolvePromise({
        action: spec.action || "",
        label: spec.label,
        status: exitCode === 0 ? (automationStatus(output) || "OK") : "FAIL",
        exitCode,
        durationMs: Date.now() - started,
        command: spec.displayCommand,
        output: output || "-"
      });
    };
    try {
      execFile(spec.command, spec.args, {
        cwd: spec.cwd || orchestratorRoot,
        windowsHide: true,
        timeout: spec.timeoutMs || 20 * 60 * 1000,
        maxBuffer: 80 * 1024 * 1024
      }, done);
    } catch (error) {
      done(error);
    }
  });
}

function automationStatus(output) {
  const patterns = [
    /(?:Automatisation \d+|Executeur projets|Rapport workflow projets):\s*([A-Z0-9_]+)/i
  ];
  for (const pattern of patterns) {
    const match = String(output || "").match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return "";
}

function countStatuses(projectResults, globalActions) {
  const actions = [
    ...projectResults.flatMap((project) => project.actions),
    ...globalActions
  ];
  return {
    total: actions.length,
    ok: actions.filter((action) => ["OK", "LIST", "DRY_RUN"].includes(action.status)).length,
    test: actions.filter((action) => action.status === "TEST_PLAN").length,
    blocked: actions.filter((action) => /A_COMPLETER|BLOQUE|A_CORRIGER|ACTIONS_MANUELLES/.test(action.status)).length,
    fail: actions.filter((action) => action.status === "FAIL" || action.status === "INCONNU").length
  };
}

function renderExecutionReport(data) {
  return `# Executeur projets

- Date: ${data.generatedAt}
- Mode: **${data.mode}**
- Portee: ${data.scope}
- Projets selectionnes: ${data.selectedProjects.length}
- Actions: ${data.actions.join(", ")}
- Actions OK ou acceptees: ${data.counts.ok}
- Actions test planifiees: ${data.counts.test}
- Actions a corriger: ${data.counts.blocked}
- Actions en echec: ${data.counts.fail}

## Scan global avant selection

${data.preScan
    ? alignedMarkdownTable(
      ["Action", "Statut", "Code", "Commande", "Sortie"],
      [[
        data.preScan.label,
        data.preScan.status,
        data.preScan.exitCode ?? "-",
        data.preScan.command,
        trimText(data.preScan.output, 260)
      ]]
    )
    : "- Non requis."}

## Vue par projet

${alignedMarkdownTable(
    ["Projet", "Securite", "Publication", "Actions", "A corriger"],
    data.projectResults.map((project) => [
      project.title,
      project.securityStatus,
      project.publicationStatus,
      project.actions.map((action) => `${action.label}:${action.status}`).join("; "),
      project.actions.filter((action) => /A_COMPLETER|FAIL|BLOQUE|A_CORRIGER|ACTIONS_MANUELLES/.test(action.status)).map((action) => action.label).join("; ") || "-"
    ])
  )}

## Details actions projet

${data.projectResults.map((project) => `### ${project.title}

${alignedMarkdownTable(
    ["Action", "Statut", "Code", "Duree", "Commande", "Sortie"],
    project.actions.map((action) => [
      action.label,
      action.status,
      action.exitCode ?? "-",
      action.durationMs ? `${action.durationMs} ms` : "-",
      action.command,
      trimText(action.output, 260)
    ])
  )}`).join("\n\n")}

## Actions globales

${data.globalActions.length
    ? alignedMarkdownTable(
      ["Action", "Statut", "Code", "Commande", "Sortie"],
      data.globalActions.map((action) => [
        action.label,
        action.status,
        action.exitCode ?? "-",
        action.command,
        trimText(action.output, 260)
      ])
    )
    : "- Aucune action globale."}

## Regles

- Mode RUN par defaut: les actions sont executees concretement.
- Mode TEST: les actions destructrices ou d'ecriture sont planifiees quand elles n'ont pas de dry-run fiable.
- Aucun commit, aucun push GitHub et aucune publication Hostinger ne sont faits par cet executeur.
`;
}

function resolveMaybeProjectPath(value) {
  const text = String(value || "");
  if (/^[a-zA-Z]:[\\/]/.test(text)) return resolve(text);
  return text;
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\\/g, "/");
}
