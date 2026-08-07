import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  execFileText,
  inferProjectStatus,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  saveRegistry,
  scanProject,
  toPosixPath,
  writeJson,
  writeReport,
  writeText
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const shouldRun = Boolean(args.run);
const projects = await projectsFromArgs(args);
const registry = await loadRegistry();
const results = [];

for (const projectRef of projects) {
  if (projectRef.name === "99_Archive" && !args.includeArchive) {
    results.push({
      project: await scanProject(projectRef),
      generatedAt: nowIso(),
      status: "ARCHIVE_READ_ONLY",
      commands: [],
      checks: [],
      launchScripts: [],
      reportPath: null,
      skipped: "ARCHIVE_READ_ONLY"
    });
    continue;
  }
  const project = await scanProject(projectRef);
  const previous = registry.projects?.find?.((item) => item.id === project.id) || {};
  const result = await verifyProject(project, shouldRun);
  result.status = functionalityStatusForRegistry(previous.functionalityStatus, result.status, shouldRun);
  if (!shouldRun && previous.functionalityStatus && previous.functionalityStatus === result.status) {
    result.recommendation = `${result.recommendation || ""} Statut reel precedent conserve dans ce dry-run.`.trim();
  }
  results.push(result);
  await writeProjectFunctionalityReport(result);
}

for (const result of results) {
  const index = registry.projects.findIndex((project) => project.id === result.project.id);
  const base = index >= 0 ? registry.projects[index] : result.project;
  const next = {
    ...base,
    functionalityStatus: functionalityStatusForRegistry(base.functionalityStatus, result.status, shouldRun),
    reports: {
      ...(base.reports || {}),
      ...(result.reportPath ? { functionality: toPosixPath(result.reportPath) } : {})
    },
    updatedAt: nowIso()
  };
  next.status = inferProjectStatus(next);
  if (index >= 0) registry.projects[index] = next;
  else registry.projects.push(next);
}
registry.generatedAt = nowIso();
await saveRegistry(registry);

const rows = results.map((result) => [
  result.project.name,
  result.status,
  result.commands.map((command) => `${command.name}:${command.status}`).join(", ") || "aucune",
  result.launchScripts?.join(", ") || "-"
]);
const report = await writeReport(
  "functionality",
  "verify-functionality-global",
  `# Verification fonctionnement globale

- Date: ${nowIso()}
- Execution commandes: ${shouldRun ? "oui" : "non, dry-run"}

${markdownTable(["Projet", "Statut", "Commandes", "Scripts lancement"], rows)}
`,
  { generatedAt: nowIso(), run: shouldRun, results }
);
console.log(`Verification fonctionnement terminee: ${results.length} projet(s).`);
console.log(`Rapport global: ${report.mdPath}`);

async function verifyProject(project, run) {
  const checkScripts = controlScriptsFor(project.scripts);
  const launchScripts = ["dev", "preview", "start", "serve"].filter((script) => project.scripts.includes(script));
  const commands = [];
  const staticHtml = !project.hasPackageJson && existsSync(join(project.path, "index.html"));
  const checks = [
    check("package.json", project.hasPackageJson ? "OK" : "MANUAL", project.hasPackageJson ? "Package npm detecte." : "Aucun package.json, verification manuelle requise."),
    check("scripts-controle", checkScripts.length ? "OK" : "WARN", checkScripts.length ? checkScripts.join(", ") : "Aucun script check/validate/lint/test/build sur."),
    check("scripts-lancement", launchScripts.length ? "OK" : "WARN", launchScripts.length ? launchScripts.join(", ") : "Aucun script dev/preview/start/serve."),
    check("documentation", project.hasFiche && project.hasInstallation ? "OK" : "WARN", project.hasFiche && project.hasInstallation ? "Fiche et installation presentes." : "Documentation a completer."),
    check("captures", project.screenshots?.length ? "OK" : "WARN", project.screenshots?.length ? `${project.screenshots.length} capture(s) detectee(s).` : "Aucune capture detectee."),
    ...(staticHtml ? [check("static-html", "OK", "index.html detecte; lancement local possible par navigateur.")] : [])
  ];

  if (staticHtml) {
    return {
      project,
      generatedAt: nowIso(),
      status: "FONCTIONNEL",
      commands,
      checks,
      checkScripts,
      launchScripts: ["index.html"],
      recommendation: "Projet statique verifie: ouvrir index.html dans le navigateur.",
      reportPath: join(project.path, "RAPPORT_FONCTIONNALITE.md")
    };
  }
  if (!project.hasPackageJson) {
    return {
      project,
      generatedAt: nowIso(),
      status: "NON_TESTABLE_MANQUE_INFO",
      commands,
      checks,
      checkScripts,
      launchScripts,
      recommendation: "Documenter une procedure de verification manuelle.",
      reportPath: join(project.path, "RAPPORT_FONCTIONNALITE.md")
    };
  }
  if (!checkScripts.length) {
    return {
      project,
      generatedAt: nowIso(),
      status: launchScripts.length ? "FONCTIONNEL_AVEC_ALERTES" : "NON_TESTABLE_MANQUE_INFO",
      commands,
      checks,
      checkScripts,
      launchScripts,
      recommendation: launchScripts.length
        ? "Projet lancable mais sans script de controle automatisable sur."
        : "Ajouter ou documenter une commande de verification.",
      reportPath: join(project.path, "RAPPORT_FONCTIONNALITE.md")
    };
  }
  for (const script of checkScripts) {
    if (!run) {
      commands.push({ name: script, status: "DRY_RUN", command: `npm run ${script}` });
      continue;
    }
    try {
      const { stdout, stderr } = await runNpmScript(project.path, script);
      commands.push({
        name: script,
        status: "OK",
        command: `npm run ${script}`,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr)
      });
    } catch (error) {
      commands.push({
        name: script,
        status: "FAIL",
        command: `npm run ${script}`,
        stdoutTail: tail(error.stdout || ""),
        stderrTail: tail(error.stderr || error.message)
      });
      break;
    }
  }
  const status = commands.some((command) => command.status === "FAIL")
    ? "NON_FONCTIONNEL_REPARABLE"
    : run
      ? "FONCTIONNEL"
      : "FONCTIONNEL_AVEC_ALERTES";
  return {
    project,
    generatedAt: nowIso(),
    status,
    commands,
    checks,
    checkScripts,
    launchScripts,
    recommendation: run
      ? "Verification automatisee executee."
      : "Execution non lancee. Relancer avec --run pour executer les scripts de controle surs.",
    reportPath: join(project.path, "RAPPORT_FONCTIONNALITE.md")
  };
}

