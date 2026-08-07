import {
  gitStatus,
  loadRegistry,
  markdownTable,
  nowIso,
  parseArgs,
  projectsFromArgs,
  scanProject,
  writeReport
} from "./lib/orchestrator-utils.mjs";

const args = parseArgs();
const registry = await loadRegistry();
const refs = args.project
  ? await projectsFromArgs(args)
  : registry.projects.map((project) => ({ name: project.name, path: project.path }));
const results = [];

for (const ref of refs) {
  const scanned = await scanProject(ref);
  const previous = registry.projects.find((project) => project.id === scanned.id) || {};
  const project = { ...scanned, ...previous };
  const git = await gitStatus(project.path);
  const blockers = [];
  if (project.name === "99_Archive") blockers.push("archive-only");
  if (project.securityStatus !== "OK_PUBLIC") blockers.push(`security-${project.securityStatus || "UNKNOWN"}`);
  if (!git.hasGit) blockers.push("no-git");
  if (git.dirty) blockers.push("git-dirty-review-required");
  results.push({
    project: project.name,
    path: project.path,
    git,
    status: blockers.length ? "BLOCKED" : "READY_FOR_MANUAL_SYNC",
    blockers,
    actions: ["Aucun push automatique en V1", "Verifier remote GitHub", "Creer commit cible apres validation humaine"]
  });
}

const report = await writeReport(
  "github",
  "github-sync-project",
  `# Synchronisation GitHub - dry-run

- Date: ${nowIso()}
- Effet externe: aucun
- Publication automatique: non

${markdownTable(["Projet", "Statut", "Blocages", "Git"], results.map((item) => [item.project, item.status, item.blockers.join("; ") || "aucun", item.git.status]))}
`,
  { generatedAt: nowIso(), mode: "dry-run", results }
);

console.log(`Synchronisation GitHub preparee en dry-run: ${results.length} projet(s).`);
console.log(`Rapport: ${report.mdPath}`);
