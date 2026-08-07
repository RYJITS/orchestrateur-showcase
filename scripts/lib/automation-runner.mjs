import { execFile } from "node:child_process";
import { join } from "node:path";
import {
  defaultProjectsRoot,
  markdownTable,
  nowIso,
  orchestratorRoot,
  writeReport
} from "./orchestrator-utils.mjs";

const SCRIPT_FILES = {
  "scan": "scan-projects.mjs",
  "registry:check": "validate-project-registry.mjs",
  "status:check": "validate-project-statuses.mjs",
  "expected:check": "validate-expected-projects.mjs",
  "plan:coverage": "validate-plan-coverage.mjs",
  "git:changes": "git-change-report.mjs",
  "git:guard": "validate-git-backup-readiness.mjs",
  "safety:check": "validate-dry-run-safety.mjs",
  "security": "audit-project-security.mjs",
  "optimization": "audit-project-optimization.mjs",
  "architecture": "audit-project-architecture.mjs",
  "cleanup:audit": "audit-project-cleanup.mjs",
  "cleanup:archive": "archive-unused-assets.mjs",
  "verify:functionality": "verify-project-functionality.mjs",
  "repair:functionality": "repair-project-functionality.mjs",
  "fiches": "update-project-fiches.mjs",
  "docs:check": "validate-project-documentation.mjs",
  "screenshots": "capture-project-screenshots.mjs",
  "screenshots:check": "validate-screenshot-coverage.mjs",
  "site-ma-methode": "update-site-ma-methode-projects.mjs",
  "site:check": "validate-site-ma-methode-sync.mjs",
  "site:render-check": "validate-site-render.mjs",
  "memory:central": "sync-memory-central.mjs",
  "memory:project": "sync-project-memory.mjs",
  "backup:status": "git-backup-guard.mjs",
  "skills:check": "install-codex-skills.mjs",
  "github:prepare": "github-prepare-public-repo.mjs",
  "publication:check": "validate-publication-gates.mjs",
  "hostinger:check": "validate-hostinger-gates.mjs",
  "github:sync": "github-sync-project.mjs",
  "subagents:check": "validate-subagent-safety.mjs"
};

export const AUTOMATION_STEPS = {
  daily: [
    ["scan", ["--root", defaultProjectsRoot]],
    ["registry:check", []],
    ["status:check", []],
    ["expected:check", []],
    ["plan:coverage", []],
    ["git:changes", ["--all"]],
    ["git:guard", []],
    ["safety:check", []],
    ["verify:functionality", ["--all"]],
    ["docs:check", []],
    ["site-ma-methode", ["--sync"]],
    ["site:check", []],
    ["site:render-check", []],
    ["screenshots:check", []],
    ["publication:check", []],
    ["hostinger:check", []],
    ["subagents:check", []],
    ["memory:central", []]
  ],
  weekly: [
    ["scan", ["--root", defaultProjectsRoot]],
    ["registry:check", []],
    ["status:check", []],
    ["expected:check", []],
    ["plan:coverage", []],
    ["git:changes", ["--all"]],
    ["git:guard", []],
    ["safety:check", []],
    ["security", ["--all"]],
    ["optimization", ["--all"]],
    ["cleanup:audit", ["--all"]],
    ["cleanup:archive", ["--all"]],
    ["verify:functionality", ["--all"]],
    ["repair:functionality", ["--all"]],
    ["fiches", ["--all"]],
    ["docs:check", []],
    ["screenshots", ["--all"]],
    ["screenshots:check", []],
    ["github:prepare", ["--all"]],
    ["publication:check", []],
    ["hostinger:check", []],
    ["subagents:check", []],
    ["site-ma-methode", ["--sync"]],
    ["site:check", []],
    ["site:render-check", []],
    ["memory:project", ["--all"]]
  ],
  monthly: [
    ["scan", ["--root", defaultProjectsRoot]],
    ["registry:check", []],
    ["status:check", []],
    ["expected:check", []],
    ["plan:coverage", []],
    ["git:changes", ["--all"]],
    ["git:guard", []],
    ["safety:check", []],
    ["architecture", ["--all"]],
    ["security", ["--all"]],
    ["optimization", ["--all"]],
    ["cleanup:audit", ["--all"]],
    ["cleanup:archive", ["--all"]],
    ["verify:functionality", ["--all"]],
    ["repair:functionality", ["--all"]],
    ["fiches", ["--all"]],
    ["docs:check", []],
    ["backup:status", ["--status", "--all"]],
    ["skills:check", ["--check-only"]],
    ["screenshots:check", []],
    ["github:prepare", ["--all"]],
    ["publication:check", []],
    ["hostinger:check", []],
    ["subagents:check", []],
    ["github:sync", ["--all"]],
    ["site-ma-methode", ["--sync"]],
    ["site:check", []],
    ["site:render-check", []]
  ]
};

export async function runAutomation(mode) {
  const steps = AUTOMATION_STEPS[mode];
  if (!steps) throw new Error(`Routine inconnue: ${mode}`);
  const startedAt = nowIso();
  const results = [];

  for (const [script, args] of steps) {
    const result = await runOrchestratorScript(script, args);
    results.push(result);
    if (result.exitCode !== 0) break;
  }

  const endedAt = nowIso();
  const status = results.every((result) => result.exitCode === 0) ? "OK" : "FAIL";
  const rows = results.map((result) => [
    result.script,
    result.exitCode,
    result.durationMs,
    trimOutput(result.stdout || result.stderr)
  ]);
  const report = await writeReport(
    "global",
    `routine-${mode}`,
    `# Routine ${mode}

- Debut: ${startedAt}
- Fin: ${endedAt}
- Statut: ${status}

${markdownTable(["Commande", "Exit", "Duree ms", "Sortie"], rows)}
`,
    { mode, startedAt, endedAt, status, results }
  );
  return { mode, startedAt, endedAt, status, results, report };
}

export function runOrchestratorScript(script, extraArgs = []) {
  const fileName = SCRIPT_FILES[script];
  if (!fileName) throw new Error(`Script non autorise: ${script}`);
  const started = Date.now();
  const args = [join(orchestratorRoot, "scripts", fileName), ...extraArgs];
  return new Promise((resolve) => {
    execFile(process.execPath, args, {
      cwd: orchestratorRoot,
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024
    }, (error, stdout = "", stderr = "") => {
      resolve({
        script,
        args,
        exitCode: error?.code ?? 0,
        durationMs: Date.now() - started,
        stdout,
        stderr
      });
    });
  });
}

function trimOutput(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-4)
    .join(" ")
    .slice(0, 220);
}