function tail(value) {
  return String(value).split(/\r?\n/).slice(-20).join("\n").trim();
}

function controlScriptsFor(scripts = []) {
  const names = new Set(scripts);
  const preferred = [
    "check",
    "validate",
    "typecheck",
    "type:check",
    "compat:check",
    "lint",
    "test",
    "build"
  ];
  const selected = preferred.filter((script) => names.has(script));
  for (const script of [...names].sort()) {
    if (/^check:/i.test(script) && isSafeControlScript(script)) selected.push(script);
  }
  return [...new Set(selected)];
}

function isSafeControlScript(script) {
  return !/(model|models|api|bench|deploy|publish|sync|push|clean|delete|remove|archive|start|serve|dev|preview|watch)/i.test(script);
}

function functionalityStatusForRegistry(previousStatus, resultStatus, run) {
  if (run) return resultStatus;
  if (["FONCTIONNEL", "ARCHIVE_READ_ONLY"].includes(previousStatus)) return previousStatus;
  if (String(previousStatus || "").startsWith("NON_FONCTIONNEL")) return previousStatus;
  return resultStatus;
}

function runNpmScript(projectPath, script) {
  if (process.platform === "win32") {
    return execFileText(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm run ${script}`], 90000, { cwd: projectPath });
  }
  return execFileText("npm", ["run", script], 90000, { cwd: projectPath });
}

async function writeProjectFunctionalityReport(result) {
  const rows = result.commands.map((command) => [
    command.name,
    command.status,
    command.command
  ]);
  const checkRows = (result.checks || []).map((item) => [item.name, item.status, item.details]);
  const body = `# Rapport fonctionnalite - ${result.project.name}

- Date: ${result.generatedAt}
- Projet: \`${result.project.path}\`
- Statut: **${result.status}**
- Scripts controle: ${(result.checkScripts || []).join(", ") || "aucun"}
- Scripts lancement: ${(result.launchScripts || []).join(", ") || "aucun"}

## Checks V1
${checkRows.length ? markdownTable(["Point", "Statut", "Details"], checkRows) : "Aucun check detaille."}

## Commandes

${rows.length ? markdownTable(["Script", "Statut", "Commande"], rows) : "Aucun script automatisable detecte pour la V1."}

## Recommandation
${result.recommendation || "Aucune recommandation."}
`;
  await writeText(result.reportPath, body);
  await writeJson(join(result.project.path, "RAPPORT_FONCTIONNALITE.json"), {
    generatedAt: result.generatedAt,
    status: result.status,
    commands: result.commands,
    checks: result.checks || [],
    checkScripts: result.checkScripts || [],
    launchScripts: result.launchScripts || [],
    recommendation: result.recommendation || null
  });
}

function check(name, status, details) {
  return { name, status, details };
}
